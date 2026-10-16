import type { Request, Response, NextFunction } from 'express'
import { eq, lt } from 'drizzle-orm'
import { idempotencyKeys } from '../db/schema.js'
import type { DB } from '../db/index.js'

export function createIdempotencyMiddleware(db: DB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'] as string | undefined
    if (!key) return next()

    // Clean expired keys
    db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date().toISOString())).run()

    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, key))
      .limit(1)

    if (existing) {
      res.status(existing.statusCode).json(existing.response)
      return
    }

    const originalJson = res.json.bind(res)
    res.json = function (body: any) {
      db.insert(idempotencyKeys)
        .values({
          key,
          response: body,
          statusCode: res.statusCode,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .run()
      return originalJson(body)
    }

    next()
  }
}
