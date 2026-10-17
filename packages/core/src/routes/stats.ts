import { Router } from 'express'
import { getGlobalStats } from '../services/stats-service.js'
import type { DB } from '../db/index.js'

export function createStatsRoutes(db: DB): Router {
  const router = Router()

  router.get('/', async (_req, res, next) => {
    try {
      const stats = await getGlobalStats(db)
      res.json(stats)
    } catch (err) {
      next(err)
    }
  })

  return router
}
