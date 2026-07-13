import type { MedusaContainer } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow, updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { omieCall, omieConfigured } from "../lib/omie/client"
import { toNum } from "../lib/omie/mappers"

// Omie is the source of truth for the catalog's commercial data. Every 10
// minutes this job pulls the stock position and the product register from Omie
// and overwrites the Medusa side, matching Omie's product code (cCodigo /
// codigo) to the Medusa variant SKU:
//
//   stock  — ListarPosEstoque → inventory levels
//   price  — ListarProdutos (valor_unitario) → variant BRL price
//
// Presentation data (title, notes, swatch, images, metadata) stays curated in
// Medusa — Omie's ERP descriptions are not written to the storefront. Omie
// products with no matching Medusa SKU are logged so they can be added in the
// admin; inactive Omie products are treated as stock 0 (sold out on the site,
// never deleted here).

type OmiePosEstoque = {
  nTotPaginas?: number
  produtos?: Array<{ cCodigo?: string; nSaldo?: number; fisico?: number }>
}

type OmieProdutos = {
  total_de_paginas?: number
  produto_servico_cadastro?: Array<{
    codigo?: string
    descricao?: string
    valor_unitario?: number
    inativo?: string // "S" | "N"
    imagens?: Array<{ url_imagem?: string }>
  }>
}

type OmieProduct = { price: number; inactive: boolean; descricao: string; images: string[] }

async function fetchOmieStock(): Promise<Map<string, number>> {
  const stock = new Map<string, number>()
  const dDataPosicao = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date())
  const codigoLocal = Number(process.env.OMIE_CODIGO_LOCAL_ESTOQUE || 0)

  let page = 1
  let totalPages = 1
  do {
    const res = await omieCall<OmiePosEstoque>("estoque/consulta", "ListarPosEstoque", {
      nPagina: page,
      nRegPorPagina: 500,
      dDataPosicao,
      cExibeTodos: "N", // only products with stock control enabled
      codigo_local_estoque: codigoLocal,
    })
    totalPages = res.nTotPaginas || 1
    for (const p of res.produtos || []) {
      if (!p.cCodigo) continue
      // nSaldo = saldo disponível (físico − reservado); fall back to físico
      const qty = typeof p.nSaldo === "number" ? p.nSaldo : (p.fisico ?? 0)
      stock.set(p.cCodigo, Math.max(0, Math.floor(qty)))
    }
    page++
  } while (page <= totalPages)

  return stock
}

async function fetchOmieProducts(): Promise<Map<string, OmieProduct>> {
  const products = new Map<string, OmieProduct>()

  let page = 1
  let totalPages = 1
  do {
    const res = await omieCall<OmieProdutos>("geral/produtos", "ListarProdutos", {
      pagina: page,
      registros_por_pagina: 500,
      apenas_importado_api: "N",
      filtrar_apenas_omiepdv: "N",
      exibir_caracteristicas: "N",
    })
    totalPages = res.total_de_paginas || 1
    for (const p of res.produto_servico_cadastro || []) {
      if (!p.codigo) continue
      products.set(p.codigo, {
        price: toNum(p.valor_unitario),
        inactive: p.inativo === "S",
        descricao: p.descricao || p.codigo,
        images: (p.imagens || []).map((i) => i.url_imagem || "").filter(Boolean),
      })
    }
    page++
  } while (page <= totalPages)

  return products
}

async function syncStock(
  container: MedusaContainer,
  omieStock: Map<string, number>,
  matchedSkus: Set<string>
): Promise<number> {
  const inventoryService = container.resolve(Modules.INVENTORY)
  const locationService = container.resolve(Modules.STOCK_LOCATION)

  let locationId = process.env.OMIE_STOCK_LOCATION_ID
  if (!locationId) {
    const locations = await locationService.listStockLocations({}, { take: 1 })
    locationId = locations[0]?.id
  }
  if (!locationId) {
    console.error("[omie-sync] Nenhum stock location no Medusa — configure um ou defina OMIE_STOCK_LOCATION_ID")
    return 0
  }

  const items = await inventoryService.listInventoryItems({}, { take: 1000 })
  const updates: Array<{ inventory_item_id: string; location_id: string; stocked_quantity: number }> = []
  const creates: typeof updates = []

  for (const item of items) {
    if (!item.sku || !omieStock.has(item.sku)) continue
    matchedSkus.add(item.sku)
    const target = omieStock.get(item.sku)!
    const levels = await inventoryService.listInventoryLevels({
      inventory_item_id: item.id,
      location_id: locationId,
    })
    const level = levels[0]
    if (!level) {
      creates.push({ inventory_item_id: item.id, location_id: locationId, stocked_quantity: target })
    } else if (toNum(level.stocked_quantity) !== target) {
      updates.push({ inventory_item_id: item.id, location_id: locationId, stocked_quantity: target })
    }
  }

  if (creates.length) await inventoryService.createInventoryLevels(creates)
  if (updates.length) await inventoryService.updateInventoryLevels(updates)
  return creates.length + updates.length
}

