// @ts-nocheck
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function fixProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query  = container.resolve(ContainerRegistrationKeys.QUERY)
  const link   = container.resolve(ContainerRegistrationKeys.LINK)
  const productService     = container.resolve(Modules.PRODUCT)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)

  const [defaultChannel] = await salesChannelService.listSalesChannels({
    name: "Default Sales Channel",
  })
  if (!defaultChannel) { logger.error("No Default Sales Channel found."); return }
  logger.info(`Channel: ${defaultChannel.id} (${defaultChannel.name})`)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "sales_channels.*"],
  })
  logger.info(`Found ${products.length} products`)

  // Publish drafts and link to sales channel
  const draftIds: string[] = []
  const unlinkdIds: string[] = []

  for (const p of products as any[]) {
    if (p.status !== "published") draftIds.push(p.id)
    const linked = (p.sales_channels || []).some((c: any) => c.id === defaultChannel.id)
    if (!linked) unlinkdIds.push(p.id)
  }

  if (draftIds.length) {
    logger.info(`Publishing ${draftIds.length} draft products...`)
    await productService.updateProducts(draftIds.map(id => ({ id, status: "published" })))
  }

  if (unlinkdIds.length) {
    logger.info(`Linking ${unlinkdIds.length} products to sales channel...`)
    for (const productId of unlinkdIds) {
      await link.create({
        [Modules.PRODUCT]:       { product_id: productId },
        [Modules.SALES_CHANNEL]: { sales_channel_id: defaultChannel.id },
      })
    }
  }

  logger.info("Done. Products after fix:")
  const { data: updated } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "sales_channels.*"],
  })
  for (const p of updated as any[]) {
    const chNames = (p.sales_channels || []).map((c: any) => c.name).join(", ") || "NONE"
    logger.info(`  [${p.status}] ${p.title} — channels: ${chNames}`)
  }
}
