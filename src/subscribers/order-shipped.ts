import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Resend } from "resend"
import { buildOrderShippedEmail } from "../utils/email"

// Fires on shipment.created — both when the Melhor Envio webhook marks the
// order posted and when the admin creates a shipment manually. Sends the
// customer the tracking email.

export default async function orderShippedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
  if (data.no_notification) return

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[order-shipped] RESEND_API_KEY não configurada")
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: [
      "id",
      "labels.tracking_number", "labels.tracking_url",
      "order.id", "order.email", "order.display_id",
      "order.shipping_address.first_name",
    ],
    filters: { id: data.id },
  })
  const ful: any = fulfillments?.[0]
  const email = ful?.order?.email
  if (!ful || !email) {
    console.warn(`[order-shipped] Fulfillment ${data.id} sem pedido/e-mail — pulando`)
    return
  }

  const label = (ful.labels || [])[0]
  const storeUrl = process.env.STORE_URL || "https://cacaudoceu.com.br"

  const html = buildOrderShippedEmail({
    displayId:      ful.order.display_id || ful.order.id,
    firstName:      ful.order.shipping_address?.first_name || "",
    trackingNumber: label?.tracking_number || "",
    trackingUrl:    label?.tracking_url || "",
    storeUrl,
  })

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from:    process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
    to:      email,
    subject: `Pedido #${ful.order.display_id} a caminho — Cacau do Céu`,
    html,
  })

  if (error) {
    console.error("[order-shipped] Erro ao enviar e-mail:", error)
  } else {
    console.log(`[order-shipped] Rastreio enviado para ${email} (pedido #${ful.order.display_id})`)
  }
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}