async function syncPrices(
  container: MedusaContainer,
  omieProducts: Map<string, OmieProduct>,
  matchedSkus: Set<string>
): Promise<number> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "price_set.prices.id", "price_set.prices.amount", "price_set.prices.currency_code"],
  })

  let changed = 0
  for (const variant of variants || []) {
    if (!variant.sku) continue
    const omie = omieProducts.get(variant.sku)
    if (!omie) continue
    matchedSkus.add(variant.sku)
    if (omie.inactive || omie.price <= 0) continue // price stays; stock sync zeroes inactive items

    const currentBrl = (variant.price_set?.prices || []).find(
      (p: any) => p.currency_code === "brl"
    )
    if (currentBrl && toNum(currentBrl.amount) === omie.price) continue

    await updateProductVariantsWorkflow(container).run({
      input: {
        selector: { id: variant.id },
        update: { prices: [{ amount: omie.price, currency_code: "brl" }] },
      },
    })
    changed++
  }
  return changed
}

// New products registered in Omie are created here as DRAFT products so they
// enter the pipeline automatically but only appear on the site after someone
// adds the visual identity (swatch, metadata, photos) and publishes them in
// the admin. Photos attached to the product in Omie come along as a starting
// point.
async function createMissingProducts(
  container: MedusaContainer,
  omieProducts: Map<string, OmieProduct>,
  matchedSkus: Set<string>
): Promise<string[]> {
  const newSkus = [...omieProducts.keys()].filter(
    (sku) => !matchedSkus.has(sku) && !omieProducts.get(sku)!.inactive
  )
  if (newSkus.length === 0) return []

  await createProductsWorkflow(container).run({
    input: {
      products: newSkus.map((sku) => {
        const p = omieProducts.get(sku)!
        return {
          title: p.descricao,
          status: "draft" as const,
          ...(p.images.length > 0
            ? { thumbnail: p.images[0], images: p.images.map((url) => ({ url })) }
            : {}),
          options: [{ title: "Padrão", values: ["Padrão"] }],
          variants: [
            {
              title: p.descricao,
              sku,
              options: { Padrão: "Padrão" },
              manage_inventory: true,
              ...(p.price > 0 ? { prices: [{ amount: p.price, currency_code: "brl" }] } : {}),
            },
          ],
        }
      }),
    },
  })
  return newSkus
}

export type OmieSyncSummary = {
  stock_updates: number
  price_updates: number
  products_created: string[]
  error?: string
}

export async function runOmieCatalogSync(container: MedusaContainer): Promise<OmieSyncSummary> {
  const summary: OmieSyncSummary = { stock_updates: 0, price_updates: 0, products_created: [] }
  if (!omieConfigured()) {
    summary.error = "OMIE_APP_KEY/OMIE_APP_SECRET não configuradas"
    return summary
  }

  const [omieStock, omieProducts] = await Promise.all([fetchOmieStock(), fetchOmieProducts()])
  if (omieStock.size === 0 && omieProducts.size === 0) {
    summary.error = "Omie não retornou produtos — nada sincronizado"
    return summary
  }

  // Inactive products sell out on the site instead of being deleted
  for (const [sku, p] of omieProducts) {
    if (p.inactive) omieStock.set(sku, 0)
  }

  const matchedSkus = new Set<string>()
  summary.stock_updates = await syncStock(container, omieStock, matchedSkus)
  summary.price_updates = await syncPrices(container, omieProducts, matchedSkus)
  summary.products_created = await createMissingProducts(container, omieProducts, matchedSkus)

  if (summary.products_created.length > 0) {
    console.log(
      `[omie-sync] Novos produtos do Omie criados como rascunho (adicione identidade visual e publique no admin): ${summary.products_created.join(", ")}`
    )
  }
  if (summary.stock_updates || summary.price_updates) {
    console.log(`[omie-sync] Atualizados a partir do Omie: ${summary.stock_updates} estoque(s), ${summary.price_updates} preço(s)`)
  }
  return summary
}

export default async function syncOmieCatalogJob(container: MedusaContainer) {
  try {
    const summary = await runOmieCatalogSync(container)
    if (summary.error) console.warn(`[omie-sync] ${summary.error}`)
  } catch (err) {
    console.error("[omie-sync] Falha na sincronização com o Omie:", err)
  }
}

export const config = {
  name: "sync-omie-catalog",
  schedule: "*/5 * * * *", // a cada 5 minutos
}
