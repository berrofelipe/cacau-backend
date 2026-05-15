import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils"

// Dimensions per chocolate bar/bombom unit
const UNIT_WEIGHT_KG  = 0.15  // 150g
const UNIT_HEIGHT_CM  = 3
const UNIT_WIDTH_CM   = 12
const UNIT_LENGTH_CM  = 17

const ORIGIN_ZIP = "37540000" // Santa Rita do Sapucaí, MG

const ME_PROD    = "https://www.melhorenvio.com.br/api/v2"
const ME_SANDBOX = "https://sandbox.melhorenvio.com.br/api/v2"

// Flat rates (cents) used when MELHOR_ENVIO_TOKEN is not configured
const FLAT_RATES: Record<string, number> = {
  pac:             2800,
  sedex:           4800,
  "sedex-10":      6500,
  "jadlog-package":3200,
  "jadlog-com":    2500,
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
      const rows  = Math.ceil(Math.sqrt(qty))

      const insuranceValue = items.reduce(
        (s: number, i: any) => s + ((i.unit_price ?? 0) / 100) * (i.quantity ?? 1), 0
      )

      const body = {
        from:    { postal_code: ORIGIN_ZIP },
        to:      { postal_code: destZip },
        package: {
          height: Math.max(UNIT_HEIGHT_CM * rows, UNIT_HEIGHT_CM),
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
        return {
          calculated_amount: Math.round(parseFloat(match.price) * 100),
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

  async createFulfillment(
    data: Record<string, unknown>,
    _items: any[],
    _order: any,
    _fulfillment: any
  ) {
    return { data, labels: [] }
  }

  async cancelFulfillment(data: Record<string, unknown>) {
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
