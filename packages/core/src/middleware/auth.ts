import type { Request, Response, NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { apiKeys } from '../db/schema.js'
import { hashApiKey } from '../utils/crypto.js'
import { AuthError } from '../utils/errors.js'
import type { DB } from '../db/index.js'

export function createAuthMiddleware(db: DB) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return next(new AuthError())
    }

    const token = authHeader.slice(7)
    if (!token.startsWith('pgn_')) {
      return next(new AuthError())
    }

    const hash = hashApiKey(token)
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).limit(1)

    if (!key) {
      return next(new AuthError())
    }

    if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      return next(new AuthError('API key has expired'))
    }

    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.id, key.id))

    ;(req as any).apiKey = key
    next()
  }
}
