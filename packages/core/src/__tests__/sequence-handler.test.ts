import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { handleProcessSequenceStep } from '../workers/handlers/process-sequence-step.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

let db: DB

const config: Config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 50,
  openTracking: false,
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
})

vi.mock('../services/email-sender.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'ses_mock_id' }),
}))

async function createSequence(status = 'active') {
  const id = generateId('sequence')
  await db.insert(schema.sequences).values({ id, name: 'Test Seq', status: status as any })
  return id
}

async function createStep(sequenceId: string, position: number, overrides: Partial<typeof schema.sequenceSteps.$inferInsert> = {}) {
  const id = generateId('sequenceStep')
  await db.insert(schema.sequenceSteps).values({
    id,
    sequenceId,
    position,
    type: 'email',
    subject: `Step ${position}`,
    ...overrides,
  })
  return id
}

async function createContact(overrides: Partial<typeof schema.contacts.$inferInsert> = {}) {
  const id = generateId('contact')
  await db.insert(schema.contacts).values({ id, email: `${id}@example.com`, ...overrides })
  return id
}

async function createEnrollment(sequenceId: string, contactId: string, stepId: string) {
  const id = generateId('sequenceEnrollment')
  await db.insert(schema.sequenceEnrollments).values({
    id,
    sequenceId,
    contactId,
    currentStepId: stepId,
    status: 'active',
  })
  return id
}

