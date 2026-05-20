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
```

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
