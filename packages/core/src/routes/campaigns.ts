import { Router } from 'express'
import { z } from 'zod'
import { eq, desc, and, lt } from 'drizzle-orm'
import { campaigns, contacts, jobs } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'
import { matchAudienceFilter } from '../services/audience-filter.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const createCampaignSchema = z.object({
  name: z.string().min(1),
  subject: z.string().optional(),
  templateId: z.string().optional(),
  templateData: z.record(z.unknown()).optional(),
  fromName: z.string().optional(),
  fromEmail: z.string().email().optional(),
  audienceFilter: z.record(z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional(),
})

const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  subject: z.string().optional(),
  templateId: z.string().optional(),
  templateData: z.record(z.unknown()).optional(),
  fromName: z.string().optional(),
  fromEmail: z.string().email().optional(),
  audienceFilter: z.record(z.unknown()).optional(),
  scheduledAt: z.string().datetime().optional(),
})

export function createCampaignRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createCampaignSchema.parse(req.body)
      const id = generateId('campaign')

      await db.insert(campaigns).values({
        id,
        name: body.name,
        subject: body.subject ?? null,
        templateId: body.templateId ?? null,
        templateData: body.templateData ?? null,
        fromName: body.fromName ?? null,
        fromEmail: body.fromEmail ?? null,
        audienceFilter: body.audienceFilter ?? null,
        scheduledAt: body.scheduledAt ?? null,
      })

      const [created] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1)
      res.status(201).json(created)
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
      if (cursor) conditions.push(lt(campaigns.createdAt, cursor))
      if (status) conditions.push(eq(campaigns.status, status as any))

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const data = await db
        .select()
        .from(campaigns)
        .where(where)
        .orderBy(desc(campaigns.createdAt))
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
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, req.params.id))
        .limit(1)

      if (!campaign) throw new NotFoundError('Campaign', req.params.id)
      res.json(campaign)
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateCampaignSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, req.params.id))
        .limit(1)

      if (!existing) throw new NotFoundError('Campaign', req.params.id)
      if (existing.status !== 'draft') {
        throw new ValidationError('Only draft campaigns can be updated')
      }

      const updates: Record<string, unknown> = {}
      if (body.name !== undefined) updates.name = body.name
      if (body.subject !== undefined) updates.subject = body.subject
      if (body.templateId !== undefined) updates.templateId = body.templateId
      if (body.templateData !== undefined) updates.templateData = body.templateData
      if (body.fromName !== undefined) updates.fromName = body.fromName
      if (body.fromEmail !== undefined) updates.fromEmail = body.fromEmail
      if (body.audienceFilter !== undefined) updates.audienceFilter = body.audienceFilter
      if (body.scheduledAt !== undefined) updates.scheduledAt = body.scheduledAt

      await db.update(campaigns).set(updates).where(eq(campaigns.id, existing.id))

      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, existing.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/send', async (req, res, next) => {
    try {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, req.params.id))
        .limit(1)

      if (!campaign) throw new NotFoundError('Campaign', req.params.id)
      if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
        throw new ValidationError(`Cannot send campaign with status '${campaign.status}'`)
      }
      if (!campaign.templateId && !campaign.subject) {
        throw new ValidationError('Campaign must have a templateId or subject')
      }

      const allContacts = await db.select().from(contacts)
      const audience = campaign.audienceFilter
        ? allContacts.filter((c) => matchAudienceFilter(c, campaign.audienceFilter!))
        : allContacts
      const eligible = audience.filter((c) => !c.unsubscribed && !c.bounced && !c.complained)

      if (eligible.length === 0) {
        throw new ValidationError('No eligible contacts match the audience filter')
      }

      const scheduledAt = req.body?.scheduledAt ?? campaign.scheduledAt
      const newStatus = scheduledAt ? 'scheduled' : 'sending'

      await db.update(campaigns).set({
        status: newStatus,
        scheduledAt: scheduledAt ?? null,
        startedAt: scheduledAt ? null : new Date().toISOString(),
        stats: { total: eligible.length, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 },
      }).where(eq(campaigns.id, campaign.id))

      await db.insert(jobs).values({
        id: generateId('job'),
        type: 'send_campaign',
        payload: {
          campaignId: campaign.id,
          contactIds: eligible.map((c) => c.id),
        },
        runAt: scheduledAt ?? new Date().toISOString(),
      })

      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, req.params.id))
        .limit(1)

      if (!campaign) throw new NotFoundError('Campaign', req.params.id)
      if (campaign.status !== 'sending' && campaign.status !== 'scheduled') {
        throw new ValidationError(`Cannot cancel campaign with status '${campaign.status}'`)
      }

      await db.update(campaigns).set({ status: 'cancelled' }).where(eq(campaigns.id, campaign.id))

      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/pause', async (req, res, next) => {
    try {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, req.params.id))
        .limit(1)

      if (!campaign) throw new NotFoundError('Campaign', req.params.id)
      if (campaign.status !== 'sending') {
        throw new ValidationError('Only sending campaigns can be paused')
      }

      await db.update(campaigns).set({ status: 'paused' }).where(eq(campaigns.id, campaign.id))

      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/resume', async (req, res, next) => {
    try {
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, req.params.id))
        .limit(1)

      if (!campaign) throw new NotFoundError('Campaign', req.params.id)
      if (campaign.status !== 'paused') {
        throw new ValidationError('Only paused campaigns can be resumed')
      }

      await db.update(campaigns).set({ status: 'sending' }).where(eq(campaigns.id, campaign.id))

      await db.insert(jobs).values({
        id: generateId('job'),
        type: 'send_campaign',
        payload: { campaignId: campaign.id, contactIds: [] },
      })

      const [updated] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  return router
}
