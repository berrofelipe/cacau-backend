import type { ExecArgs } from "@medusajs/framework/types"
import { omieCall, omieConfigured } from "../lib/omie/client"

// Prints the Omie codes needed to configure the integration:
//   OMIE_CODIGO_CATEGORIA       — a revenue category (categoria de receita)
//   OMIE_CODIGO_CONTA_CORRENTE  — a conta corrente id
//
// Usage (with OMIE_APP_KEY / OMIE_APP_SECRET in .env):
//   npx medusa exec ./src/scripts/omie-list-config.ts

export default async function omieListConfig(_: ExecArgs) {
  if (!omieConfigured()) {
    console.error("Defina OMIE_APP_KEY e OMIE_APP_SECRET no .env antes de rodar este script.")
    return
  }

  console.log("── Categorias (use uma de RECEITA em OMIE_CODIGO_CATEGORIA) ──────────")
  let page = 1
  let totalPages = 1
  do {
    const res = await omieCall<any>("geral/categorias", "ListarCategorias", {
      pagina: page,
      registros_por_pagina: 200,
    })
    totalPages = res.total_de_paginas || 1
    for (const c of res.categoria_cadastro || []) {
      if (c.conta_inativa === "S" || c.nao_exibir === "S") continue
      const kind = c.natureza || c.tipo_categoria || ""
      console.log(`  ${String(c.codigo).padEnd(12)} ${c.descricao}${kind ? `  [${kind}]` : ""}`)
    }
    page++
  } while (page <= totalPages)

  console.log("\n── Contas correntes (use o código em OMIE_CODIGO_CONTA_CORRENTE) ─────")
  page = 1
  totalPages = 1
  do {
    const res = await omieCall<any>("geral/contacorrente", "ListarContasCorrentes", {
      pagina: page,
      registros_por_pagina: 200,
    })
    totalPages = res.total_de_paginas || 1
    const rows = res.ListarContasCorrentes || res.conta_corrente_lista || []
    for (const cc of rows) {
      if (cc.inativo === "S") continue
      const tipo = cc.tipo_conta_corrente || cc.tipo || ""
      console.log(`  ${String(cc.nCodCC ?? cc.codigo).padEnd(12)} ${cc.descricao}${tipo ? `  [${tipo}]` : ""}`)
    }
    page++
  } while (page <= totalPages)

  console.log("\nCopie os dois códigos para o .env / Railway e reinicie o backend.")
}
