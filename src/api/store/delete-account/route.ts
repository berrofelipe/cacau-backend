import type { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

export async function POST(req: MedusaStoreRequest, res: MedusaResponse) {
  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    return res.status(401).json({ message: "Não autenticado." })
  }

  const authIdentityId = req.auth_context!.auth_identity_id

  try {
    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    await customerModule.deleteCustomers(actorId)
  } catch (err) {
    console.error("[delete-account] Erro ao excluir customer:", err)
    return res.status(500).json({ message: "Não foi possível excluir a conta. Tente novamente." })
  }

  try {
    const authModule = req.scope.resolve(Modules.AUTH)
    await authModule.deleteAuthIdentities([authIdentityId])
  } catch (err) {
    console.warn("[delete-account] Não foi possível excluir a identidade de auth:", err)
  }

  console.log(`[delete-account] Conta ${actorId} excluída`)
  res.json({ ok: true })
}
