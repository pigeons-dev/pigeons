import { Router } from 'express'
import { z } from 'zod'
import { eq, desc, lt, and, inArray } from 'drizzle-orm'
import { contacts } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js'
import type { DB } from '../db/index.js'

const createContactSchema = z.object({
  email: z.string().email(),
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  tags: z.array(z.string()).optional(),
  properties: z.record(z.unknown()).optional(),
})

const updateContactSchema = z.object({
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  tags: z.array(z.string()).optional(),
  properties: z.record(z.unknown()).optional(),
})

const batchCreateSchema = z.array(createContactSchema).min(1).max(1000)

export function createContactRoutes(db: DB): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createContactSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.email, body.email))
        .limit(1)

      if (existing) throw new ConflictError(`Contact with email '${body.email}' already exists`)

      const id = generateId('contact')
      await db.insert(contacts).values({
        id,
        email: body.email,
        firstName: body.firstName ?? null,
        lastName: body.lastName ?? null,
        tags: body.tags ?? null,
        properties: body.properties ?? null,
      })

      const [created] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
      res.status(201).json(created)
    } catch (err) {
      next(err)
    }
  })

  router.post('/batch', async (req, res, next) => {
    try {
      const items = batchCreateSchema.parse(req.body)

      const results = []
      let created = 0
      let skipped = 0

      for (const item of items) {
        const [existing] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.email, item.email))
          .limit(1)

        if (existing) {
          skipped++
          continue
        }

        const id = generateId('contact')
        await db.insert(contacts).values({
          id,
          email: item.email,
          firstName: item.firstName ?? null,
          lastName: item.lastName ?? null,
          tags: item.tags ?? null,
          properties: item.properties ?? null,
        })

        results.push({ id, email: item.email })
        created++
      }

      res.status(201).json({ created, skipped, contacts: results })
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100)
      const cursor = req.query.cursor as string | undefined
      const tag = req.query.tag as string | undefined

      const conditions = []
      if (cursor) conditions.push(lt(contacts.createdAt, cursor))

      const where = conditions.length > 0 ? and(...conditions) : undefined
      let data = await db
        .select()
        .from(contacts)
        .where(where)
        .orderBy(desc(contacts.createdAt))
        .limit(limit + 1)

      if (tag) {
        data = data.filter((c) => c.tags?.includes(tag))
      }

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

  router.get('/:idOrEmail', async (req, res, next) => {
    try {
      const param = req.params.idOrEmail
      const isId = param.startsWith('ctc_')

      const [contact] = await db
        .select()
        .from(contacts)
        .where(isId ? eq(contacts.id, param) : eq(contacts.email, param))
        .limit(1)

      if (!contact) throw new NotFoundError('Contact', param)
      res.json(contact)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:idOrEmail', async (req, res, next) => {
    try {
      const param = req.params.idOrEmail
      const isId = param.startsWith('ctc_')
      const body = updateContactSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(contacts)
        .where(isId ? eq(contacts.id, param) : eq(contacts.email, param))
        .limit(1)

      if (!existing) throw new NotFoundError('Contact', param)

      const updates: Record<string, unknown> = {}
      if (body.firstName !== undefined) updates.firstName = body.firstName
      if (body.lastName !== undefined) updates.lastName = body.lastName
      if (body.tags !== undefined) updates.tags = body.tags
      if (body.properties !== undefined) updates.properties = body.properties

      await db.update(contacts).set(updates).where(eq(contacts.id, existing.id))

      const [updated] = await db.select().from(contacts).where(eq(contacts.id, existing.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:idOrEmail', async (req, res, next) => {
    try {
      const param = req.params.idOrEmail
      const isId = param.startsWith('ctc_')

      const [existing] = await db
        .select()
        .from(contacts)
        .where(isId ? eq(contacts.id, param) : eq(contacts.email, param))
        .limit(1)

      if (!existing) throw new NotFoundError('Contact', param)

      await db.delete(contacts).where(eq(contacts.id, existing.id))
      res.json({ id: existing.id, deleted: true })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:idOrEmail/unsubscribe', async (req, res, next) => {
    try {
      const param = req.params.idOrEmail
      const isId = param.startsWith('ctc_')

      const [existing] = await db
        .select()
        .from(contacts)
        .where(isId ? eq(contacts.id, param) : eq(contacts.email, param))
        .limit(1)

      if (!existing) throw new NotFoundError('Contact', param)

      await db.update(contacts).set({
        unsubscribed: true,
        unsubscribedAt: new Date().toISOString(),
      }).where(eq(contacts.id, existing.id))

      const [updated] = await db.select().from(contacts).where(eq(contacts.id, existing.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:idOrEmail/resubscribe', async (req, res, next) => {
    try {
      const param = req.params.idOrEmail
      const isId = param.startsWith('ctc_')

      const [existing] = await db
        .select()
        .from(contacts)
        .where(isId ? eq(contacts.id, param) : eq(contacts.email, param))
        .limit(1)

      if (!existing) throw new NotFoundError('Contact', param)

      await db.update(contacts).set({
        unsubscribed: false,
        unsubscribedAt: null,
      }).where(eq(contacts.id, existing.id))

      const [updated] = await db.select().from(contacts).where(eq(contacts.id, existing.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  return router
}
