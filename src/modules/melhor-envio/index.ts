import { Module } from "@medusajs/framework/utils"
import MelhorEnvioFulfillmentService from "./service"

export default Module("melhor-envio", { service: MelhorEnvioFulfillmentService })