describe('handleProcessSequenceStep', () => {
  it('throws when enrollmentId or stepId is missing', async () => {
    await expect(handleProcessSequenceStep(db, config, {})).rejects.toThrow('Missing')
    await expect(handleProcessSequenceStep(db, config, { enrollmentId: 'enr_x' })).rejects.toThrow('Missing')
    await expect(handleProcessSequenceStep(db, config, { stepId: 'stp_x' })).rejects.toThrow('Missing')
  })

  it('skips processing for inactive enrollment', async () => {
    const seqId = await createSequence()
    const stepId = await createStep(seqId, 0)
    const contactId = await createContact()
    const enrollmentId = await createEnrollment(seqId, contactId, stepId)

    await db.update(schema.sequenceEnrollments).set({ status: 'completed' }).where(eq(schema.sequenceEnrollments.id, enrollmentId))
    await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
    expect(enrollment.status).toBe('completed')
  })

  it('skips processing for paused sequence', async () => {
    const seqId = await createSequence('paused')
    const stepId = await createStep(seqId, 0)
    const contactId = await createContact()
    const enrollmentId = await createEnrollment(seqId, contactId, stepId)

    await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
    expect(enrollment.status).toBe('active')
  })

  it('marks enrollment as failed when step does not exist', async () => {
    const seqId = await createSequence()
    const contactId = await createContact()
    const enrollmentId = await createEnrollment(seqId, contactId, 'stp_missing')

    await handleProcessSequenceStep(db, config, { enrollmentId, stepId: 'stp_missing' })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
    expect(enrollment.status).toBe('failed')
  })

  it('exits enrollment for unsubscribed contact', async () => {
    const seqId = await createSequence()
    const stepId = await createStep(seqId, 0)
    const contactId = await createContact({ unsubscribed: true })
    const enrollmentId = await createEnrollment(seqId, contactId, stepId)

    await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
    expect(enrollment.status).toBe('exited')
  })

  it('exits enrollment for bounced contact', async () => {
    const seqId = await createSequence()
    const stepId = await createStep(seqId, 0)
    const contactId = await createContact({ bounced: true })
    const enrollmentId = await createEnrollment(seqId, contactId, stepId)

    await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
    expect(enrollment.status).toBe('exited')
  })

  it('exits enrollment for complained contact', async () => {
    const seqId = await createSequence()
    const stepId = await createStep(seqId, 0)
    const contactId = await createContact({ complained: true })
    const enrollmentId = await createEnrollment(seqId, contactId, stepId)

    await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
    expect(enrollment.status).toBe('exited')
  })

  it('updates sequence exited stats when contact exits', async () => {
    const seqId = await createSequence()
    const stepId = await createStep(seqId, 0)
    const contactId = await createContact({ unsubscribed: true })
    const enrollmentId = await createEnrollment(seqId, contactId, stepId)

    await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

    const [seq] = await db.select().from(schema.sequences).where(eq(schema.sequences.id, seqId)).limit(1)
    expect(seq.stats.exited).toBeGreaterThanOrEqual(1)
  })

  describe('email steps', () => {
    it('creates an email record for email steps', async () => {
      const seqId = await createSequence()
      const stepId = await createStep(seqId, 0, { subject: 'Welcome' })
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, stepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

      const allEmails = await db.select().from(schema.emails)
      const seqEmails = allEmails.filter((e) => (e.tags as string[])?.includes(seqId))
      expect(seqEmails.length).toBeGreaterThanOrEqual(1)
      expect(seqEmails[0].subject).toBe('Welcome')
    })

    it('tags emails with sequence and step IDs', async () => {
      const seqId = await createSequence()
      const stepId = await createStep(seqId, 0)
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, stepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

      const allEmails = await db.select().from(schema.emails)
      const seqEmails = allEmails.filter((e) => (e.tags as string[])?.includes(seqId))
      expect(seqEmails[0].tags).toContain('sequence')
      expect(seqEmails[0].tags).toContain(seqId)
      expect(seqEmails[0].tags).toContain(stepId)
    })

    it('increments step sent stats', async () => {
      const seqId = await createSequence()
      const stepId = await createStep(seqId, 0)
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, stepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

      const [step] = await db.select().from(schema.sequenceSteps).where(eq(schema.sequenceSteps.id, stepId)).limit(1)
      expect(step.stats.sent).toBeGreaterThanOrEqual(1)
    })
  })

  describe('delay steps', () => {
    it('schedules next step with delay offset', async () => {
      const seqId = await createSequence()
      const delayStepId = await createStep(seqId, 0, { type: 'delay', delayDuration: '1d', subject: null })
      const emailStepId = await createStep(seqId, 1, { subject: 'After delay' })
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, delayStepId)

      const before = Date.now()
      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: delayStepId })

      const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'process_sequence_step'))
      const nextJob = allJobs.find((j) => {
        const p = j.payload as { stepId: string }
        return p.stepId === emailStepId
      })
      expect(nextJob).toBeTruthy()

      const runAt = new Date(nextJob!.runAt).getTime()
      expect(runAt).toBeGreaterThanOrEqual(before + 86_400_000 - 1000)
    })

    it('does not create email records for delay steps', async () => {
      const seqId = await createSequence()
      const delayStepId = await createStep(seqId, 0, { type: 'delay', delayDuration: '1h', subject: null })
      await createStep(seqId, 1)
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, delayStepId)

      const emailsBefore = await db.select().from(schema.emails)
      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: delayStepId })
      const emailsAfter = await db.select().from(schema.emails)

      const newEmails = emailsAfter.filter((e) => !emailsBefore.some((b) => b.id === e.id))
      expect(newEmails).toHaveLength(0)
    })
  })

  describe('condition steps', () => {
    it('continues when condition matches', async () => {
      const seqId = await createSequence()
      const condStepId = await createStep(seqId, 0, {
        type: 'condition',
        condition: { plan: 'pro' },
        subject: null,
      })
      const emailStepId = await createStep(seqId, 1)
      const contactId = await createContact({ properties: { plan: 'pro' } })
      const enrollmentId = await createEnrollment(seqId, contactId, condStepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: condStepId })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('active')
      expect(enrollment.currentStepId).toBe(emailStepId)
    })

    it('exits when condition does not match', async () => {
      const seqId = await createSequence()
      const condStepId = await createStep(seqId, 0, {
        type: 'condition',
        condition: { plan: 'enterprise' },
        subject: null,
      })
      await createStep(seqId, 1)
      const contactId = await createContact({ properties: { plan: 'free' } })
      const enrollmentId = await createEnrollment(seqId, contactId, condStepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: condStepId })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('exited')
    })

    it('continues when condition is null (no condition set)', async () => {
      const seqId = await createSequence()
      const condStepId = await createStep(seqId, 0, {
        type: 'condition',
        condition: null,
        subject: null,
      })
      const emailStepId = await createStep(seqId, 1)
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, condStepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: condStepId })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('active')
      expect(enrollment.currentStepId).toBe(emailStepId)
    })

    it('checks tag condition', async () => {
      const seqId = await createSequence()
      const condStepId = await createStep(seqId, 0, {
        type: 'condition',
        condition: { tags: 'vip' },
        subject: null,
      })
      await createStep(seqId, 1)
      const contactId = await createContact({ tags: ['vip', 'active'] })
      const enrollmentId = await createEnrollment(seqId, contactId, condStepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: condStepId })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('active')
    })

    it('exits on failed tag condition', async () => {
      const seqId = await createSequence()
      const condStepId = await createStep(seqId, 0, {
        type: 'condition',
        condition: { tags: 'enterprise' },
        subject: null,
      })
      await createStep(seqId, 1)
      const contactId = await createContact({ tags: ['free'] })
      const enrollmentId = await createEnrollment(seqId, contactId, condStepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: condStepId })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('exited')
    })
  })

  describe('step advancement', () => {
    it('advances to next step and creates a job', async () => {
      const seqId = await createSequence()
      const step1 = await createStep(seqId, 0, { subject: 'Step 1' })
      const step2 = await createStep(seqId, 1, { subject: 'Step 2' })
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, step1)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: step1 })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.currentStepId).toBe(step2)
      expect(enrollment.status).toBe('active')

      const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'process_sequence_step'))
      const nextJob = allJobs.find((j) => (j.payload as any).stepId === step2)
      expect(nextJob).toBeTruthy()
    })

    it('completes enrollment at the last step', async () => {
      const seqId = await createSequence()
      const stepId = await createStep(seqId, 0, { subject: 'Only Step' })
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, stepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('completed')
      expect(enrollment.completedAt).toBeTruthy()
    })

    it('updates sequence completed stats at last step', async () => {
      const seqId = await createSequence()
      const stepId = await createStep(seqId, 0)
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, stepId)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId })

      const [seq] = await db.select().from(schema.sequences).where(eq(schema.sequences.id, seqId)).limit(1)
      expect(seq.stats.completed).toBeGreaterThanOrEqual(1)
    })
  })

  describe('multi-step sequences', () => {
    it('walks through email → delay → email sequence', async () => {
      const seqId = await createSequence()
      const step1 = await createStep(seqId, 0, { subject: 'Welcome' })
      const step2 = await createStep(seqId, 1, { type: 'delay', delayDuration: '1h', subject: null })
      const step3 = await createStep(seqId, 2, { subject: 'Follow up' })
      const contactId = await createContact()
      const enrollmentId = await createEnrollment(seqId, contactId, step1)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: step1 })
      const [after1] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(after1.currentStepId).toBe(step2)
      expect(after1.status).toBe('active')

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: step2 })
      const [after2] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(after2.currentStepId).toBe(step3)
      expect(after2.status).toBe('active')

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: step3 })
      const [after3] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(after3.status).toBe('completed')
    })

    it('exits mid-sequence on failed condition', async () => {
      const seqId = await createSequence()
      const step1 = await createStep(seqId, 0, { subject: 'Welcome' })
      const step2 = await createStep(seqId, 1, { type: 'condition', condition: { plan: 'pro' }, subject: null })
      const step3 = await createStep(seqId, 2, { subject: 'Pro content' })
      const contactId = await createContact({ properties: { plan: 'free' } })
      const enrollmentId = await createEnrollment(seqId, contactId, step1)

      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: step1 })
      await handleProcessSequenceStep(db, config, { enrollmentId, stepId: step2 })

      const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollmentId)).limit(1)
      expect(enrollment.status).toBe('exited')
    })
  })
})
