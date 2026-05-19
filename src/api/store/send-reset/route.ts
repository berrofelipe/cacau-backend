import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Resend } from "resend"
import { buildPasswordResetEmail } from "../../../utils/email"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { email, token } = req.body as { email?: string; token?: string }

  if (!email || !token) {
    return res.status(400).json({ error: "Missing email or token" })
  }

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[send-reset] RESEND_API_KEY não configurada")
    return res.status(500).json({ error: "Email service not configured" })
  }

  const storeUrl = process.env.STORE_URL || "http://localhost:5173"
  const resetLink = `${storeUrl}/conta/nova-senha?token=${encodeURIComponent(token)}`

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
    to: email,
    subject: "Redefinição de senha — Cacau do Céu",
    html: buildPasswordResetEmail(resetLink),
  })

  if (error) {
    console.error("[send-reset] Erro ao enviar e-mail:", error)
    return res.status(500).json({ error: error.message })
  }

  console.log(`[send-reset] E-mail de redefinição enviado para ${email}`)
  res.json({ ok: true })
}
