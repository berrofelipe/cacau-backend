import type { MedusaRequest, MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { Resend } from "resend"
import crypto from "crypto"
import { buildEmailVerificationEmail } from "../../../utils/email"

function signToken(payload: Record<string, unknown>): string {
  const secret = process.env.JWT_SECRET || "supersecret"
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url")
  return `${data}.${sig}`
}

export async function POST(req: MedusaStoreRequest, res: MedusaResponse) {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    return res.status(401).json({ customerUserErrors: [{ code: "UNAUTHORIZED", message: "Não autenticado." }] })
  }

  const { newEmail, password } = req.body as { newEmail?: string; password?: string }
  if (!newEmail || !password) {
    return res.status(400).json({ customerUserErrors: [{ code: "INVALID", message: "Campos obrigatórios: newEmail, password." }] })
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER)
  const customer = await customerModule.retrieveCustomer(actorId)

  const authModule = req.scope.resolve(Modules.AUTH)
  const authResult = await authModule.authenticate("emailpass", {
    headers: req.headers as Record<string, string>,
    query: {},
    body: { email: customer.email, password },
  })
  if (!authResult.success) {
    return res.status(401).json({ customerUserErrors: [{ code: "INVALID", message: "Senha incorreta." }] })
  }

  const payload = {
    customerId: actorId,
    authIdentityId: req.auth_context!.auth_identity_id,
    newEmail,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  }
  const token = signToken(payload)

  const storeUrl = process.env.STORE_URL || "https://cacaudoceu.com.br"
  const verifyLink = `${storeUrl}/conta/verificar-email?token=${encodeURIComponent(token)}`

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    return res.status(500).json({ customerUserErrors: [{ code: "INVALID", message: "Serviço de e-mail não configurado." }] })
  }

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
    to: newEmail,
    subject: "Confirme seu novo e-mail — Cacau do Céu",
    html: buildEmailVerificationEmail(verifyLink, newEmail),
  })

  if (error) {
    console.error("[request-email-change] Erro ao enviar e-mail:", error)
    return res.status(500).json({ customerUserErrors: [{ code: "INVALID", message: "Erro ao enviar e-mail de verificação." }] })
  }

  console.log(`[request-email-change] Verificação enviada para ${newEmail}`)
  res.json({ ok: true })
}
