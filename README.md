# Cacau do Céu — Backend

Medusa v2 commerce API. Owns everything commerce-related: product catalogue, cart, checkout, payments, order management, customer accounts, transactional emails, and shipping rate calculation.

## Architecture

```mermaid
graph TD
    FE["Frontend\nVercel"]         -->|Storefront API /store/*| BE
    ADMIN["Admin Panel\n/app"]     -->|Admin API /admin/*|      BE

    subgraph BE ["Medusa v2 — Railway"]
        API["HTTP API"]
        SUBS["Subscribers\norder · customer · password-reset"]
        ME_MOD["Melhor Envio\nfulfillment provider"]
    end

    BE  -->|PostgreSQL|              DB["Supabase DB"]
    BE  -->|Charges / webhooks|      STRIPE["Stripe"]
    BE  -->|Shipping rate quotes|    ME["Melhor Envio"]
    BE  -->|Transactional emails|    RESEND["Resend"]
    BE  <-->|Orders out / stock in|  OMIE["Omie ERP"]
```

## Omie ERP integration

Omie is the system of record for the whole operation (physical stores, wholesale,
marketplaces via Omie.Hub, NF-e, financials). The site integrates with it in two
directions:

- **Orders out** — `src/subscribers/order-placed-omie.ts` runs on `order.placed`:
  upserts the customer (`UpsertCliente`) and creates the sales order
  (`IncluirPedido`) with `codigo_pedido_integracao = CDCWEB-<display_id>` for
  idempotency. Failures alert `ADMIN_REPORT_EMAIL` and never block the checkout.
- **Catalog in** — `src/jobs/sync-omie-catalog.ts` runs every 5 minutes (or on
  demand via `POST /admin/omie-sync`): reads `ListarPosEstoque` +
  `ListarProdutos` and overwrites Medusa inventory levels and variant BRL
  prices. **Omie is the source of truth for stock and price** — never edit
  those in Medusa Admin, they will be overwritten. Inactive Omie products are
  zeroed out (sold out on the site). Active Omie products with no matching
  site SKU are auto-created as **draft** products (with any photos attached in
  Omie) — add the visual identity and publish in the admin to put them on the
  site. Presentation data (title, notes, swatch, images, metadata) of existing
  products stays curated in Medusa and is never overwritten.
- **Product images** — stored in S3-compatible object storage behind a CDN
  (Supabase Storage bucket via `@medusajs/medusa/file-s3`; see the `S3_*` vars
  in `.env.example`). Upload through Medusa Admin; the public URL is saved on
  the product and reused by the storefront, marketplaces and catalog feeds.
- **SKU contract** — the Medusa variant SKU must equal the Omie product code
  (`código do produto`). Unmatched SKUs are skipped and logged.
- **Config discovery** — `npx medusa exec ./src/scripts/omie-list-config.ts`
  lists your Omie categories and contas correntes with the codes to put in
  `OMIE_CODIGO_CATEGORIA` / `OMIE_CODIGO_CONTA_CORRENTE`.
- NF-e emission happens in Omie, driven by the order stage (`OMIE_ETAPA`) and the
  billing automation configured there. The checkout collects the buyer's CPF
  (stored in `shipping_address.metadata.cpf`) so invoices can be issued
  automatically.
- The health monitor (`/app/health` + 5-min job) includes an Omie API probe.

## Responsibilities

| Domain | Details |
|---|---|
| Products | Catalogue, variants, pricing per region, inventory levels, metadata fields (`pct`, `swatch`, `fruit`, `subtitle`, `num`) |
| Cart | Create/update, line items, region pricing, sales channel scoping |
| Checkout | Shipping address, shipping method selection, Stripe payment session |
| Orders | Order lifecycle, fulfillment status, display ID |
| Customers | Registration, JWT auth, addresses, password reset, email change |
| Payments | Stripe provider — `automaticPaymentMethods`, webhook processing at `/hooks/payment/stripe_stripe` |
| Shipping | Custom Melhor Envio fulfillment provider (`src/modules/melhor-envio`) — sandbox in dev, live in production |
| Emails | Branded HTML templates for order confirmation, welcome, and password reset, sent via Resend |

## Custom modules

```
src/
  modules/
    melhor-envio/         Medusa fulfillment provider — calls Melhor Envio API for shipping quotes
  subscribers/
    order-placed.ts       Sends order confirmation email on order.placed
    customer-created.ts   Sends welcome email on customer.created
    auth-password-reset.ts Sends reset link on auth.password_reset
  utils/
    email.ts              Branded HTML email templates (matches site design system)
  api/                    Custom endpoints: /store/request-email-change, /store/verify-email-change,
                          /store/delete-account
```

## Local development

```bash
cp .env.example .env   # fill in values — see comments in .env.example
npm install
npm run dev            # starts at http://localhost:9000
                       # admin panel at http://localhost:9000/app
```

No linter or test suite is required to run locally. The Jest integration tests in `integration-tests/` spin up a full Medusa instance and are optional.

## Environment variables

See `.env.example` for the full reference. Key variables that differ between environments:

| Variable | Dev (local) | Production (Railway) |
|---|---|---|
| `STORE_URL` | `http://localhost:5173` | `https://cacaudoceu.com.br` |
| `STORE_CORS` | includes `localhost:5173` | includes production + Vercel domains |
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | from `stripe listen` CLI | from Stripe dashboard webhook |
| `MELHOR_ENVIO_SANDBOX` | `true` | `false` |
| `MELHOR_ENVIO_TOKEN` | sandbox token | production token |

All production values live exclusively in the Railway dashboard — never in committed files.

## Deployment

Hosted on **Railway**. Medusa Admin is disabled in production (`admin.disable: true` in `medusa-config.ts`) — use the Railway-hosted instance or a separate admin deployment to manage products and orders.

Database: **Supabase PostgreSQL** (pooled connection via `aws-1-us-west-1.pooler.supabase.com`).

## Health check

From the project root:

```bash
node health-check.mjs --backend https://cacaudoceu.site
```

Run `node health-check.mjs --checklist` for the full domain migration checklist.
