import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runOmieCatalogSync } from "../../../jobs/sync-omie-catalog"

// POST /admin/omie-sync — triggers an immediate Omie → Medusa catalog sync
// (stock, prices, new products) without waiting for the 5-minute job.
// Authenticated like every /admin route.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const summary = await runOmieCatalogSync(req.scope)
    res.status(summary.error ? 502 : 200).json(summary)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
