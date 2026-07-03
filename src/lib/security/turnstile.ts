import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { clientIp } from "./ip"

// Cloudflare Turnstile verification. The widget on the frontend produces a token
// that the client sends in the `x-turnstile-token` header (kept out of the body so
// it never collides with Medusa's request schemas). We verify it server-side
// against Cloudflare's siteverify endpoint.
//
// Progressive rollout: if TURNSTILE_SECRET_KEY is not set, verification is skipped
// so dev/staging and the period before keys are provisioned keep working. Once the
// secret is set in Railway, the check is enforced.
//
// Transient Cloudflare outages fail OPEN (request proceeds): rate limiting and
// account lockout still defend the endpoint, so we don't lock every user out of
// login if siteverify is briefly unreachable.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export function requireTurnstile() {
  return async function turnstileMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    const secret = process.env.TURNSTILE_SECRET_KEY
    if (!secret) return next() // not configured yet — skip

    const header = req.headers["x-turnstile-token"]
    const token = (typeof header === "string" && header) || (req.body as any)?.turnstileToken
    if (!token) {
      return res.status(400).json({
        error: "captcha_required",
        message: "Verificação de segurança ausente. Recarregue a página e tente novamente.",
      })
    }

    try {
      const form = new URLSearchParams()
      form.append("secret", secret)
      form.append("response", String(token))
      form.append("remoteip", clientIp(req))

      const r = await fetch(SITEVERIFY, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(8000),
      })
      const data: any = await r.json()

      if (!data?.success) {
        console.warn("[turnstile] verificação falhou:", data?.["error-codes"])
        return res.status(403).json({
          error: "captcha_failed",
          message: "Falha na verificação de segurança. Recarregue a página e tente novamente.",
        })
      }
      next()
    } catch (err) {
      // Fail open on a Cloudflare/network outage — defense-in-depth still applies.
      console.error("[turnstile] erro ao verificar token (prosseguindo):", (err as Error).message)
      next()
    }
  }
}
