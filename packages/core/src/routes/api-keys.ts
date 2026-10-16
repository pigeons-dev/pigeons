import { Router } from 'express'
import { z } from 'zod'
import { createApiKeyRecord, listApiKeys, revokeApiKey } from '../services/api-key-service.js'
import type { DB } from '../db/index.js'

const createKeySchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
})

export function createApiKeyRoutes(db: DB): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createKeySchema.parse(req.body)
      const result = await createApiKeyRecord(db, body)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (_req, res, next) => {
    try {
      const data = await listApiKeys(db)
      res.json({ data })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await revokeApiKey(db, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}
