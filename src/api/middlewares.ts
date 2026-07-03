import { defineMiddlewares } from "@medusajs/framework/http"
import { rateLimit } from "../lib/security/rate-limit"
import { loginLockout } from "../lib/security/lockout"
import { requireTurnstile } from "../lib/security/turnstile"
import { securityHeaders } from "../lib/security/headers"

const MIN = 60 * 1000
const HOUR = 60 * MIN

// Exact-match regexes so the login limiter/lockout/captcha don't bleed onto the
// sibling /register, /reset-password and /update routes (a prefix string matcher
// would catch all of them).
const LOGIN    = /^\/auth\/customer\/emailpass\/?$/
const REGISTER = /^\/auth\/customer\/emailpass\/register\/?$/
const RESET_REQ = /^\/auth\/customer\/emailpass\/reset-password\/?$/
const RESET_UPD = /^\/auth\/customer\/emailpass\/update\/?$/

export default defineMiddlewares({
  routes: [
    // ── Baseline security headers on all storefront + auth traffic ──────────────
    { matcher: "/store/*", middlewares: [securityHeaders] },
    { matcher: "/auth/*",  middlewares: [securityHeaders] },

    // ── Login: IP rate limit + account lockout + Turnstile ──────────────────────
    {
      matcher: LOGIN,
      method: ["POST"],
      middlewares: [
        rateLimit({ name: "login", windowMs: 15 * MIN, max: 10 }),
        loginLockout,
        requireTurnstile(),
      ],
    },

    // ── Registration: tighter limit + Turnstile (anti-bot signup) ───────────────
    {
      matcher: REGISTER,
      method: ["POST"],
      middlewares: [
        rateLimit({ name: "register", windowMs: 1 * HOUR, max: 5 }),
        requireTurnstile(),
      ],
    },

    // ── Password-reset request: anti email-spam / enumeration + Turnstile ───────
    {
      matcher: RESET_REQ,
      method: ["POST"],
      middlewares: [
        rateLimit({ name: "reset_req", windowMs: 1 * HOUR, max: 5 }),
        requireTurnstile(),
      ],
    },

    // ── Reset completion (from emailed link): rate limit only, no captcha ───────
    {
      matcher: RESET_UPD,
      method: ["POST"],
      middlewares: [rateLimit({ name: "reset_upd", windowMs: 15 * MIN, max: 10 })],
    },

    // ── Custom sensitive store endpoints ────────────────────────────────────────
    {
      matcher: "/store/request-email-change",
      method: ["POST"],
      middlewares: [
        rateLimit({ name: "email_change", windowMs: 1 * HOUR, max: 10 }),
        requireTurnstile(),
      ],
    },
    {
      matcher: "/store/delete-account",
      method: ["POST"],
      middlewares: [rateLimit({ name: "delete_account", windowMs: 1 * HOUR, max: 5 })],
    },
  ],
})
