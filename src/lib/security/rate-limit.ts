import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { clientIp } from "./ip"

// Lightweight fixed-window rate limiter, keyed by route + client IP. In-memory by
// design: Cloudflare's edge rate-limiting rules (see SECURITY.md) are the primary,
// distributed layer; this is per-instance defense-in-depth that also covers the
// window where traffic reaches the origin directly. If the backend is ever scaled
// to multiple Railway instances, back this with Redis (rate-limit-redis) instead.

type Bucket = { count: number; resetAt: number }

type Options = {
  windowMs: number
  max: number
  message?: string
  // Distinguishes buckets when several limiters guard related routes.
  name?: string
}

const DEFAULT_MESSAGE = "Muitas requisições em pouco tempo. Aguarde um momento e tente novamente."

export function rateLimit(options: Options) {
  const { windowMs, max, message = DEFAULT_MESSAGE, name = "rl" } = options
  const buckets = new Map<string, Bucket>()

  // Periodic sweep so the map can't grow unbounded under attack. Unref'd so it
  // never keeps the process alive on shutdown.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key)
  }, Math.max(windowMs, 60_000))
  if (typeof sweep.unref === "function") sweep.unref()

  return function rateLimitMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    const key = `${name}:${clientIp(req)}`
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count++

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    res.setHeader("RateLimit-Limit", String(max))
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)))
    res.setHeader("RateLimit-Reset", String(retryAfter))

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfter))
      return res.status(429).json({ error: "rate_limited", message })
    }

    next()
  }
}
