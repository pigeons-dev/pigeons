import { Router } from 'express'
import { z } from 'zod'
import { eq, desc, lt, and } from 'drizzle-orm'
import { subscriptionTopics } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ConflictError } from '../utils/errors.js'
import type { DB } from '../db/index.js'

const createTopicSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

const updateTopicSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
})

export function createTopicRoutes(db: DB): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createTopicSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(subscriptionTopics)
        .where(eq(subscriptionTopics.name, body.name))
        .limit(1)

      if (existing) throw new ConflictError(`Topic with name '${body.name}' already exists`)

      const id = generateId('subscriptionTopic')
      await db.insert(subscriptionTopics).values({
        id,
        name: body.name,
        description: body.description ?? null,
      })

      const [created] = await db.select().from(subscriptionTopics).where(eq(subscriptionTopics.id, id)).limit(1)
      res.status(201).json(created)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100)
      const cursor = req.query.cursor as string | undefined

      const conditions = []
      if (cursor) conditions.push(lt(subscriptionTopics.createdAt, cursor))

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const data = await db
        .select()
        .from(subscriptionTopics)
        .where(where)
        .orderBy(desc(subscriptionTopics.createdAt))
        .limit(limit + 1)

      const hasMore = data.length > limit
      if (hasMore) data.pop()

      res.json({
        data,
        has_more: hasMore,
        next_cursor: hasMore ? data[data.length - 1].createdAt : null,
      })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const [topic] = await db
        .select()
        .from(subscriptionTopics)
        .where(eq(subscriptionTopics.id, req.params.id))
        .limit(1)

      if (!topic) throw new NotFoundError('Topic', req.params.id)
      res.json(topic)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateTopicSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(subscriptionTopics)
        .where(eq(subscriptionTopics.id, req.params.id))
        .limit(1)

      if (!existing) throw new NotFoundError('Topic', req.params.id)

      if (body.name && body.name !== existing.name) {
        const [dupe] = await db
          .select()
          .from(subscriptionTopics)
          .where(eq(subscriptionTopics.name, body.name))
          .limit(1)
        if (dupe) throw new ConflictError(`Topic with name '${body.name}' already exists`)
      }

      const updates: Record<string, unknown> = {}
      if (body.name !== undefined) updates.name = body.name
      if (body.description !== undefined) updates.description = body.description

      await db.update(subscriptionTopics).set(updates).where(eq(subscriptionTopics.id, existing.id))

      const [updated] = await db.select().from(subscriptionTopics).where(eq(subscriptionTopics.id, existing.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const [existing] = await db
        .select()
        .from(subscriptionTopics)
        .where(eq(subscriptionTopics.id, req.params.id))
        .limit(1)

      if (!existing) throw new NotFoundError('Topic', req.params.id)

      await db.delete(subscriptionTopics).where(eq(subscriptionTopics.id, existing.id))
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  })

  return router
}
