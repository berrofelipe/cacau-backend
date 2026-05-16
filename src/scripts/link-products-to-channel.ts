// @ts-nocheck
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows"

export default async function linkProductsToChannel({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)

  const [defaultChannel] = await salesChannelService.listSalesChannels({
    name: "Default Sales Channel",
  })

  if (!defaultChannel) {
    logger.error("Default Sales Channel not found. Run the seed first.")
    return
  }

  logger.info(`Using sales channel: ${defaultChannel.id} (${defaultChannel.name})`)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "status"],
  })

  logger.info(`Found ${products.length} products to link.`)

  if (!products.length) {
    logger.warn("No products found in the database.")
    return
  }

  await linkProductsToSalesChannelWorkflow(container).run({
    input: {
      data: [{
        sales_channel_id: defaultChannel.id,
        product_ids: products.map((p: any) => p.id),
      }],
    },
  })

  logger.info(`Linked ${products.length} products to "${defaultChannel.name}":`)
  for (const p of products) {
    logger.info(`  - ${p.title} (${p.status})`)
  }
}
