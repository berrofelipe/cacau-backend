import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

// Shared service probes, used by both the admin diagnostics endpoint
// (src/api/admin/health-status) and the 5-minute monitor job
// (src/jobs/health-monitor).

const CHECK_TIMEOUT_MS = 5000

// Where the connection is broken:
//   config  — required env var is missing
//   network — service unreachable (DNS, outage, paused instance)
//   auth    — service reachable but rejected our credentials
//   service — service reachable and authenticated, but returned an error
export type Diagnosis = "config" | "network" | "auth" | "service" | null

export type ServiceCheck = {
  service: string
  label: string
  status: "ok" | "degraded" | "error" | "not_configured"
  latency_ms: number | null
  message: string
  diagnosis: Diagnosis
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS)
    ),
  ])
}

function classifyFetchError(err: unknown): { diagnosis: Diagnosis; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  if (/timed out|abort/i.test(msg)) {
    return { diagnosis: "network", message: `Sem resposta em ${CHECK_TIMEOUT_MS}ms — serviço fora do ar ou rede bloqueada` }
  }
  return { diagnosis: "network", message: `Falha de conexão: ${msg}` }
}

async function checkDatabase(container: MedusaContainer): Promise<ServiceCheck> {
  const base = { service: "database", label: "Banco de dados (Supabase Postgres)" }
  if (!process.env.DATABASE_URL) {
    return { ...base, status: "error", latency_ms: null, diagnosis: "config", message: "DATABASE_URL não configurada" }
  }
  const started = Date.now()
  try {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    await withTimeout(pg.raw("SELECT 1"))
    return { ...base, status: "ok", latency_ms: Date.now() - started, diagnosis: null, message: "Conexão e consulta OK" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/password|authentication|permission denied/i.test(msg)) {
      return { ...base, status: "error", latency_ms: Date.now() - started, diagnosis: "auth", message: `Credenciais do banco rejeitadas: ${msg}` }
    }
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed out|terminat/i.test(msg)) {
      return { ...base, status: "error", latency_ms: Date.now() - started, diagnosis: "network", message: `Banco inacessível (projeto Supabase pausado ou DATABASE_URL incorreta): ${msg}` }
    }
    return { ...base, status: "error", latency_ms: Date.now() - started, diagnosis: "service", message: msg }
  }
}

async function checkStripe(): Promise<ServiceCheck> {
  const base = { service: "stripe", label: "Pagamentos (Stripe)" }
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    return { ...base, status: "not_configured", latency_ms: null, diagnosis: "config", message: "STRIPE_SECRET_KEY não configurada — checkout indisponível" }
  }
  const started = Date.now()
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    const latency = Date.now() - started
    if (res.status === 401) {
      return { ...base, status: "error", latency_ms: latency, diagnosis: "auth", message: "Chave Stripe rejeitada (revogada ou incorreta)" }
    }
    if (!res.ok) {
      return { ...base, status: "error", latency_ms: latency, diagnosis: "service", message: `Stripe respondeu HTTP ${res.status}` }
    }
    const warnings: string[] = []
    if (key.startsWith("sk_test_") && process.env.NODE_ENV === "production") {
      warnings.push("chave de TESTE em produção")
    }
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      warnings.push("STRIPE_WEBHOOK_SECRET ausente — confirmações de pagamento podem falhar")
    }
    return warnings.length
      ? { ...base, status: "degraded", latency_ms: latency, diagnosis: "config", message: `API OK, mas: ${warnings.join("; ")}` }
      : { ...base, status: "ok", latency_ms: latency, diagnosis: null, message: "API autenticada e respondendo" }
  } catch (err) {
    return { ...base, status: "error", latency_ms: Date.now() - started, ...classifyFetchError(err) }
  }
}

