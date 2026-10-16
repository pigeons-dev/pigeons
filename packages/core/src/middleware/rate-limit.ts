import type { Request, Response, NextFunction } from 'express'
import { RateLimitError } from '../utils/errors.js'

interface RateLimitStore {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitStore>()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}, 60_000)

export function rateLimit(opts: { windowMs?: number; max?: number } = {}) {
  const windowMs = opts.windowMs ?? 1000
  const max = opts.max ?? 100

  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as any).apiKey?.id ?? req.ip ?? 'anonymous'
    const now = Date.now()
    let entry = store.get(key)

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    res.setHeader('X-RateLimit-Limit', max)
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count))
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000))

    if (entry.count > max) {
      return next(new RateLimitError())
    }

    next()
  }
}
