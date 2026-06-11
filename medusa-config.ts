import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

if (process.env.NODE_ENV === 'production') {
  const insecureDefaults = ['supersecret', 'secret', 'changeme', '']
  if (insecureDefaults.includes(process.env.JWT_SECRET ?? ''))
    throw new Error('JWT_SECRET must be set to a secure random value in production')
  if (insecureDefaults.includes(process.env.COOKIE_SECRET ?? ''))
    throw new Error('COOKIE_SECRET must be set to a secure random value in production')
}

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
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  modules: [
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
