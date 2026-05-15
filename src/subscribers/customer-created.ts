import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { Resend } from "resend"
import { buildWelcomeEmail } from "../utils/email"

export default async function customerCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[customer-created] RESEND_API_KEY não configurada — pulando e-mail de boas-vindas.")
    return
  }

  try {
    const customerModule = container.resolve(Modules.CUSTOMER)
    const customer = await customerModule.retrieveCustomer(data.id)
    const storeUrl = process.env.STORE_URL || "https://cacaudoceu.com.br"

    const resend = new Resend(resendKey)
    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
      to: customer.email,
      subject: "Bem-vindo à Cacau do Céu",
      html: buildWelcomeEmail(customer.first_name || "", storeUrl),
    })

    if (error) {
      console.error("[customer-created] Erro ao enviar e-mail:", error)
    } else {
      console.log(`[customer-created] E-mail de boas-vindas enviado para ${customer.email}`)
    }
  } catch (err) {
    console.error("[customer-created] Erro:", err)
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
