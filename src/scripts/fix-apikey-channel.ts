import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows"

const LOJA_ONLINE_ID = "sc_01KRMK918G4P02QSQVJZG67MW5"

export default async function fixApiKeyChannel({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query  = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: apiKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "type"],
    filters: { type: "publishable" },
  })

  if (!apiKeys.length) { logger.error("No publishable API key found."); return }

  for (const key of apiKeys as any[]) {
    logger.info(`Linking key "${key.title}" (${key.id}) to Loja Online...`)
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: key.id,
        add: [LOJA_ONLINE_ID],
      },
    })
    logger.info("Done.")
  }
}
