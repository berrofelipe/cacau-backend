import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"

// Baseline security response headers for the storefront and auth APIs. Deliberately
// conservative — no Content-Security-Policy here, since the JSON APIs don't need one
// and a strict CSP risks breaking the Vite-served admin panel. CSP for the static
// storefront is better set at the Vercel/Cloudflare edge.
export function securityHeaders(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
  // Only meaningful over HTTPS; harmless on http during local dev.
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
  next()
}
