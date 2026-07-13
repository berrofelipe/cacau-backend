import { createHash } from "crypto"

// Pure mapping functions from a Medusa order (retrieved with the
// items / shipping_address / shipping_methods relations) to Omie API payloads.
// Kept free of I/O so they can be unit-tested.

export type OmiePedidoOptions = {
  etapa: string                 // Omie sales-order stage the order lands in
  codigoParcela: string         // payment-terms code ("000" = à vista)
  codigoCategoria?: string      // Omie revenue category (e.g. "1.01.02")
  codigoContaCorrente?: number  // Omie bank/current account id
  freteModalidade: string       // NF-e modFrete ("0" = CIF/emitente)
}

export function omiePedidoOptionsFromEnv(): OmiePedidoOptions {
  return {
    etapa: process.env.OMIE_ETAPA || "10",
    codigoParcela: process.env.OMIE_CODIGO_PARCELA || "000",
    codigoCategoria: process.env.OMIE_CODIGO_CATEGORIA || undefined,
    codigoContaCorrente: process.env.OMIE_CODIGO_CONTA_CORRENTE
      ? Number(process.env.OMIE_CODIGO_CONTA_CORRENTE)
      : undefined,
    freteModalidade: process.env.OMIE_FRETE_MODALIDADE || "0",
  }
}

// Medusa v2 amounts may come back as raw numbers or BigNumber-ish objects
export function toNum(v: any): number {
  return Number(typeof v === "object" && v !== null && "value" in v ? v.value : v) || 0
}

// Full checksum validation — an invalid document would make Omie reject the
// NF-e later, so it's treated the same as no document at all.
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const check = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10])
}

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((s, w, i) => s + w * Number(digits[i]), 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13])
}

export function cpfCnpjFromOrder(order: any): string | null {
  const raw = order?.shipping_address?.metadata?.cpf || order?.metadata?.cpf
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, "")
  if (digits.length === 11 && isValidCpf(digits)) return digits
  if (digits.length === 14 && isValidCnpj(digits)) return digits
  return null
}

// Stable per-customer integration code. Omie integration codes have tight
// length limits, so hash the email instead of embedding it.
export function clienteIntegrationCode(email: string): string {
  return "CDC" + createHash("sha1").update(email.trim().toLowerCase()).digest("hex").slice(0, 12).toUpperCase()
}

// Per-order integration code — display_id is short, unique and stable, and
// Omie rejects a second order with the same code, which gives us idempotency.
export function pedidoIntegrationCode(order: any): string {
  return `CDCWEB-${order.display_id}`
}

function splitPhone(phone: string | null | undefined): { ddd: string; numero: string } | null {
  let digits = String(phone || "").replace(/\D/g, "")
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2)
  if (digits.length < 10) return null
  return { ddd: digits.slice(0, 2), numero: digits.slice(2) }
}

// The checkout writes "Rua X, 123" into address_1 and "Bairro — complemento"
// into address_2; Omie wants each part in its own field.
function splitStreet(address1: string): { endereco: string; numero: string } {
  const m = String(address1 || "").match(/^(.*),\s*(\S[^,]*)$/)
  if (m) return { endereco: m[1].trim(), numero: m[2].trim() }
  return { endereco: String(address1 || "").trim(), numero: "S/N" }
}

function splitBairro(address2: string): { bairro: string; complemento: string } {
  const [bairro = "", ...rest] = String(address2 || "").split(" — ")
  return { bairro: bairro.trim(), complemento: rest.join(" — ").trim() }
}

function todayBrazil(): string {
  const d = new Date()
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" })
  return fmt.format(d) // dd/mm/aaaa
}

export function buildUpsertClientePayload(order: any): Record<string, unknown> {
  const addr = order.shipping_address || {}
  const email = order.email
  const cpfCnpj = cpfCnpjFromOrder(order)
  const nome = [addr.first_name, addr.last_name].filter(Boolean).join(" ").slice(0, 60) || email
  const { endereco, numero } = splitStreet(addr.address_1)
  const { bairro, complemento } = splitBairro(addr.address_2)
  const phone = splitPhone(addr.phone)

  return {
    codigo_cliente_integracao: clienteIntegrationCode(email),
    razao_social: nome,
    nome_fantasia: nome,
    email,
    ...(cpfCnpj ? { cnpj_cpf: cpfCnpj, pessoa_fisica: cpfCnpj.length === 11 ? "S" : "N" } : { pessoa_fisica: "S" }),
    ...(phone ? { telefone1_ddd: phone.ddd, telefone1_numero: phone.numero } : {}),
    endereco,
    endereco_numero: numero,
    ...(complemento ? { complemento } : {}),
    bairro,
    cidade: String(addr.city || "").toUpperCase(),
    estado: String(addr.province || "").toUpperCase(),
    cep: String(addr.postal_code || "").replace(/\D/g, ""),
  }
}

export function buildIncluirPedidoPayload(
  order: any,
  codigoClienteOmie: number,
  opts: OmiePedidoOptions
): Record<string, unknown> {
  const items = order.items || []
  if (items.length === 0) throw new Error(`Pedido ${order.id} sem itens`)

  const missingSku = items.filter((i: any) => !i.variant_sku)
  if (missingSku.length > 0) {
    const titles = missingSku.map((i: any) => i.title || i.product_title).join(", ")
    throw new Error(
      `Itens sem SKU não podem ser enviados ao Omie (o SKU do Medusa deve ser igual ao código do produto no Omie): ${titles}`
    )
  }

  const shippingTotal = (order.shipping_methods || []).reduce(
    (s: number, m: any) => s + toNum(m.amount),
    0
  )

  return {
    cabecalho: {
      codigo_cliente: codigoClienteOmie,
      codigo_pedido_integracao: pedidoIntegrationCode(order),
      data_previsao: todayBrazil(),
      etapa: opts.etapa,
      codigo_parcela: opts.codigoParcela,
      quantidade_itens: items.length,
    },
    det: items.map((item: any, idx: number) => ({
      ide: { codigo_item_integracao: String(idx + 1) },
      produto: {
        codigo: item.variant_sku,
        quantidade: item.quantity || 1,
        valor_unitario: toNum(item.unit_price),
      },
    })),
    ...(shippingTotal > 0
      ? { frete: { modalidade: opts.freteModalidade, valor_frete: shippingTotal } }
      : {}),
    informacoes_adicionais: {
      ...(opts.codigoCategoria ? { codigo_categoria: opts.codigoCategoria } : {}),
      ...(opts.codigoContaCorrente ? { codigo_conta_corrente: opts.codigoContaCorrente } : {}),
      consumidor_final: "S",
      enviar_email: "N",
      numero_pedido_cliente: String(order.display_id ?? ""),
    },
    observacoes: {
      obs_venda: `Pedido do site #${order.display_id} (${order.id})`,
    },
  }
}