async function checkResend(): Promise<ServiceCheck> {
  const base = { service: "resend", label: "E-mails (Resend)" }
  const key = process.env.RESEND_API_KEY
  if (!key) {
    return { ...base, status: "not_configured", latency_ms: null, diagnosis: "config", message: "RESEND_API_KEY não configurada — nenhum e-mail é enviado" }
  }
  const started = Date.now()
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    const latency = Date.now() - started
    if (res.status === 401) {
      return { ...base, status: "error", latency_ms: latency, diagnosis: "auth", message: "Chave Resend rejeitada (revogada ou incorreta)" }
    }
    if (!res.ok) {
      return { ...base, status: "error", latency_ms: latency, diagnosis: "service", message: `Resend respondeu HTTP ${res.status}` }
    }
    // Confirm the sender address domain is registered and verified in Resend
    const from = process.env.RESEND_FROM || "noreply@cacaudoceu.com.br"
    const fromDomain = from.match(/@([^>\s]+)/)?.[1]
    const body = (await res.json()) as { data?: Array<{ name: string; status: string }> }
    const domain = body.data?.find((d) => d.name === fromDomain)
    if (!domain) {
      return { ...base, status: "degraded", latency_ms: latency, diagnosis: "config", message: `Domínio remetente "${fromDomain}" não cadastrado no Resend — envios serão recusados` }
    }
    if (domain.status !== "verified") {
      return { ...base, status: "degraded", latency_ms: latency, diagnosis: "config", message: `Domínio "${fromDomain}" cadastrado mas não verificado (status: ${domain.status}) — confira os registros DNS` }
    }
    return { ...base, status: "ok", latency_ms: latency, diagnosis: null, message: `API OK, domínio "${fromDomain}" verificado` }
  } catch (err) {
    return { ...base, status: "error", latency_ms: Date.now() - started, ...classifyFetchError(err) }
  }
}

async function checkMelhorEnvio(): Promise<ServiceCheck> {
  const base = { service: "melhor_envio", label: "Frete (Melhor Envio)" }
  const token = process.env.MELHOR_ENVIO_TOKEN
  if (!token) {
    return { ...base, status: "not_configured", latency_ms: null, diagnosis: "config", message: "MELHOR_ENVIO_TOKEN não configurado — usando tabela de frete fixa (fallback)" }
  }
  const apiBase = process.env.MELHOR_ENVIO_SANDBOX === "true"
    ? "https://sandbox.melhorenvio.com.br/api/v2"
    : "https://www.melhorenvio.com.br/api/v2"
  const started = Date.now()
  try {
    const res = await fetch(`${apiBase}/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "Cacau do Céu (beraldo.felipe@gmail.com)",
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    const latency = Date.now() - started
    if (res.status === 401) {
      return { ...base, status: "error", latency_ms: latency, diagnosis: "auth", message: "Token rejeitado — tokens do Melhor Envio expiram em 30 dias; gere um novo no painel deles. Enquanto isso o frete usa a tabela fixa." }
    }
    if (!res.ok) {
      return { ...base, status: "error", latency_ms: latency, diagnosis: "service", message: `Melhor Envio respondeu HTTP ${res.status}` }
    }
    return { ...base, status: "ok", latency_ms: latency, diagnosis: null, message: "API autenticada — cotações de frete em tempo real ativas" }
  } catch (err) {
    return { ...base, status: "error", latency_ms: Date.now() - started, ...classifyFetchError(err) }
  }
}

export async function runHealthChecks(container: MedusaContainer): Promise<ServiceCheck[]> {
  return Promise.all([
    checkDatabase(container),
    checkStripe(),
    checkResend(),
    checkMelhorEnvio(),
  ])
}

export function overallStatus(checks: ServiceCheck[]): "ok" | "degraded" | "error" {
  if (checks.some((c) => c.status === "error")) return "error"
  if (checks.some((c) => c.status === "degraded" || c.status === "not_configured")) return "degraded"
  return "ok"
}

// Presence-only report of every env var the app depends on (never the values)
export function configReport(): Array<{ name: string; set: boolean; required: boolean }> {
  const required = [
    "DATABASE_URL", "JWT_SECRET", "COOKIE_SECRET",
    "STORE_CORS", "ADMIN_CORS", "AUTH_CORS",
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  ]
  const optional = [
    "RESEND_API_KEY", "RESEND_FROM",
    "MELHOR_ENVIO_TOKEN", "MELHOR_ENVIO_SANDBOX",
    "MELHOR_ENVIO_FROM_DOCUMENT", "MELHOR_ENVIO_FROM_CNPJ",
    "MEDUSA_BACKEND_URL", "STORE_URL", "ADMIN_REPORT_EMAIL",
  ]
  return [
    ...required.map((name) => ({ name, set: !!process.env[name], required: true })),
    ...optional.map((name) => ({ name, set: !!process.env[name], required: false })),
  ]
}
