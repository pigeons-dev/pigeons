import express, { type Express } from 'express'
import { createAuthMiddleware, requireScopes } from './middleware/auth.js'
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
import { createCampaignRoutes } from './routes/campaigns.js'
import { createSequenceRoutes } from './routes/sequences.js'
import { createTopicRoutes } from './routes/topics.js'
import { createTrackingRoutes } from './routes/tracking.js'
import type { DB } from './db/index.js'
import type { Config } from './config.js'

export function createApp(db: DB, config: Config): Express {
  const app = express()

  app.use(express.json({ limit: '1mb' }))

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '0')
    next()
  })

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' })
  })

  const auth = createAuthMiddleware(db)
  const idempotency = createIdempotencyMiddleware(db)

  const api = express.Router()
  api.use(auth)
  api.use(idempotency)

  const defaults = { emails: 100, domains: 10, apiKeys: 10, templates: 50, contacts: 50, inboxes: 50, webhooks: 10, campaigns: 50, sequences: 50, topics: 20 }
  const rl = config.rateLimits ?? defaults
  api.use('/emails', rateLimit({ max: rl.emails }), requireScopes('emails'), createEmailRoutes(db, config))
  api.use('/domains', rateLimit({ max: rl.domains }), requireScopes('domains'), createDomainRoutes(db, config))
  api.use('/api-keys', rateLimit({ max: rl.apiKeys }), requireScopes('api_keys'), createApiKeyRoutes(db))
  api.use('/templates', rateLimit({ max: rl.templates }), requireScopes('templates'), createTemplateRoutes(db))
  api.use('/contacts', rateLimit({ max: rl.contacts }), requireScopes('contacts'), createContactRoutes(db))
  api.use('/inboxes', rateLimit({ max: rl.inboxes }), requireScopes('inboxes'), createInboxRoutes(db, config))
  api.use('/webhooks', rateLimit({ max: rl.webhooks }), requireScopes('webhooks'), createWebhookRoutes(db))
  api.use('/campaigns', rateLimit({ max: rl.campaigns }), requireScopes('campaigns'), createCampaignRoutes(db, config))
  api.use('/sequences', rateLimit({ max: rl.sequences }), requireScopes('sequences'), createSequenceRoutes(db, config))
  api.use('/topics', rateLimit({ max: rl.topics }), requireScopes('topics'), createTopicRoutes(db))

  app.use('/v1/t', createTrackingRoutes(db, config))

  // SNS sends notifications with Content-Type: text/plain containing JSON
  const snsTextParser = express.json({ type: 'text/plain' })
  app.use('/v1/internal/ses', snsTextParser, createSesEventRoutes(db))
  app.use('/v1/internal/ses/inbound', snsTextParser, createSesInboundRoutes(db, config))

  app.use('/v1', api)

  app.use(errorHandler)

  return app
}
