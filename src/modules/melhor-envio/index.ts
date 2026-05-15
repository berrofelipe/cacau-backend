import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import MelhorEnvioFulfillmentService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [MelhorEnvioFulfillmentService],
})
