import type { MedusaRequest } from "@medusajs/framework/http"

// Resolves the real client IP. Behind Cloudflare → Railway the socket address is
// a proxy, so we trust the proxy chain headers in priority order. CF-Connecting-IP
// is set by Cloudflare and cannot be spoofed by the client once the origin only
// accepts Cloudflare traffic (lock the Railway origin to Cloudflare IPs / a secret
// header — see SECURITY.md). X-Forwarded-For's first hop is the next fallback.
export function clientIp(req: MedusaRequest): string {
  const cf = req.headers["cf-connecting-ip"]
  if (typeof cf === "string" && cf.trim()) return cf.trim()

  const xff = req.headers["x-forwarded-for"]
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim()

  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown"
}
