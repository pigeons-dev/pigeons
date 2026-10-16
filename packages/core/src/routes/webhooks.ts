import { Router } from 'express'
import { z } from 'zod'
import {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
} from '../services/webhook-service.js'
import type { DB } from '../db/index.js'

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(16).optional(),
})

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).min(1).optional(),
  status: z.enum(['active', 'disabled']).optional(),
})

export function createWebhookRoutes(db: DB): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createWebhookSchema.parse(req.body)
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
