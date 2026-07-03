import { loadEnv, defineConfig } from '@medusajs/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    // "shared" handles HTTP + async in one process (right for a single Render dyno).
    // Set MEDUSA_WORKER_MODE=server on the web dyno + worker on a background worker
    // dyno if you ever split them.
    workerMode: (process.env.MEDUSA_WORKER_MODE as 'shared' | 'server' | 'worker') ?? 'shared',

    databaseUrl: process.env.DATABASE_URL,

    // When REDIS_URL is set Medusa automatically uses Redis for the event bus,
    // cache module, and workflow engine.  Without it Medusa falls back to
    // in-process fakes (fine for dev, not for production).
    redisUrl: process.env.REDIS_URL,

    http: {
      port: Number(process.env.PORT) || 9000,
      host: process.env.HOST ?? '0.0.0.0',
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
      cookieSecret: process.env.COOKIE_SECRET ?? 'change-me-in-production',
    },
  },
  modules: [
    {
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            resolve: '@medusajs/payment-stripe',
            id: 'stripe',
            options: {
              apiKey: process.env.STRIPE_API_KEY,
              webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            },
          },
        ],
      },
    },
  ],
})
