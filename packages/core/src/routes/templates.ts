import { Router } from 'express'
import { z } from 'zod'
import { eq, desc, lt } from 'drizzle-orm'
import { templates } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ConflictError } from '../utils/errors.js'
import { renderTemplate, interpolateSubject } from '../services/template-renderer.js'
import type { DB } from '../db/index.js'

const createTemplateSchema = z.object({
  slug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(255),
  subject: z.string().min(1),
  body: z.string().min(1),
  sampleData: z.record(z.unknown()).optional(),
})

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  sampleData: z.record(z.unknown()).optional(),
})

export function createTemplateRoutes(db: DB): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createTemplateSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(templates)
        .where(eq(templates.slug, body.slug))
        .limit(1)

      if (existing) throw new ConflictError(`Template with slug '${body.slug}' already exists`)

      const id = generateId('template')
      await db.insert(templates).values({
        id,
        slug: body.slug,
        name: body.name,
        subject: body.subject,
        body: body.body,
        sampleData: body.sampleData ?? null,
      })

      const [created] = await db.select().from(templates).where(eq(templates.id, id)).limit(1)
      res.status(201).json(created)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100)
      const cursor = req.query.cursor as string | undefined

      const where = cursor ? lt(templates.createdAt, cursor) : undefined
      const data = await db
        .select()
        .from(templates)
        .where(where)
        .orderBy(desc(templates.createdAt))
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

  router.get('/:idOrSlug', async (req, res, next) => {
    try {
      const param = req.params.idOrSlug
      const isId = param.startsWith('tpl_')

      const [template] = await db
        .select()
        .from(templates)
        .where(isId ? eq(templates.id, param) : eq(templates.slug, param))
        .limit(1)

      if (!template) throw new NotFoundError('Template', param)
      res.json(template)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:idOrSlug', async (req, res, next) => {
    try {
      const param = req.params.idOrSlug
      const isId = param.startsWith('tpl_')
      const body = updateTemplateSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(templates)
        .where(isId ? eq(templates.id, param) : eq(templates.slug, param))
        .limit(1)

      if (!existing) throw new NotFoundError('Template', param)

      const updates: Record<string, unknown> = {}
      if (body.name !== undefined) updates.name = body.name
      if (body.subject !== undefined) updates.subject = body.subject
      if (body.body !== undefined) updates.body = body.body
      if (body.sampleData !== undefined) updates.sampleData = body.sampleData
      if (body.body !== undefined || body.subject !== undefined) {
        updates.version = existing.version + 1
      }

      await db.update(templates).set(updates).where(eq(templates.id, existing.id))

      const [updated] = await db.select().from(templates).where(eq(templates.id, existing.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:idOrSlug', async (req, res, next) => {
    try {
      const param = req.params.idOrSlug
      const isId = param.startsWith('tpl_')

      const [existing] = await db
        .select()
        .from(templates)
        .where(isId ? eq(templates.id, param) : eq(templates.slug, param))
        .limit(1)

      if (!existing) throw new NotFoundError('Template', param)

      await db.delete(templates).where(eq(templates.id, existing.id))
      res.json({ id: existing.id, deleted: true })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:idOrSlug/preview', async (req, res, next) => {
    try {
      const param = req.params.idOrSlug
      const isId = param.startsWith('tpl_')

      const [template] = await db
        .select()
        .from(templates)
        .where(isId ? eq(templates.id, param) : eq(templates.slug, param))
        .limit(1)

      if (!template) throw new NotFoundError('Template', param)

      const data = req.body?.data ?? template.sampleData ?? {}
      const { html, text } = await renderTemplate(template.body, data)
      const subject = interpolateSubject(template.subject, data)

      res.json({ subject, html, text })
    } catch (err) {
      next(err)
    }
  })

  return router
}
