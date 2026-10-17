import { Router } from 'express'
import { z } from 'zod'
import {
  addDomain,
  verifyDomain,
  listDomains,
  deleteDomain,
} from '../services/domain-service.js'
import { getDomainStats } from '../services/stats-service.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const addDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid domain format'),
  capabilities: z
    .object({
      sending: z.boolean().default(true),
      receiving: z.boolean().default(false),
    })
    .optional(),
})

export function createDomainRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = addDomainSchema.parse(req.body)
      const result = await addDomain(db, config, body.domain)
      res.status(201).json(result)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (_req, res, next) => {
    try {
      const data = await listDomains(db)
      res.json({ data })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/stats', async (req, res, next) => {
    try {
      const stats = await getDomainStats(db, req.params.id)
      res.json(stats)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/verify', async (req, res, next) => {
    try {
      const result = await verifyDomain(db, config, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await deleteDomain(db, config, req.params.id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  })

  return router
}
