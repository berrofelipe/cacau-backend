import {
  buildUpsertClientePayload,
  buildIncluirPedidoPayload,
  clienteIntegrationCode,
  pedidoIntegrationCode,
  cpfCnpjFromOrder,
} from "../mappers"

const baseOrder = {
  id: "order_01TESTTESTTESTTESTTESTTEST",
  display_id: 42,
  email: "cliente@example.com",
  metadata: {},
  shipping_address: {
    first_name: "Maria",
    last_name: "Silva",
    address_1: "Av. Paulista, 1578",
    address_2: "Bela Vista — Apto 12",
    city: "São Paulo",
    province: "SP",
    postal_code: "01310-200",
    phone: "+55 (11) 98765-4321",
    metadata: { cpf: "529.982.247-25" },
  },
  items: [
    { title: "Morango liofilizado", variant_sku: "CDC-02", quantity: 2, unit_price: 46 },
    { title: "Intenso Leolinda", variant_sku: "CDC-05", quantity: 1, unit_price: { value: "38" } },
  ],
  shipping_methods: [{ amount: 22.5 }],
}

const opts = {
  etapa: "10",
  codigoParcela: "000",
  codigoCategoria: "1.01.02",
  codigoContaCorrente: 123456,
  freteModalidade: "0",
}

describe("cpfCnpjFromOrder", () => {
  it("normalizes CPF from shipping address metadata", () => {
    expect(cpfCnpjFromOrder(baseOrder)).toBe("52998224725")
  })

  it("falls back to order metadata and rejects invalid lengths", () => {
    expect(cpfCnpjFromOrder({ metadata: { cpf: "12.345.678/0001-95" } })).toBe("12345678000195")
    expect(cpfCnpjFromOrder({ metadata: { cpf: "123" } })).toBeNull()
    expect(cpfCnpjFromOrder({ metadata: {} })).toBeNull()
  })

  it("rejects documents that fail the checksum", () => {
    expect(cpfCnpjFromOrder({ metadata: { cpf: "529.982.247-24" } })).toBeNull() // wrong check digit
    expect(cpfCnpjFromOrder({ metadata: { cpf: "111.111.111-11" } })).toBeNull() // repeated digits
    expect(cpfCnpjFromOrder({ metadata: { cpf: "12.345.678/0001-96" } })).toBeNull() // wrong CNPJ check digit
    expect(cpfCnpjFromOrder({ metadata: { cpf: "529.982.247-25" } })).toBe("52998224725")
  })
})

describe("integration codes", () => {
  it("is stable per email regardless of case/whitespace", () => {
    expect(clienteIntegrationCode("Cliente@Example.com ")).toBe(clienteIntegrationCode("cliente@example.com"))
    expect(clienteIntegrationCode("cliente@example.com")).toMatch(/^CDC[0-9A-F]{12}$/)
  })

  it("uses the display id for orders", () => {
    expect(pedidoIntegrationCode(baseOrder)).toBe("CDCWEB-42")
  })
})

describe("buildUpsertClientePayload", () => {
  it("splits street/number, bairro/complemento, phone and normalizes fields", () => {
    const p = buildUpsertClientePayload(baseOrder) as any
    expect(p.razao_social).toBe("Maria Silva")
    expect(p.cnpj_cpf).toBe("52998224725")
    expect(p.pessoa_fisica).toBe("S")
    expect(p.endereco).toBe("Av. Paulista")
    expect(p.endereco_numero).toBe("1578")
    expect(p.bairro).toBe("Bela Vista")
    expect(p.complemento).toBe("Apto 12")
    expect(p.telefone1_ddd).toBe("11")
    expect(p.telefone1_numero).toBe("987654321")
    expect(p.cidade).toBe("SÃO PAULO")
    expect(p.estado).toBe("SP")
    expect(p.cep).toBe("01310200")
  })

  it("handles missing optional data without emitting empty fields", () => {
    const order = {
      ...baseOrder,
      shipping_address: { first_name: "João", address_1: "Rua Sem Número", city: "Ilhéus", province: "ba", postal_code: "45653-000", metadata: {} },
      metadata: {},
    }
    const p = buildUpsertClientePayload(order) as any
    expect(p.cnpj_cpf).toBeUndefined()
    expect(p.telefone1_ddd).toBeUndefined()
    expect(p.endereco).toBe("Rua Sem Número")
    expect(p.endereco_numero).toBe("S/N")
    expect(p.estado).toBe("BA")
  })
})

describe("buildIncluirPedidoPayload", () => {
  it("builds cabecalho, items by SKU and freight", () => {
    const p = buildIncluirPedidoPayload(baseOrder, 999, opts) as any
    expect(p.cabecalho.codigo_cliente).toBe(999)
    expect(p.cabecalho.codigo_pedido_integracao).toBe("CDCWEB-42")
    expect(p.cabecalho.quantidade_itens).toBe(2)
    expect(p.cabecalho.data_previsao).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(p.det).toHaveLength(2)
    expect(p.det[0].produto).toEqual({ codigo: "CDC-02", quantidade: 2, valor_unitario: 46 })
    // BigNumber-ish unit_price objects are unwrapped
    expect(p.det[1].produto.valor_unitario).toBe(38)
    expect(p.frete).toEqual({ modalidade: "0", valor_frete: 22.5 })
    expect(p.informacoes_adicionais.codigo_categoria).toBe("1.01.02")
    expect(p.informacoes_adicionais.numero_pedido_cliente).toBe("42")
  })

  it("omits frete when shipping is free", () => {
    const p = buildIncluirPedidoPayload({ ...baseOrder, shipping_methods: [] }, 999, opts) as any
    expect(p.frete).toBeUndefined()
  })

  it("rejects items without SKU with an actionable message", () => {
    const order = { ...baseOrder, items: [{ title: "Bombons · caixa 9", quantity: 1, unit_price: 78 }] }
    expect(() => buildIncluirPedidoPayload(order, 999, opts)).toThrow(/SKU.*Bombons/i)
  })
})
