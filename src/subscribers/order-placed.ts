import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { Resend } from "resend"
import { buildOrderConfirmationEmail } from "../utils/email"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[order-placed] RESEND_API_KEY não configurada")
    return
  }

  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(data.id, {
    relations: ["items", "shipping_address", "shipping_methods"],
  })

  const email = order.email
  if (!email) {
    console.warn(`[order-placed] Pedido ${data.id} sem e-mail`)
    return
  }

  const storeUrl = process.env.STORE_URL || "https://cacaudoceu.com.br"

  const toNum = (v: any): number => Number(
    typeof v === "object" && v !== null && "value" in v ? v.value : v
  ) || 0

  const html = buildOrderConfirmationEmail({
    displayId:    order.display_id || data.id.slice(0, 8).toUpperCase(),
    email,
    firstName:    order.shipping_address?.first_name || "",
    items: (order.items || []).map((item: any) => ({
      title:     item.title || item.product_title || "",
      quantity:  item.quantity || 1,
      unitPrice: toNum(item.unit_price),
    })),
    subtotal:     toNum(order.subtotal),
    shippingTotal:toNum(order.shipping_total),
    total:        toNum(order.total),
    shippingAddress: order.shipping_address ? {
      address1: order.shipping_address.address_1 || "",
      address2: order.shipping_address.address_2 || "",
      city:     order.shipping_address.city      || "",
      province: order.shipping_address.province  || "",
      zip:      order.shipping_address.postal_code || "",
    } : null,
    storeUrl,
  })

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from:    process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
    to:      email,
    subject: `Pedido #${order.display_id} confirmado — Cacau do Céu`,
    html,
  })

  if (error) {
    console.error("[order-placed] Erro ao enviar e-mail:", error)
  } else {
    console.log(`[order-placed] Confirmação enviada para ${email} (pedido #${order.display_id})`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
