import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"

// Dimensions per chocolate bar/bombom unit
const UNIT_WEIGHT_KG  = 0.15  // 150g
const UNIT_HEIGHT_CM  = 3
const UNIT_WIDTH_CM   = 12
const UNIT_LENGTH_CM  = 17

const ORIGIN_ZIP = "01416000"

const ME_PROD    = "https://www.melhorenvio.com.br/api/v2"
const ME_SANDBOX = "https://sandbox.melhorenvio.com.br/api/v2"

// Flat rates (BRL) used when MELHOR_ENVIO_TOKEN is not configured
const FLAT_RATES: Record<string, number> = {
  pac:             28,
  sedex:           48,
  "sedex-10":      65,
  "jadlog-package":32,
  "jadlog-com":    25,
}

// Melhor Envio service IDs
const SERVICE_IDS: Record<string, number> = {
  pac:              1,
  sedex:            2,
  "sedex-10":       5,
  "jadlog-package": 7,
  "jadlog-com":     9,
}

type Options = {
  token?: string
  sandbox?: boolean
}

export class MelhorEnvioFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "melhor-envio"

  private token: string | undefined
  private apiBase: string

  constructor(_: Record<string, unknown>, options: Options = {}) {
    super()
    this.token   = options.token
    this.apiBase = options.sandbox ? ME_SANDBOX : ME_PROD
  }

  async getFulfillmentOptions() {
    return [
      { id: "pac",             name: "PAC — Correios",    data: {} },
      { id: "sedex",           name: "SEDEX — Correios",  data: {} },
      { id: "sedex-10",        name: "SEDEX 10",          data: {} },
      { id: "jadlog-package",  name: "Jadlog .Package",   data: {} },
      { id: "jadlog-com",      name: "Jadlog .COM",       data: {} },
    ]
  }

  async canCalculate(data: any) {
    return true
  }

  async calculatePrice(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    cart: Record<string, unknown>
  ) {
    const serviceId   = SERVICE_IDS[optionData.id as string]
    const flatFallback = {
      calculated_amount: FLAT_RATES[optionData.id as string] ?? 2800,
      is_calculated_price_tax_inclusive: false,
    }

    if (!this.token) return flatFallback

    const address = (cart as any).shipping_address
    const destZip  = (address?.postal_code as string)?.replace(/\D/g, "")
    if (!destZip) return flatFallback

    try {
      const items = ((cart as any).items ?? []) as any[]
      const qty   = items.reduce((s: number, i: any) => s + (i.quantity ?? 1), 0) || 1

      // unit_price is in BRL major units (not centavos) in Medusa v2
      const insuranceValue = items.reduce(
        (s: number, i: any) => s + (i.unit_price ?? 0) * (i.quantity ?? 1), 0
      )

      const body = {
        from:    { postal_code: ORIGIN_ZIP },
        to:      { postal_code: destZip },
        package: {
          height: Math.max(UNIT_HEIGHT_CM * qty, UNIT_HEIGHT_CM),
          width:  UNIT_WIDTH_CM,
          length: UNIT_LENGTH_CM,
          weight: Math.max(UNIT_WEIGHT_KG * qty, 0.1),
        },
        options: { insurance_value: insuranceValue, receipt: false, own_hand: false },
        services: String(serviceId),
      }

      const res = await fetch(`${this.apiBase}/me/shipment/calculate`, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept:         "application/json",
          "User-Agent":   "Cacau do Céu (ola@cacaudoceu.com.br)",
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error(`ME API ${res.status}`)
      const results: any[] = await res.json()
      const match = results.find((r: any) => r.id === serviceId && r.price)

      if (match?.price) {
        // Return in BRL major units — Medusa v2 passes this directly to getSmallestUnit
        return {
          calculated_amount: parseFloat(match.price),
          is_calculated_price_tax_inclusive: false,
        }
      }
    } catch (err) {
      console.warn("[melhor-envio] calculatePrice failed, using flat rate:", (err as Error).message)
    }

    return flatFallback
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ) {
    return data
  }

  async validateOption(data: Record<string, unknown>) {
    return true
  }

  // Authenticated request against the ME API; throws with the response body
  // on failure so errors surface the real reason (saldo, document, agency...)
  private async meFetch(path: string, init: RequestInit = {}) {
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization:  `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
        "User-Agent":   "Cacau do Céu (ola@cacaudoceu.com.br)",
        ...(init.headers || {}),
      },
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`ME ${path} → ${res.status}: ${text.slice(0, 500)}`)
    return text ? JSON.parse(text) : {}
  }

  // Splits "Rua das Flores, 123" → { street, number }. ME wants them apart.
  private splitStreet(address1: string | null | undefined) {
    const raw = (address1 || "").trim()
    const m = raw.match(/^(.*?)[,\s]+(\d+\w*)\s*$/)
    return m ? { street: m[1].trim(), number: m[2] } : { street: raw, number: "S/N" }
  }

  // Buys the shipping label on Melhor Envio: cart → checkout → generate.
  // Checkout debits the ME wallet balance. Any failure falls back to a
  // fulfillment without a label (manual mode) so the admin flow never blocks.
  async createFulfillment(
    data: Record<string, unknown>,
    items: any[],
    order: any,
    fulfillment: any
  ) {
    const manual = { data, labels: [] as any[] }
    if (!this.token) {
      console.warn("[melhor-envio] Sem MELHOR_ENVIO_TOKEN — etiqueta manual.")
      return manual
    }

    const document = process.env.MELHOR_ENVIO_FROM_DOCUMENT // CPF
    const cnpj     = process.env.MELHOR_ENVIO_FROM_CNPJ
    if (!document && !cnpj) {
      console.warn("[melhor-envio] MELHOR_ENVIO_FROM_DOCUMENT/CNPJ não configurado — compra automática de etiqueta desativada, criando fulfillment manual.")
      return manual
    }

    try {
      const serviceId = SERVICE_IDS[(data as any)?.id as string]
        ?? SERVICE_IDS[(fulfillment as any)?.shipping_option?.data?.id as string]
      const addr = order?.shipping_address
      if (!serviceId || !addr) throw new Error("serviço ou endereço ausente no pedido")

      const dest = this.splitStreet(addr.address_1)
      const qty  = (items ?? []).reduce((s, i) => s + (i.quantity ?? 1), 0) || 1
      const insuranceValue = (items ?? []).reduce(
        (s, i) => s + (i.unit_price ?? 0) * (i.quantity ?? 1), 0
      )

      const cartPayload = {
        service: serviceId,
        from: {
          name:             process.env.MELHOR_ENVIO_FROM_NAME  || "Cacau do Céu",
          email:            process.env.MELHOR_ENVIO_FROM_EMAIL || "ola@cacaudoceu.com.br",
          phone:            process.env.MELHOR_ENVIO_FROM_PHONE || "",
          ...(cnpj ? { company_document: cnpj } : { document }),
          address:          process.env.MELHOR_ENVIO_FROM_ADDRESS  || "",
          number:           process.env.MELHOR_ENVIO_FROM_NUMBER   || "S/N",
          district:         process.env.MELHOR_ENVIO_FROM_DISTRICT || "",
          city:             process.env.MELHOR_ENVIO_FROM_CITY     || "São Paulo",
          state_abbr:       process.env.MELHOR_ENVIO_FROM_STATE    || "SP",
          postal_code:      process.env.MELHOR_ENVIO_FROM_ZIP      || ORIGIN_ZIP,
        },
        to: {
          name:        [addr.first_name, addr.last_name].filter(Boolean).join(" ") || "Cliente",
          email:       order?.email || "",
          phone:       addr.phone || "",
          // CPF do destinatário, quando o checkout coletou (metadata.cpf)
          ...(addr.metadata?.cpf || order?.metadata?.cpf
            ? { document: String(addr.metadata?.cpf || order?.metadata?.cpf).replace(/\D/g, "") }
            : {}),
          address:     dest.street,
          number:      dest.number,
          complement:  addr.address_2 || "",
          city:        addr.city || "",
          state_abbr:  (addr.province || "").toUpperCase().slice(0, 2),
          postal_code: (addr.postal_code || "").replace(/\D/g, ""),
        },
        products: (items ?? []).map((i) => ({
          name:           i.title || "Chocolate",
          quantity:       i.quantity ?? 1,
          unitary_value:  i.unit_price ?? 0,
        })),
        volumes: [{
          height: Math.max(UNIT_HEIGHT_CM * qty, UNIT_HEIGHT_CM),
          width:  UNIT_WIDTH_CM,
          length: UNIT_LENGTH_CM,
          weight: Math.max(UNIT_WEIGHT_KG * qty, 0.1),
        }],
        options: {
          insurance_value: insuranceValue,
          receipt:         false,
          own_hand:        false,
          non_commercial:  true, // envio com declaração de conteúdo, sem NF-e
        },
        // Tag com o id do fulfillment — é como o webhook acha o pedido no Medusa
        tags: [{ tag: fulfillment?.id || order?.id || "", url: null }],
      }

      const cartItem = await this.meFetch("/me/cart", {
        method: "POST",
        body: JSON.stringify(cartPayload),
      })
      const meOrderId = cartItem.id
      if (!meOrderId) throw new Error("carrinho ME não retornou id")

      await this.meFetch("/me/shipment/checkout", {
        method: "POST",
        body: JSON.stringify({ orders: [meOrderId] }),
      })
      await this.meFetch("/me/shipment/generate", {
        method: "POST",
        body: JSON.stringify({ orders: [meOrderId] }),
      })

      // Re-fetch for tracking code + label URL
      const meOrder = await this.meFetch(`/me/orders/${meOrderId}`)
      const tracking = meOrder.tracking || meOrder.self_tracking || meOrder.protocol || ""

      console.log(`[melhor-envio] Etiqueta comprada: pedido ME ${meOrderId}, rastreio ${tracking || "(pendente)"}`)
      return {
        data: { ...data, melhor_envio_order_id: meOrderId, tracking_code: tracking },
        labels: [{
          tracking_number: tracking || meOrderId,
          tracking_url:    tracking ? `https://melhorrastreio.com.br/rastreio/${tracking}` : "",
          label_url:       `https://www.melhorenvio.com.br/orders/print?orders=${meOrderId}`,
        }],
      }
    } catch (err) {
      console.error("[melhor-envio] Compra automática de etiqueta falhou — fulfillment criado em modo manual:", (err as Error).message)
      return manual
    }
  }

  async cancelFulfillment(data: Record<string, unknown>) {
    const meOrderId = (data as any)?.melhor_envio_order_id
    if (this.token && meOrderId) {
      try {
        await this.meFetch("/me/shipment/cancel", {
          method: "POST",
          body: JSON.stringify({
            order: { id: meOrderId, reason_id: "2", description: "Cancelado pela loja" },
          }),
        })
        console.log(`[melhor-envio] Etiqueta ${meOrderId} cancelada no Melhor Envio`)
      } catch (err) {
        console.error("[melhor-envio] Falha ao cancelar etiqueta no ME (cancele manualmente no painel):", (err as Error).message)
      }
    }
    return {}
  }

  async getFulfillmentDocuments(_data: Record<string, unknown>) {
    return []
  }

  async getReturnDocuments(_data: Record<string, unknown>) {
    return []
  }

  async getShipmentDocuments(_data: Record<string, unknown>) {
    return []
  }

  async retrieveDocuments(
    _fulfillmentData: Record<string, unknown>,
    _documentType: string
  ): Promise<void> {
    return
  }
}

export default MelhorEnvioFulfillmentService
