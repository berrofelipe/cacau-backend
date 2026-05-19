import type { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { Resend } from "resend"

const WC_URL    = "https://cacaudoceu.com.br"
const WC_KEY    = process.env.WC_KEY    || ""
const WC_SECRET = process.env.WC_SECRET || ""
const ADMIN_EMAIL = process.env.ADMIN_REPORT_EMAIL
const FROM_EMAIL  = process.env.RESEND_FROM || "noreply@cacaudoceu.com.br"

const wcAuth = () =>
  "Basic " + Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString("base64")

// ── WooCommerce helpers ───────────────────────────────────────────────────────

async function fetchWCOrders(after: string, before: string) {
  const url = `${WC_URL}/wp-json/wc/v3/orders?per_page=100&status=any` +
    `&after=${after}&before=${before}`
  const res = await fetch(url, { headers: { Authorization: wcAuth() } })
  return res.ok ? (await res.json() as any[]) : []
}

async function fetchAllWCOrders() {
  const orders: any[] = []
  let page = 1
  while (true) {
    const res = await fetch(
      `${WC_URL}/wp-json/wc/v3/orders?per_page=100&page=${page}&status=any`,
      { headers: { Authorization: wcAuth() } }
    )
    const batch = await res.json() as any[]
    if (!Array.isArray(batch) || batch.length === 0) break
    orders.push(...batch)
    if (batch.length < 100) break
    page++
  }
  return orders
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function analyzeOrders(orders: any[]) {
  const customerOrders: Record<string, number> = {}
  const productCount:   Record<string, { name: string; qty: number; revenue: number }> = {}
  const couponCount:    Record<string, { count: number; discount: number; emails: Set<string> }> = {}
  let totalRevenue = 0
  let totalOrders  = 0

  for (const o of orders) {
    if (["cancelled", "refunded", "failed"].includes(o.status)) continue
    totalOrders++
    totalRevenue += parseFloat(o.total || "0")

    const email = o.billing?.email?.toLowerCase() || "guest"
    customerOrders[email] = (customerOrders[email] || 0) + 1

    for (const item of o.line_items || []) {
      const key = item.product_id?.toString() || item.name
      if (!productCount[key]) productCount[key] = { name: item.name, qty: 0, revenue: 0 }
      productCount[key].qty     += item.quantity || 0
      productCount[key].revenue += parseFloat(item.total || "0")
    }

    for (const coupon of o.coupon_lines || []) {
      const code = coupon.code?.toLowerCase() || "unknown"
      if (!couponCount[code]) couponCount[code] = { count: 0, discount: 0, emails: new Set() }
      couponCount[code].count++
      couponCount[code].discount += parseFloat(coupon.discount || "0")
      couponCount[code].emails.add(email)
    }
  }

  const returning = Object.values(customerOrders).filter(n => n > 1).length
  const topProducts = Object.values(productCount)
    .sort((a, b) => b.qty - a.qty).slice(0, 10)
  const topCustomers = Object.entries(customerOrders)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
  const topCoupons = Object.entries(couponCount)
    .sort((a, b) => b[1].count - a[1].count).slice(0, 10)

  return {
    totalOrders, totalRevenue,
    uniqueCustomers: Object.keys(customerOrders).length,
    returningCustomers: returning,
    avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    topProducts, topCustomers, topCoupons,
  }
}

// ── Email HTML ─────────────────────────────────────────────────────────────────

function brl(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n)
}

function buildHtml(current: ReturnType<typeof analyzeOrders>, previous: ReturnType<typeof analyzeOrders>, weekLabel: string) {
  const growth = previous.totalRevenue > 0
    ? ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue * 100).toFixed(1)
    : null
  const retRate = current.uniqueCustomers > 0
    ? Math.round(current.returningCustomers / current.uniqueCustomers * 100)
    : 0

  const arrow = (v: string | null) => v === null ? "—" : parseFloat(v) >= 0 ? `↑ ${v}%` : `↓ ${Math.abs(parseFloat(v))}%`
  const clr   = (v: string | null) => v === null ? "#58412d" : parseFloat(v) >= 0 ? "#2d6a4f" : "#c1121f"

  const label = (t: string) =>
    `<div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.24em;text-transform:uppercase;color:#64361a;margin-bottom:16px">${t}</div>`
  const rule = () => `<div style="height:1px;background:#d5cec4;margin:0 40px"></div>`

  const th = (v: string, align = "left") =>
    `<td style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#faf7ed;padding:10px 14px;text-align:${align};font-weight:400;border:0">${v}</td>`
  const td = (v: string | number, align = "left", extra = "") =>
    `<td style="font-family:Arial,sans-serif;font-size:12.5px;color:#281a0a;padding:10px 14px;text-align:${align};border-bottom:1px solid #f0ece0${extra}">${v}</td>`
  const tdS = (v: string | number, align = "right") =>
    `<td style="font-family:Georgia,serif;font-size:12.5px;color:#281a0a;padding:10px 14px;text-align:${align};border-bottom:1px solid #f0ece0">${v}</td>`
  const rows = (items: any[], fn: (it: any, i: number) => string) =>
    items.map((it, i) => `<tr style="background:${i%2===0?"#fdf8f0":"#fffbf4"}">${fn(it, i)}</tr>`).join("")

  const kpiLight = (lbl: string, val: string | number, sub: string, subColor = "#58412d") =>
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #d5cec4;background:#fff">
      <tr><td style="padding:20px 14px;text-align:center">
        <div style="font-family:Arial,sans-serif;font-size:7.5px;letter-spacing:0.22em;text-transform:uppercase;color:#64361a;margin-bottom:10px">${lbl}</div>
        <div style="font-family:Georgia,serif;font-size:22px;color:#281a0a">${val}</div>
        <div style="font-family:Arial,sans-serif;font-size:10px;color:${subColor};margin-top:8px">${sub}</div>
      </td></tr>
    </table>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 0;background:#f0ece0;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:680px;margin:0 auto;background:#faf7ed">

  <!-- HEADER -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:28px 40px 0">
    <tr>
      <td valign="top">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:bold;color:#281a0a;letter-spacing:-0.01em">Cacau do Céu</div>
        <div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.22em;text-transform:uppercase;color:#c8a97a;margin-top:5px">Bean · Tree · To · Bar · Ilhéus, Bahia</div>
      </td>
      <td valign="top" align="right">
        <div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#58412d;line-height:2">Relatório de Negócio</div>
        <div style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:#58412d">${weekLabel}</div>
      </td>
    </tr>
  </table>
  <div style="height:2px;background:#281a0a;margin:18px 40px 0"></div>

  <!-- HERO -->
  <div style="padding:44px 40px 0">
    ${label("Esta semana")}
    <div style="font-family:Georgia,serif;font-style:italic;font-size:60px;line-height:0.88;color:#281a0a;letter-spacing:-0.02em">${brl(current.totalRevenue)}</div>
    <div style="font-family:Arial,sans-serif;font-size:11px;color:#58412d;margin-top:16px;line-height:1.9">
      ${current.totalOrders} pedidos &nbsp;·&nbsp; ${current.uniqueCustomers} clientes &nbsp;·&nbsp; ticket médio ${brl(current.avgOrderValue)}<br>
      <span style="color:${clr(growth)};font-style:italic">${arrow(growth)} vs semana anterior</span>
    </div>
  </div>

  <!-- KPIs -->
  <div style="padding:28px 40px 36px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="33%" valign="top" style="padding-right:6px">${kpiLight("Receita", brl(current.totalRevenue), arrow(growth), clr(growth))}</td>
        <td width="33%" valign="top" style="padding:0 3px">${kpiLight("Pedidos", current.totalOrders, "Ticket " + brl(current.avgOrderValue))}</td>
        <td width="33%" valign="top" style="padding-left:6px">${kpiLight("Recompra", current.returningCustomers, retRate + "% dos clientes", "#2d6a4f")}</td>
      </tr>
    </table>
  </div>

  ${current.topProducts.length > 0 ? `${rule()}
  <div style="padding:32px 40px">
    ${label("Produtos mais vendidos esta semana")}
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr style="background:#281a0a">${th("Produto")}${th("Qtd","center")}${th("Receita","right")}</tr>
      ${rows(current.topProducts, p => td(p.name) + td(p.qty,"center") + tdS(brl(p.revenue)))}
    </table>
  </div>` : ""}

  ${current.topCoupons.length > 0 ? `${rule()}
  <div style="padding:32px 40px">
    ${label("Cupons utilizados")}
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr style="background:#281a0a">${th("Código")}${th("Usos","center")}${th("Desconto","right")}${th("Clientes")}</tr>
      ${rows(current.topCoupons, ([code, data]: [string, any]) =>
        td(`<span style="font-family:monospace;letter-spacing:0.08em">${code.toUpperCase()}</span>`) +
        td(data.count,"center") + tdS(brl(data.discount)) +
        td([...data.emails].slice(0,3).join(", ") + (data.emails.size>3?` +${data.emails.size-3}`:""), "left", ";color:#58412d")
      )}
    </table>
  </div>` : ""}

  ${current.returningCustomers > 0 ? `${rule()}
  <div style="padding:32px 40px">
    ${label("Clientes com mais pedidos esta semana")}
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr style="background:#281a0a">${th("Cliente")}${th("Pedidos","center")}</tr>
      ${rows(current.topCustomers, ([email, count]: [string, number]) =>
        td(email) + td(count + " pedido" + (count>1?"s":""),"center")
      )}
    </table>
  </div>` : ""}

  <!-- FOOTER -->
  <div style="height:1px;background:#d5cec4;margin:0 40px"></div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:20px 40px 32px">
    <tr>
      <td style="font-family:Georgia,serif;font-style:italic;font-size:11px;color:#58412d">Cacau do Céu · Relatório de Negócio · ${weekLabel}</td>
      <td align="right" style="font-family:Arial,sans-serif;font-size:8px;letter-spacing:0.16em;text-transform:uppercase;color:#64361a">Não responder</td>
    </tr>
  </table>

</div>
</body></html>`
}

// ── Medusa job ────────────────────────────────────────────────────────────────

export default async function weeklyReportJob(container: MedusaContainer) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn("[weekly-report] RESEND_API_KEY não configurada — pulando envio.")
    return
  }
  if (!ADMIN_EMAIL) {
    console.warn("[weekly-report] ADMIN_REPORT_EMAIL não configurada — pulando envio.")
    return
  }

  const now   = new Date()
  const d7    = new Date(now.getTime() - 7  * 86400000)
  const d14   = new Date(now.getTime() - 14 * 86400000)

  const fmt = (d: Date) => d.toISOString().split("T")[0]
  const weekLabel = `${fmt(d7)} → ${fmt(now)}`

  console.log("[weekly-report] Buscando dados...")

  const [currentOrders, previousOrders] = await Promise.all([
    fetchWCOrders(d7.toISOString(), now.toISOString()),
    fetchWCOrders(d14.toISOString(), d7.toISOString()),
  ])

  const current  = analyzeOrders(currentOrders)
  const previous = analyzeOrders(previousOrders)

  const html = buildHtml(current, previous, weekLabel)

  const resend = new Resend(resendKey)
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to:   ADMIN_EMAIL!,
    subject: `Cacau do Céu · Relatório ${fmt(d7)} → ${fmt(now)}`,
    html,
  })

  if (error) {
    console.error("[weekly-report] Erro ao enviar email:", error)
  } else {
    console.log(`[weekly-report] Relatório enviado para ${ADMIN_EMAIL}`)
  }
}

export const config = {
  name: "weekly-analytics-report",
  schedule: "0 8 * * 1", // toda segunda-feira às 8h
}
