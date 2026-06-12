import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { configReport, overallStatus, runHealthChecks } from "../../../utils/health-checks"
import { getMonitorState } from "../../../jobs/health-monitor"

// Diagnostic health check for the admin dashboard (src/admin/routes/health).
// Lives under /admin so Medusa's built-in admin auth gates it — unlike the
// public /health endpoint Railway uses, this one reports per-service detail.

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const checks = await runHealthChecks(req.scope)

  res.json({
    status: overallStatus(checks),
    checked_at: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    node_env: process.env.NODE_ENV || "development",
    checks,
    config: configReport(),
    monitor: getMonitorState(),
  })
}
