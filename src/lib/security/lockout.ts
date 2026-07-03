import type { MedusaRequest, MedusaResponse, MedusaNextFunction } from "@medusajs/framework/http"
import { clientIp } from "./ip"

// Account-aware brute-force lockout for the login route. Rate limiting alone keys
// on IP; this also keys on the targeted email so a slow, distributed attack on a
// single account still trips a lock. Counting happens on the response: a 401
// (invalid credentials) increments, a 2xx (successful login) clears the record.
//
// In-memory and per-instance — same rationale as rate-limit.ts. The lock window is
// short enough that a legitimate user is only briefly inconvenienced after many
// failures, but long enough to make online guessing impractical.

const MAX_FAILS  = 5
const LOCK_MS    = 15 * 60 * 1000 // lock duration once the threshold is hit
const WINDOW_MS  = 15 * 60 * 1000 // failures older than this no longer count

type Record_ = { fails: number; firstFailAt: number; lockedUntil: number }

const store = new Map<string, Record_>()

const sweep = setInterval(() => {
  const now = Date.now()
  for (const [key, r] of store) {
    if (r.lockedUntil <= now && r.firstFailAt + WINDOW_MS <= now) store.delete(key)
  }
}, WINDOW_MS)
if (typeof sweep.unref === "function") sweep.unref()

function keyFor(req: MedusaRequest): string {
  const email = String((req.body as any)?.email || "").toLowerCase().trim()
  return `${email}|${clientIp(req)}`
}

export function loginLockout(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const key = keyFor(req)
  const now = Date.now()
  const rec = store.get(key)

  if (rec && rec.lockedUntil > now) {
    const secs = Math.ceil((rec.lockedUntil - now) / 1000)
    res.setHeader("Retry-After", String(secs))
    return res.status(429).json({
      error: "account_locked",
      message: `Muitas tentativas de login. Tente novamente em ${Math.ceil(secs / 60)} minuto(s).`,
    })
  }

  // Record the outcome once the auth handler has run.
  res.on("finish", () => {
    const code = res.statusCode
    if (code >= 200 && code < 300) {
      store.delete(key) // success wipes the slate
      return
    }
    // Only failed credentials count toward a lock — not validation/limit errors.
    if (code !== 401) return

    const ts = Date.now()
    let r = store.get(key)
    if (!r || r.firstFailAt + WINDOW_MS <= ts) {
      r = { fails: 0, firstFailAt: ts, lockedUntil: 0 }
    }
    r.fails++
    if (r.fails >= MAX_FAILS) r.lockedUntil = ts + LOCK_MS
    store.set(key, r)
  })

  next()
}
