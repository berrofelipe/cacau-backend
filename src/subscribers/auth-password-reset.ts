import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Resend } from "resend"
import { buildPasswordResetEmail } from "../utils/email"

export default async function authPasswordResetHandler({
  event: { data },
}: SubscriberArgs<{ entity_id: string; actor_type: string; token: string }>) {
  if (data.actor_type !== "customer") return

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[auth-password-reset] RESEND_API_KEY não configurada")
    return
  }

  const storeUrl = process.env.STORE_URL || "https://cacaudoceu.com.br"
  console.log(`[auth-password-reset] STORE_URL=${storeUrl}`)
  const resetLink = `${storeUrl}/conta/nova-senha?token=${encodeURIComponent(data.token)}`

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
    to: data.entity_id,
    subject: "Redefinição de senha — Cacau do Céu",
    html: buildPasswordResetEmail(resetLink),
  })

  if (error) {
    console.error("[auth-password-reset] Erro ao enviar e-mail:", error)
  } else {
    console.log(`[auth-password-reset] Link de redefinição enviado para ${data.entity_id}`)
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
