import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function diagnoseProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query  = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)

  // All sales channels
  const channels = await salesChannelService.listSalesChannels()
  logger.info(`Sales channels (${channels.length}):`)
  for (const ch of channels) logger.info(`  ${ch.id} — ${ch.name}`)

  // All products with status and sales channels
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status", "sales_channels.*"],
  })

  logger.info(`\nProducts (${products.length}):`)
  for (const p of products as any[]) {
    const chNames = (p.sales_channels || []).map((c: any) => c.name).join(", ") || "NONE"
    logger.info(`  [${p.status}] ${p.title} — channels: ${chNames}`)
  }
}
