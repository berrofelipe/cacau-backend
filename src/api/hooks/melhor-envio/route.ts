import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"

// Melhor Envio webhook (register the URL in their panel:
// https://cacaudoceu.site/hooks/melhor-envio). The payload is treated as an
// untrusted hint — we only act on state re-fetched from the ME API with our
// own token, so a forged request can't move an order to a false status.
//
// posted    → mark the fulfillment shipped (createOrderShipmentWorkflow,
//             which also emits shipment.created for the tracking email)
// delivered → mark the fulfillment delivered

const ME_PROD    = "https://www.melhorenvio.com.br/api/v2"
const ME_SANDBOX = "https://sandbox.melhorenvio.com.br/api/v2"

async function fetchMeOrder(id: string) {
  const base = process.env.MELHOR_ENVIO_SANDBOX === "true" ? ME_SANDBOX : ME_PROD
  const res = await fetch(`${base}/me/orders/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${process.env.MELHOR_ENVIO_TOKEN}`,
      Accept:        "application/json",
      "User-Agent":  "Cacau do Céu (ola@cacaudoceu.com.br)",
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  return res.json()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Always 200 so ME doesn't retry-storm; problems go to the logs.
  res.sendStatus(200)

  try {
    if (!process.env.MELHOR_ENVIO_TOKEN) return

    const body: any = req.body || {}
    const event = body.event || body.type || ""
    const meOrderId = body.data?.id ?? body.data?.[0]?.id ?? body.id
    if (!meOrderId) return

    if (!/posted|delivered/.test(event)) return

    const meOrder = await fetchMeOrder(String(meOrderId))
    if (!meOrder) {
      console.warn(`[me-webhook] Pedido ME ${meOrderId} não encontrado na API — ignorando (possível chamada forjada)`)
      return
    }

    // The fulfillment id travels as a tag set at label purchase time
    const fulfillmentId = (meOrder.tags || [])
      .map((t: any) => t?.tag)
      .find((t: string) => typeof t === "string" && t.startsWith("ful_"))
    if (!fulfillmentId) {
      console.warn(`[me-webhook] Pedido ME ${meOrderId} sem tag de fulfillment — ignorando`)
      return
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: fulfillments } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id", "shipped_at", "delivered_at",
        "items.line_item_id", "items.quantity",
        "order.id",
      ],
      filters: { id: fulfillmentId },
    })
    const ful = fulfillments?.[0]
    const orderId = (ful as any)?.order?.id
    if (!ful || !orderId) {
      console.warn(`[me-webhook] Fulfillment ${fulfillmentId} não encontrado no Medusa`)
      return
    }

    const status = meOrder.status || ""

    if (status === "posted" && !ful.shipped_at) {
      await createOrderShipmentWorkflow(req.scope).run({
        input: {
          order_id: orderId,
          fulfillment_id: ful.id,
          items: (ful.items || []).map((i: any) => ({
            id: i.line_item_id,
            quantity: i.quantity,
          })),
        },
      })
      console.log(`[me-webhook] Pedido ${orderId}: marcado como enviado (rastreio ${meOrder.tracking || "?"})`)
    } else if (status === "delivered" && !ful.delivered_at) {
      await markOrderFulfillmentAsDeliveredWorkflow(req.scope).run({
        input: { orderId, fulfillmentId: ful.id },
      })
      console.log(`[me-webhook] Pedido ${orderId}: marcado como entregue`)
    }
  } catch (err) {
    console.error("[me-webhook] Erro ao processar webhook:", (err as Error).message)
  }
}
