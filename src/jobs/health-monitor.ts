import type { MedusaContainer } from "@medusajs/framework"
import { Resend } from "resend"
import { runHealthChecks, type ServiceCheck } from "../utils/health-checks"

// Runs the service health checks every 5 minutes. After 3 consecutive
// failing runs (~15 min of downtime) it emails ADMIN_REPORT_EMAIL once,
// then stays quiet until the services recover — at which point it sends
// a recovery email and re-arms.
//
// Only "error" counts as a failure; "degraded" and "not_configured" show
// up on the dashboard but never page anyone. Note this job runs inside
// the backend itself: it catches broken integrations (Supabase, Stripe,
// Resend, Melhor Envio), but if the whole server goes down the GitHub
// keepalive workflow is what flags it.

const ALERT_THRESHOLD = 3
// Recipient is configurable via ADMIN_REPORT_EMAIL (same variable the
// weekly report uses); the address below is only the fallback default.
const ADMIN_EMAIL = process.env.ADMIN_REPORT_EMAIL || "beraldo.felipe@gmail.com"
const FROM_EMAIL = process.env.RESEND_FROM || "noreply@cacaudoceu.com.br"

// In-memory state — resets on deploy/restart, which just re-arms the counter
const state = {
  consecutive_failures: 0,
  alerted: false,
  last_run_at: null as string | null,
  last_failing: [] as string[],
}

export function getMonitorState() {
  return { ...state, alert_threshold: ALERT_THRESHOLD, interval_minutes: 5, alert_email: ADMIN_EMAIL }
}

const STATUS_LABEL: Record<ServiceCheck["status"], string> = {
  ok: "Operacional",
  degraded: "Degradado",
  error: "FALHA",
  not_configured: "Não configurado",
}

const STATUS_COLOR: Record<ServiceCheck["status"], string> = {
  ok: "#2d6a4f",
  degraded: "#b07d2b",
  error: "#c1121f",
  not_configured: "#8a8378",
}

function buildEmailHtml(title: string, intro: string, checks: ServiceCheck[]): string {
  const rows = checks.map((c) => `
    <tr>
      <td style="font-family:Arial,sans-serif;font-size:12.5px;color:#281a0a;padding:10px 14px;border-bottom:1px solid #f0ece0">${c.label}</td>
      <td style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;color:${STATUS_COLOR[c.status]};padding:10px 14px;border-bottom:1px solid #f0ece0;white-space:nowrap">${STATUS_LABEL[c.status]}</td>
      <td style="font-family:Arial,sans-serif;font-size:11px;color:#58412d;padding:10px 14px;border-bottom:1px solid #f0ece0">${c.message}</td>
    </tr>`).join("")

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px 0;background:#f0ece0;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:680px;margin:0 auto;background:#faf7ed">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:28px 40px 0">
    <tr>
      <td valign="top">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#281a0a">Cacau do Céu</div>
        <div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.22em;text-transform:uppercase;color:#c8a97a;margin-top:5px">Monitor de Serviços</div>
      </td>
    </tr>
  </table>
  <div style="height:2px;background:#281a0a;margin:18px 40px 0"></div>
  <div style="padding:36px 40px 0">
    <div style="font-family:Georgia,serif;font-style:italic;font-size:34px;line-height:1.05;color:#281a0a">${title}</div>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#58412d;margin-top:14px;line-height:1.8">${intro}</p>
  </div>
  <div style="padding:24px 40px 36px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr style="background:#281a0a">
        <td style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#faf7ed;padding:10px 14px">Serviço</td>
        <td style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#faf7ed;padding:10px 14px">Status</td>
        <td style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#faf7ed;padding:10px 14px">Detalhe</td>
      </tr>
      ${rows}
    </table>
    <p style="font-family:Arial,sans-serif;font-size:10px;color:#8a8378;margin-top:18px;line-height:1.7">
      Painel completo: <a href="https://cacaudoceu.site/app/health" style="color:#64361a">cacaudoceu.site/app/health</a>
    </p>
  </div>
  <div style="height:1px;background:#d5cec4;margin:0 40px"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:20px 40px 32px">
    <tr>
      <td style="font-family:Georgia,serif;font-style:italic;font-size:11px;color:#58412d">Cacau do Céu · Monitor de Serviços</td>
      <td align="right" style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.16em;text-transform:uppercase;color:#64361a">Não responder</td>
    </tr>
  </table>
</div>
</body></html>`
}

async function sendEmail(subject: string, html: string) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[health-monitor] RESEND_API_KEY não configurada — alerta apenas no log.")
    return
  }
  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject, html })
  if (error) {
    console.error("[health-monitor] Falha ao enviar alerta por e-mail:", error)
  } else {
    console.log(`[health-monitor] Alerta enviado para ${ADMIN_EMAIL}`)
  }
}

export default async function healthMonitorJob(container: MedusaContainer) {
  const checks = await runHealthChecks(container)
  const failing = checks.filter((c) => c.status === "error")
  state.last_run_at = new Date().toISOString()
  state.last_failing = failing.map((c) => c.service)

  if (failing.length === 0) {
    if (state.alerted) {
      await sendEmail(
        "✅ Cacau do Céu · Serviços recuperados",
        buildEmailHtml(
          "Tudo operacional novamente.",
          "Todos os serviços voltaram a responder normalmente. O monitor foi rearmado e avisará de novo se algo cair.",
          checks
        )
      )
    }
    state.consecutive_failures = 0
    state.alerted = false
    return
  }

  state.consecutive_failures++
  const names = failing.map((c) => c.label).join(", ")
  console.warn(`[health-monitor] Falha ${state.consecutive_failures}/${ALERT_THRESHOLD}: ${names}`)

  if (state.consecutive_failures >= ALERT_THRESHOLD && !state.alerted) {
    state.alerted = true
    await sendEmail(
      "⚠️ Cacau do Céu · Falha em serviços",
      buildEmailHtml(
        "Serviço com falha há 15 minutos.",
        `${ALERT_THRESHOLD} verificações consecutivas (a cada 5 min) falharam para: <strong>${names}</strong>. ` +
          "Você receberá um novo e-mail quando os serviços se recuperarem — sem alertas repetidos até lá.",
        checks
      )
    )
  }
}

export const config = {
  name: "health-monitor",
  schedule: "*/5 * * * *", // a cada 5 minutos
}
