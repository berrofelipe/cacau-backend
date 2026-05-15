import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import crypto from "crypto"

function verifyToken(token: string): Record<string, unknown> | null {
  const secret = process.env.JWT_SECRET || "supersecret"
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [data, sig] = parts
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url")
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url"))) return null
  } catch {
    return null
  }
  return JSON.parse(Buffer.from(data, "base64url").toString())
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { token } = req.body as { token?: string }
  if (!token) {
    return res.status(400).json({ customerUserErrors: [{ code: "INVALID", message: "Token inválido." }] })
  }

  const payload = verifyToken(token)
  if (!payload) {
    return res.status(400).json({ customerUserErrors: [{ code: "INVALID", message: "Link inválido ou expirado." }] })
  }

  const { customerId, authIdentityId, newEmail, exp } = payload as {
    customerId: string
    authIdentityId: string
    newEmail: string
    exp: number
  }

  if (Date.now() > exp) {
    return res.status(400).json({ customerUserErrors: [{ code: "INVALID", message: "Link expirado. Solicite uma nova alteração de e-mail." }] })
  }

  // Update customer profile email
  const customerModule = req.scope.resolve(Modules.CUSTOMER)
  await customerModule.updateCustomers(customerId, { email: newEmail })

  // Update auth identity provider entity (login email)
  try {
    const authModule = req.scope.resolve(Modules.AUTH)
    const providerIdentities = await authModule.listProviderIdentities({
      auth_identity_id: authIdentityId,
      provider: "emailpass",
    })
    if (providerIdentities.length > 0) {
      await authModule.updateProviderIdentities([
        { id: providerIdentities[0].id, entity_id: newEmail },
      ])
    }
  } catch (err) {
    console.warn("[verify-email-change] Não foi possível atualizar a identidade de auth — login ainda usa e-mail antigo:", err)
  }

  console.log(`[verify-email-change] E-mail do cliente ${customerId} atualizado para ${newEmail}`)
  res.json({ ok: true })
}
