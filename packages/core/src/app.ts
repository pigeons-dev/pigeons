import express, { type Express } from 'express'
import { createAuthMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { createIdempotencyMiddleware } from './middleware/idempotency.js'
import { rateLimit } from './middleware/rate-limit.js'
import { createEmailRoutes } from './routes/emails.js'
import { createDomainRoutes } from './routes/domains.js'
import { createApiKeyRoutes } from './routes/api-keys.js'
import { createTemplateRoutes } from './routes/templates.js'
import { createContactRoutes } from './routes/contacts.js'
import { createSesEventRoutes } from './routes/ses-events.js'
import { createInboxRoutes } from './routes/inboxes.js'
import { createSesInboundRoutes } from './routes/ses-inbound.js'
import { createWebhookRoutes } from './routes/webhooks.js'
import type { DB } from './db/index.js'
import type { Config } from './config.js'

export function createApp(db: DB, config: Config): Express {
  const app = express()

  // SNS sends notifications with Content-Type: text/plain containing JSON
  app.use(express.json({ limit: '1mb', type: ['application/json', 'text/plain'] }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' })
  })

  const auth = createAuthMiddleware(db)
  const idempotency = createIdempotencyMiddleware(db)

  const api = express.Router()
  api.use(auth)
  api.use(idempotency)

  const defaults = { emails: 100, domains: 10, apiKeys: 10, templates: 50, contacts: 50, inboxes: 50, webhooks: 10 }
  const rl = config.rateLimits ?? defaults
  api.use('/emails', rateLimit({ max: rl.emails }), createEmailRoutes(db, config))
  api.use('/domains', rateLimit({ max: rl.domains }), createDomainRoutes(db, config))
  api.use('/api-keys', rateLimit({ max: rl.apiKeys }), createApiKeyRoutes(db))
  api.use('/templates', rateLimit({ max: rl.templates }), createTemplateRoutes(db))
  api.use('/contacts', rateLimit({ max: rl.contacts }), createContactRoutes(db))
  api.use('/inboxes', rateLimit({ max: rl.inboxes }), createInboxRoutes(db, config))
  api.use('/webhooks', rateLimit({ max: rl.webhooks }), createWebhookRoutes(db))

  app.use('/v1/internal/ses', createSesEventRoutes(db))
  app.use('/v1/internal/ses/inbound', createSesInboundRoutes(db, config))

  app.use('/v1', api)

  app.use(errorHandler)

  return app
}
