import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { Resend } from "resend"
import { omieCall, omieConfigured, isOmieNotFound } from "../lib/omie/client"
import {
  buildUpsertClientePayload,
  buildIncluirPedidoPayload,
  omiePedidoOptionsFromEnv,
  pedidoIntegrationCode,
  cpfCnpjFromOrder,
} from "../lib/omie/mappers"

// Pushes every placed (paid) order into the Omie ERP so that stock, NF-e and
// financials live in the same system as the physical stores:
//   1. UpsertCliente     — create/update the customer in Omie
//   2. IncluirPedido     — create the sales order (products matched by SKU)
// NF-e emission itself is driven by the order stage (OMIE_ETAPA) and the
// billing automation configured inside Omie.
//
// Failures never crash order placement — they alert ADMIN_REPORT_EMAIL so the
// order can be re-entered manually in Omie.

async function alertAdmin(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  const to = process.env.ADMIN_REPORT_EMAIL || "beraldo.felipe@gmail.com"
  try {
    await new Resend(key).emails.send({
      from: process.env.RESEND_FROM || "noreply@cacaudoceu.com.br",
      to,
      subject,
      html: `<p style="font-family:Arial,sans-serif;font-size:13px;white-space:pre-wrap">${text}</p>`,
    })
  } catch (e) {
    console.error("[omie] Falha também ao enviar alerta por e-mail:", e)
  }
}

export default async function orderPlacedOmieHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!omieConfigured()) {
    console.warn("[omie] OMIE_APP_KEY/OMIE_APP_SECRET não configuradas — pedido não enviado ao ERP")
    return
  }

  const orderService = container.resolve(Modules.ORDER)
  const order = await orderService.retrieveOrder(data.id, {
    relations: ["items", "shipping_address", "shipping_methods"],
  })

  const integrationCode = pedidoIntegrationCode(order)

  try {
    // Idempotency: skip if this order already exists in Omie (subscriber may
    // be re-invoked for the same event)
    try {
      await omieCall("produtos/pedido", "ConsultarPedido", {
        codigo_pedido_integracao: integrationCode,
      })
      console.log(`[omie] Pedido #${order.display_id} já existe no Omie (${integrationCode}) — ignorando`)
      return
    } catch (err) {
      if (!isOmieNotFound(err)) throw err
    }

    if (!cpfCnpjFromOrder(order)) {
      // Order still goes to Omie; NF-e emission will ask for the document
      console.warn(`[omie] Pedido #${order.display_id} sem CPF/CNPJ — NF-e exigirá preenchimento manual`)
    }

    const cliente = await omieCall<{ codigo_cliente_omie: number }>(
      "geral/clientes",
      "UpsertCliente",
      buildUpsertClientePayload(order)
    )

    const pedido = await omieCall<{ codigo_pedido: number; numero_pedido: string }>(
      "produtos/pedido",
      "IncluirPedido",
      buildIncluirPedidoPayload(order, cliente.codigo_cliente_omie, omiePedidoOptionsFromEnv())
    )

    console.log(
      `[omie] Pedido #${order.display_id} enviado ao Omie — cliente ${cliente.codigo_cliente_omie}, ` +
        `pedido ${pedido.numero_pedido ?? pedido.codigo_pedido}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[omie] Falha ao enviar pedido #${order.display_id} ao Omie:`, err)
    await alertAdmin(
      `⚠️ Cacau do Céu · Pedido #${order.display_id} NÃO entrou no Omie`,
      `O pedido #${order.display_id} (${order.id}) foi pago no site mas não pôde ser criado no Omie.\n\n` +
        `Erro: ${msg}\n\n` +
        `Lance o pedido manualmente no Omie (código de integração ${integrationCode}) ` +
        `para que estoque, financeiro e NF-e fiquem corretos.`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
