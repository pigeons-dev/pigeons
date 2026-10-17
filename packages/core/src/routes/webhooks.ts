import { Router } from 'express'
import { z } from 'zod'
import {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
} from '../services/webhook-service.js'
import { validateWebhookUrl } from '../utils/url-validation.js'
import type { DB } from '../db/index.js'

const VALID_WEBHOOK_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.bounced',
  'email.complained',
  'email.failed',
  'inbox.message.received',
  'inbox.message.sent',
  'contact.created',
  'contact.updated',
  'contact.unsubscribed',
  'campaign.sent',
  'campaign.completed',
  'sequence.step.sent',
] as const

const webhookEventSchema = z.string().refine(
  (e) => (VALID_WEBHOOK_EVENTS as readonly string[]).includes(e),
  { message: 'Invalid webhook event type' },
)

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1),
  secret: z.string().min(16).optional(),
})

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export function createWebhookRoutes(db: DB): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createWebhookSchema.parse(req.body)
      await validateWebhookUrl(body.url)
      const result = await createWebhook(db, body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const result = await listWebhooks(db, {
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        cursor: req.query.cursor as string | undefined,
      })
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await getWebhook(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateWebhookSchema.parse(req.body)
      if (body.url) await validateWebhookUrl(body.url)
      const result = await updateWebhook(db, req.params.id, body)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await deleteWebhook(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}
