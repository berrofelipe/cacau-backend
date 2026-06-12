import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ChartActivity, ArrowPath } from "@medusajs/icons"
import { Badge, Button, Container, Heading, StatusBadge, Text } from "@medusajs/ui"
import { useCallback, useEffect, useState } from "react"

// Renders /admin/health-status (auth-gated by the admin session this page
// already runs under). Shows per-service status, latency, and where the
// connection is broken when something fails.

type Diagnosis = "config" | "network" | "auth" | "service" | null

type ServiceCheck = {
  service: string
  label: string
  status: "ok" | "degraded" | "error" | "not_configured"
  latency_ms: number | null
  message: string
  diagnosis: Diagnosis
}

type HealthReport = {
  status: "ok" | "degraded" | "error"
  checked_at: string
  uptime_seconds: number
  node_env: string
  checks: ServiceCheck[]
  config: Array<{ name: string; set: boolean; required: boolean }>
  monitor: {
    consecutive_failures: number
    alerted: boolean
    last_run_at: string | null
    last_failing: string[]
    alert_threshold: number
    interval_minutes: number
    alert_email: string
  }
}

const STATUS_COLOR: Record<ServiceCheck["status"], "green" | "orange" | "red" | "grey"> = {
  ok: "green",
  degraded: "orange",
  error: "red",
  not_configured: "grey",
}

const STATUS_LABEL: Record<ServiceCheck["status"], string> = {
  ok: "Operacional",
  degraded: "Degradado",
  error: "Falha",
  not_configured: "Não configurado",
}

const DIAGNOSIS_LABEL: Record<Exclude<Diagnosis, null>, string> = {
  config: "Configuração (variável de ambiente)",
  network: "Rede (serviço inacessível)",
  auth: "Credenciais (chave/token rejeitado)",
  service: "Serviço (erro do provedor)",
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}min`
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}

const HealthPage = () => {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/admin/health-status", { credentials: "include" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">Saúde do sistema</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Verificação ao vivo de cada serviço externo. Atualiza a cada minuto.
            </Text>
          </div>
          <div className="flex items-center gap-x-3">
            {report && (
              <StatusBadge color={report.status === "ok" ? "green" : report.status === "degraded" ? "orange" : "red"}>
                {report.status === "ok" ? "Tudo operacional" : report.status === "degraded" ? "Atenção" : "Falha detectada"}
              </StatusBadge>
            )}
            <Button size="small" variant="secondary" onClick={load} isLoading={loading}>
              <ArrowPath />
              Verificar agora
            </Button>
          </div>
        </div>

        {error && (
          <div className="px-6 py-4">
            <Text className="text-ui-fg-error">Não foi possível consultar o diagnóstico: {error}</Text>
          </div>
        )}

        {report?.checks.map((check) => (
          <div key={check.service} className="flex flex-col gap-y-1 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-x-3">
                <StatusBadge color={STATUS_COLOR[check.status]}>{STATUS_LABEL[check.status]}</StatusBadge>
                <Text weight="plus">{check.label}</Text>
              </div>
              {check.latency_ms !== null && (
                <Text size="small" className="text-ui-fg-subtle">
                  {check.latency_ms} ms
                </Text>
              )}
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              {check.message}
            </Text>
            {check.diagnosis && check.status !== "ok" && (
              <div>
                <Badge size="2xsmall" color={check.diagnosis === "config" ? "grey" : "red"}>
                  Onde quebrou: {DIAGNOSIS_LABEL[check.diagnosis]}
                </Badge>
              </div>
            )}
          </div>
        ))}

        {report && (
          <div className="flex items-center gap-x-6 px-6 py-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              Ambiente: {report.node_env}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              Servidor no ar há {formatUptime(report.uptime_seconds)}
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              Última verificação: {new Date(report.checked_at).toLocaleTimeString("pt-BR")}
            </Text>
          </div>
        )}
      </Container>

      {report?.monitor && (
        <Container className="divide-y p-0">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <Heading level="h2">Monitor automático</Heading>
              <Text className="text-ui-fg-subtle" size="small">
                Verifica os serviços a cada {report.monitor.interval_minutes} min no servidor e envia e-mail para{" "}
                <span className="font-medium">{report.monitor.alert_email}</span> após{" "}
                {report.monitor.alert_threshold} falhas consecutivas (configurável via ADMIN_REPORT_EMAIL).
              </Text>
            </div>
            <StatusBadge
              color={report.monitor.alerted ? "red" : report.monitor.consecutive_failures > 0 ? "orange" : "green"}
            >
              {report.monitor.alerted
                ? "Alerta enviado — aguardando recuperação"
                : report.monitor.consecutive_failures > 0
                  ? `Falhas: ${report.monitor.consecutive_failures}/${report.monitor.alert_threshold}`
                  : "Vigiando"}
            </StatusBadge>
          </div>
          <div className="flex items-center gap-x-6 px-6 py-3">
            <Text size="xsmall" className="text-ui-fg-muted">
              Última rodada do monitor:{" "}
              {report.monitor.last_run_at
                ? new Date(report.monitor.last_run_at).toLocaleTimeString("pt-BR")
                : "ainda não rodou (roda a cada 5 min)"}
            </Text>
            {report.monitor.last_failing.length > 0 && (
              <Text size="xsmall" className="text-ui-fg-error">
                Falhando: {report.monitor.last_failing.join(", ")}
              </Text>
            )}
          </div>
        </Container>
      )}

      {report && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Variáveis de ambiente</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Apenas presença — os valores nunca são expostos.
            </Text>
          </div>
          <div className="grid grid-cols-2 gap-2 px-6 py-4 md:grid-cols-3">
            {report.config.map((entry) => (
              <div key={entry.name} className="flex items-center gap-x-2">
                <StatusBadge color={entry.set ? "green" : entry.required ? "red" : "grey"} />
                <Text size="small" className={entry.set ? "" : "text-ui-fg-subtle"}>
                  {entry.name}
                  {!entry.required && (
                    <span className="text-ui-fg-muted"> (opcional)</span>
                  )}
                </Text>
              </div>
            ))}
          </div>
        </Container>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Saúde do sistema",
  icon: ChartActivity,
})

export default HealthPage
