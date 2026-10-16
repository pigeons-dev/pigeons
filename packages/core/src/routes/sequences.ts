import { Router } from 'express'
import { z } from 'zod'
import { eq, desc, and, lt } from 'drizzle-orm'
import { sequences, sequenceSteps, sequenceEnrollments, contacts, jobs } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const stepSchema = z.object({
  type: z.enum(['email', 'delay', 'condition']),
  templateId: z.string().optional(),
  templateData: z.record(z.unknown()).optional(),
  subject: z.string().optional(),
  delayDuration: z.string().optional(),
  condition: z.record(z.unknown()).optional(),
})

const createSequenceSchema = z.object({
  name: z.string().min(1),
  trigger: z.object({
    event: z.string(),
    filter: z.record(z.unknown()).optional(),
  }).optional(),
  steps: z.array(stepSchema).optional(),
})

const updateSequenceSchema = z.object({
  name: z.string().min(1).optional(),
  trigger: z.object({
    event: z.string(),
    filter: z.record(z.unknown()).optional(),
  }).optional(),
  steps: z.array(stepSchema).optional(),
})

export function createSequenceRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = createSequenceSchema.parse(req.body)
      const id = generateId('sequence')

      await db.insert(sequences).values({
        id,
        name: body.name,
        trigger: body.trigger ?? null,
      })

      if (body.steps?.length) {
        for (let i = 0; i < body.steps.length; i++) {
          const step = body.steps[i]
          await db.insert(sequenceSteps).values({
            id: generateId('sequenceStep'),
            sequenceId: id,
            position: i,
            type: step.type,
            templateId: step.templateId ?? null,
            templateData: step.templateData ?? null,
            subject: step.subject ?? null,
            delayDuration: step.delayDuration ?? null,
            condition: step.condition ?? null,
          })
        }
      }

      const [created] = await db.select().from(sequences).where(eq(sequences.id, id)).limit(1)
      const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, id)).orderBy(sequenceSteps.position)
      res.status(201).json({ ...created, steps })
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
      if (cursor) conditions.push(lt(sequences.createdAt, cursor))
      if (status) conditions.push(eq(sequences.status, status as any))

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const data = await db
        .select()
        .from(sequences)
        .where(where)
        .orderBy(desc(sequences.createdAt))
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
      const [sequence] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, req.params.id))
        .limit(1)

      if (!sequence) throw new NotFoundError('Sequence', req.params.id)

      const steps = await db
        .select()
        .from(sequenceSteps)
        .where(eq(sequenceSteps.sequenceId, sequence.id))
        .orderBy(sequenceSteps.position)

      res.json({ ...sequence, steps })
    } catch (err) {
      next(err)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const body = updateSequenceSchema.parse(req.body)

      const [existing] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, req.params.id))
        .limit(1)

      if (!existing) throw new NotFoundError('Sequence', req.params.id)
      if (existing.status === 'active') {
        throw new ValidationError('Pause the sequence before updating')
      }

      const updates: Record<string, unknown> = {}
      if (body.name !== undefined) updates.name = body.name
      if (body.trigger !== undefined) updates.trigger = body.trigger

      if (Object.keys(updates).length > 0) {
        await db.update(sequences).set(updates).where(eq(sequences.id, existing.id))
      }

      if (body.steps) {
        await db.delete(sequenceSteps).where(eq(sequenceSteps.sequenceId, existing.id))
        for (let i = 0; i < body.steps.length; i++) {
          const step = body.steps[i]
          await db.insert(sequenceSteps).values({
            id: generateId('sequenceStep'),
            sequenceId: existing.id,
            position: i,
            type: step.type,
            templateId: step.templateId ?? null,
            templateData: step.templateData ?? null,
            subject: step.subject ?? null,
            delayDuration: step.delayDuration ?? null,
            condition: step.condition ?? null,
          })
        }
      }

      const [updated] = await db.select().from(sequences).where(eq(sequences.id, existing.id)).limit(1)
      const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, existing.id)).orderBy(sequenceSteps.position)
      res.json({ ...updated, steps })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/activate', async (req, res, next) => {
    try {
      const [sequence] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, req.params.id))
        .limit(1)

      if (!sequence) throw new NotFoundError('Sequence', req.params.id)
      if (sequence.status === 'active') {
        throw new ValidationError('Sequence is already active')
      }

      const steps = await db
        .select()
        .from(sequenceSteps)
        .where(eq(sequenceSteps.sequenceId, sequence.id))

      if (steps.length === 0) {
        throw new ValidationError('Sequence must have at least one step')
      }

      await db.update(sequences).set({ status: 'active' }).where(eq(sequences.id, sequence.id))

      const [updated] = await db.select().from(sequences).where(eq(sequences.id, sequence.id)).limit(1)
      res.json({ ...updated, steps })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/pause', async (req, res, next) => {
    try {
      const [sequence] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, req.params.id))
        .limit(1)

      if (!sequence) throw new NotFoundError('Sequence', req.params.id)
      if (sequence.status !== 'active') {
        throw new ValidationError('Only active sequences can be paused')
      }

      await db.update(sequences).set({ status: 'paused' }).where(eq(sequences.id, sequence.id))

      const [updated] = await db.select().from(sequences).where(eq(sequences.id, sequence.id)).limit(1)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/enroll', async (req, res, next) => {
    try {
      const { contactId } = z.object({ contactId: z.string() }).parse(req.body)

      const [sequence] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, req.params.id))
        .limit(1)

      if (!sequence) throw new NotFoundError('Sequence', req.params.id)
      if (sequence.status !== 'active') {
        throw new ValidationError('Can only enroll contacts in active sequences')
      }

      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)

      if (!contact) throw new NotFoundError('Contact', contactId)

      const steps = await db
        .select()
        .from(sequenceSteps)
        .where(eq(sequenceSteps.sequenceId, sequence.id))
        .orderBy(sequenceSteps.position)
        .limit(1)

      const enrollmentId = generateId('sequenceEnrollment')
      await db.insert(sequenceEnrollments).values({
        id: enrollmentId,
        sequenceId: sequence.id,
        contactId,
        currentStepId: steps[0]?.id ?? null,
      })

      const currentStats = sequence.stats
      await db.update(sequences).set({
        stats: { ...currentStats, enrolled: currentStats.enrolled + 1, active: currentStats.active + 1 },
      }).where(eq(sequences.id, sequence.id))

      if (steps[0]) {
        await db.insert(jobs).values({
          id: generateId('job'),
          type: 'process_sequence_step',
          payload: { enrollmentId, stepId: steps[0].id },
        })
      }

      const [enrollment] = await db
        .select()
        .from(sequenceEnrollments)
        .where(eq(sequenceEnrollments.id, enrollmentId))
        .limit(1)

      res.status(201).json(enrollment)
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/enrollments', async (req, res, next) => {
    try {
      const [sequence] = await db
        .select()
        .from(sequences)
        .where(eq(sequences.id, req.params.id))
        .limit(1)

      if (!sequence) throw new NotFoundError('Sequence', req.params.id)

      const limit = Math.min(parseInt(req.query.limit as string) || 25, 100)
      const cursor = req.query.cursor as string | undefined
      const status = req.query.status as string | undefined

      const conditions = [eq(sequenceEnrollments.sequenceId, sequence.id)]
      if (cursor) conditions.push(lt(sequenceEnrollments.enrolledAt, cursor))
      if (status) conditions.push(eq(sequenceEnrollments.status, status as any))

      const data = await db
        .select()
        .from(sequenceEnrollments)
        .where(and(...conditions))
        .orderBy(desc(sequenceEnrollments.enrolledAt))
        .limit(limit + 1)

      const hasMore = data.length > limit
      if (hasMore) data.pop()

      res.json({
        data,
        has_more: hasMore,
        next_cursor: hasMore ? data[data.length - 1].enrolledAt : null,
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
