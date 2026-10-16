import { Router } from 'express'
import { z } from 'zod'
import { eq, desc, and, lt, gt, inArray } from 'drizzle-orm'
import { emails, jobs } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const sendEmailSchema = z.object({
  from: z.string().email().optional(),
  to: z.union([z.string().email(), z.array(z.string().email())]),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  html: z.string().optional(),
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  scheduledAt: z.string().datetime().optional(),
})

export function createEmailRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = sendEmailSchema.parse(req.body)
      if (!body.html && !body.text) {
        throw new ValidationError('Either html or text is required')
      }

      const to = Array.isArray(body.to) ? body.to : [body.to]
      const id = generateId('email')
      const from = body.from ?? config.fromEmail

      await db.insert(emails).values({
        id,
        from,
        to,
        cc: body.cc ?? null,
        bcc: body.bcc ?? null,
        subject: body.subject,
        html: body.html ?? null,
        text: body.text ?? null,
        status: body.scheduledAt ? 'queued' : 'queued',
        tags: body.tags ?? null,
        headers: body.headers ?? null,
        idempotencyKey: (req.headers['idempotency-key'] as string) ?? null,
        scheduledAt: body.scheduledAt ?? null,
      })

      const jobId = generateId('job')
      await db.insert(jobs).values({
        id: jobId,
        type: 'send_email',
        payload: { emailId: id },
        runAt: body.scheduledAt ?? new Date().toISOString(),
      })

      res.status(201).json({
        id,
        status: 'queued',
        from,
        to,
        subject: body.subject,
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/batch', async (req, res, next) => {
    try {
      const bodySchema = z.array(sendEmailSchema).min(1).max(100)
      const items = bodySchema.parse(req.body)

      const results = []
      for (const item of items) {
        const to = Array.isArray(item.to) ? item.to : [item.to]
        const id = generateId('email')
        const from = item.from ?? config.fromEmail

        await db.insert(emails).values({
          id,
          from,
          to,
          cc: item.cc ?? null,
          bcc: item.bcc ?? null,
          subject: item.subject,
          html: item.html ?? null,
          text: item.text ?? null,
          status: 'queued',
          tags: item.tags ?? null,
          headers: item.headers ?? null,
        })

        await db.insert(jobs).values({
          id: generateId('job'),
          type: 'send_email',
          payload: { emailId: id },
        })

        results.push({ id, status: 'queued', from, to, subject: item.subject })
      }

      res.status(201).json(results)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const [email] = await db
        .select()
        .from(emails)
        .where(eq(emails.id, req.params.id))
        .limit(1)

      if (!email) throw new NotFoundError('Email', req.params.id)
      res.json(email)
    } catch (err) {
      next(err)
    }
  })

  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100)
      const cursor = req.query.cursor as string | undefined
      const status = req.query.status as string | undefined

      const conditions = []
      if (cursor) conditions.push(lt(emails.createdAt, cursor))
      if (status) {
        const validStatuses = ['queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed'] as const
        if (!validStatuses.includes(status as any)) {
          throw new ValidationError(`Invalid status: ${status}`)
        }
        conditions.push(eq(emails.status, status as any))
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const data = await db
        .select()
        .from(emails)
        .where(where)
        .orderBy(desc(emails.createdAt))
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

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const [email] = await db
        .select()
        .from(emails)
        .where(eq(emails.id, req.params.id))
        .limit(1)

      if (!email) throw new NotFoundError('Email', req.params.id)
      if (email.status !== 'queued') {
        throw new ValidationError(`Cannot cancel email with status '${email.status}'`)
      }

      await db.update(emails).set({ status: 'failed' }).where(eq(emails.id, email.id))

      res.json({ ...email, status: 'failed' })
    } catch (err) {
      next(err)
    }
  })

  return router
}
