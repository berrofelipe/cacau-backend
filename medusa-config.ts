import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Fail closed on weak secrets. Only an explicit development/test environment may
// run without a real secret — every other environment (including an unset
// NODE_ENV on the host) must provide one, so we never sign auth/session tokens
// with a public default that would let anyone forge them.
const INSECURE_SECRETS = ['', 'supersecret', 'secret', 'changeme', 'change-me-in-production']
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'

function requireSecret(name: 'JWT_SECRET' | 'COOKIE_SECRET'): string {
  const value = process.env[name] ?? ''
  if (INSECURE_SECRETS.includes(value)) {
    if (!IS_DEV)
      throw new Error(
        `${name} must be set to a secure random value ` +
        `(NODE_ENV is "${process.env.NODE_ENV ?? 'unset'}", not development/test)`
      )
    return 'dev-insecure-do-not-use-in-prod'
  }
  return value
}

const JWT_SECRET = requireSecret('JWT_SECRET')
const COOKIE_SECRET = requireSecret('COOKIE_SECRET')

module.exports = defineConfig({
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === 'true',
    // Public URL the admin panel uses to reach the API in production
    ...(process.env.MEDUSA_BACKEND_URL ? { backendUrl: process.env.MEDUSA_BACKEND_URL } : {}),
    vite: (config) => ({
      ...config,
      // Move the dep cache inside the Vite root so Vite doesn't generate
      // @fs/C:/... URLs that break Windows URL routing
      cacheDir: (config.root ?? '') + '/.vite',
    }),
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    databaseDriverOptions: process.env.NODE_ENV === "production"
      ? { ssl: { rejectUnauthorized: false } }
      : {},
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: JWT_SECRET,
      cookieSecret: COOKIE_SECRET,
    }
  },
  modules: [
    // Product images: S3-compatible object storage (Supabase Storage / R2 / S3)
    // behind a CDN. Only enabled when S3_BUCKET is configured — uploads through
    // Medusa Admin land in the bucket and the public CDN URL is stored on the
    // product record.
    ...(process.env.S3_BUCKET
      ? [
          {
            resolve: "@medusajs/medusa/file",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/file-s3",
                  id: "s3",
                  options: {
                    file_url: process.env.S3_FILE_URL,
                    access_key_id: process.env.S3_ACCESS_KEY_ID,
                    secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
                    region: process.env.S3_REGION || "auto",
                    bucket: process.env.S3_BUCKET,
                    endpoint: process.env.S3_ENDPOINT,
                    // Supabase Storage (and MinIO) require path-style URLs
                    additional_client_config: { forcePathStyle: true },
                  },
                },
              ],
            },
          },
        ]
      : []),
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "@medusajs/payment-stripe",
            id: "stripe",
            options: {
              apiKey: process.env.STRIPE_SECRET_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
              automaticPaymentMethods: true,
            },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/fulfillment",
      options: {
        providers: [
          {
            resolve: "./src/modules/melhor-envio",
            id: "melhor-envio",
            options: {
              token: process.env.MELHOR_ENVIO_TOKEN,
              sandbox: process.env.MELHOR_ENVIO_SANDBOX === "true",
            },
          },
        ],
      },
    },
  ],
})
