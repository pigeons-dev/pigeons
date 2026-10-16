import express, { type Express } from 'express'
import { createAuthMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { createIdempotencyMiddleware } from './middleware/idempotency.js'
import { rateLimit } from './middleware/rate-limit.js'
import { createEmailRoutes } from './routes/emails.js'
import { createDomainRoutes } from './routes/domains.js'
import { createApiKeyRoutes } from './routes/api-keys.js'
import type { DB } from './db/index.js'
import type { Config } from './config.js'

export function createApp(db: DB, config: Config): Express {
  const app = express()

  app.use(express.json({ limit: '1mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' })
  })

  const auth = createAuthMiddleware(db)
  const idempotency = createIdempotencyMiddleware(db)

  const api = express.Router()
  api.use(auth)
  api.use(idempotency)

  api.use('/emails', rateLimit({ max: 100 }), createEmailRoutes(db, config))
  api.use('/domains', rateLimit({ max: 10 }), createDomainRoutes(db, config))
  api.use('/api-keys', rateLimit({ max: 10 }), createApiKeyRoutes(db))

  app.use('/api/v1', api)

  app.use(errorHandler)

  return app
}
