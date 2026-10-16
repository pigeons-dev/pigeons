import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { createWorker } from '../workers/queue.js'
import { handleSendEmail } from '../workers/handlers/send-email.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

let db: DB

const config: Config = {
  aws: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
    region: 'us-east-1',
  },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 50,
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
})

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =========================================
// handleSendEmail handler unit tests
// =========================================

describe('handleSendEmail handler', () => {
  it('throws when emailId is missing from payload', async () => {
    await expect(handleSendEmail(db, config, {})).rejects.toThrow('Missing emailId')
  })

  it('throws when email does not exist', async () => {
    await expect(
      handleSendEmail(db, config, { emailId: 'msg_nonexistent' }),
    ).rejects.toThrow('not found')
  })

  it('skips already-sent email without error', async () => {
    const id = generateId('email')
    await db.insert(schema.emails).values({
      id,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Already Sent',
      html: '<p>Hi</p>',
      status: 'sent',
    })

    await handleSendEmail(db, config, { emailId: id })

    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.id, id)).limit(1)
    expect(email.status).toBe('sent')
  })

  it('skips delivered email without error', async () => {
    const id = generateId('email')
    await db.insert(schema.emails).values({
      id,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Already Delivered',
      html: '<p>Hi</p>',
      status: 'delivered',
    })

    await handleSendEmail(db, config, { emailId: id })

    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.id, id)).limit(1)
    expect(email.status).toBe('delivered')
  })

  it('skips failed email without error', async () => {
    const id = generateId('email')
    await db.insert(schema.emails).values({
      id,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Already Failed',
      html: '<p>Hi</p>',
      status: 'failed',
    })

    await handleSendEmail(db, config, { emailId: id })

    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.id, id)).limit(1)
    expect(email.status).toBe('failed')
  })

  it('fails all-unsubscribed email and marks as failed', async () => {
    const contactId = generateId('contact')
    await db.insert(schema.contacts).values({
      id: contactId,
      email: 'unsub-test@example.com',
      unsubscribed: true,
      unsubscribedAt: new Date().toISOString(),
    })

    const id = generateId('email')
    await db.insert(schema.emails).values({
      id,
      from: 'test@example.com',
      to: ['unsub-test@example.com'],
      subject: 'To Unsubscribed',
      html: '<p>Hi</p>',
      status: 'queued',
    })

    await handleSendEmail(db, config, { emailId: id })

    const [email] = await db.select().from(schema.emails).where(eq(schema.emails.id, id)).limit(1)
    expect(email.status).toBe('failed')
  })
})

// =========================================
// Worker poll behavior
// =========================================

describe('worker poll', () => {
  it('marks unknown job type as dead', async () => {
    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'totally_unknown',
      payload: { data: 'test' },
      status: 'pending',
      runAt: new Date(Date.now() - 1000).toISOString(),
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(300)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('dead')
    expect(job.lastError).toContain('Unknown job type')
  })

  it('does not pick up future-dated jobs', async () => {
    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'send_email',
      payload: { emailId: 'msg_test' },
      status: 'pending',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(300)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
  })

  it('does not pick up already completed jobs', async () => {
    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'send_email',
      payload: { emailId: 'msg_test' },
      status: 'completed',
      runAt: new Date(Date.now() - 1000).toISOString(),
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(300)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('completed')
  })

  it('retries failed handler with backoff until max attempts', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Will Fail SES',
      html: '<p>Hi</p>',
      status: 'queued',
    })

    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'send_email',
      payload: { emailId },
      status: 'pending',
      runAt: new Date(Date.now() - 1000).toISOString(),
      maxAttempts: 1,
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(500)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('dead')
    expect(job.lastError).toBeTruthy()
    expect(job.attempts).toBe(1)
  })

  it('increments attempts counter on processing', async () => {
    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'totally_unknown',
      payload: {},
      status: 'pending',
      runAt: new Date(Date.now() - 1000).toISOString(),
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(300)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.attempts).toBe(1)
  })

  it('sets completedAt timestamp on success', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Already Sent',
      html: '<p>Hi</p>',
      status: 'sent',
    })

    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'send_email',
      payload: { emailId },
      status: 'pending',
      runAt: new Date(Date.now() - 1000).toISOString(),
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(300)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('completed')
    expect(job.completedAt).toBeTruthy()
    expect(job.startedAt).toBeTruthy()
  })

  it('stop prevents further polling', async () => {
    const worker = createWorker(db, config)
    worker.start()
    worker.stop()

    const jobId = generateId('job')
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'totally_unknown',
      payload: {},
      status: 'pending',
      runAt: new Date(Date.now() - 1000).toISOString(),
    })

    await wait(300)

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('pending')
  })
})

// =========================================
// Backoff calculation verification
// =========================================

describe('retry backoff', () => {
  it('sets retry runAt in the future after first failure', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Backoff Test',
      html: '<p>Hi</p>',
      status: 'queued',
    })

    const jobId = generateId('job')
    const now = new Date()
    await db.insert(schema.jobs).values({
      id: jobId,
      type: 'send_email',
      payload: { emailId },
      status: 'pending',
      runAt: new Date(now.getTime() - 1000).toISOString(),
      maxAttempts: 3,
    })

    const worker = createWorker(db, config)
    worker.start()
    await wait(500)
    worker.stop()

    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1)
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(1)
    expect(job.lastError).toBeTruthy()
    const retryAt = new Date(job.runAt)
    expect(retryAt.getTime()).toBeGreaterThan(now.getTime())
  })
})
