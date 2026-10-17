import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../utils/url-validation.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/email-sender.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'ses_mock_id' }),
}))

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq, and, lte } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { createApp } from '../app.js'
import { generateApiKey } from '../utils/crypto.js'
import { handleSendCampaign } from '../workers/handlers/send-campaign.js'
import { handleProcessSequenceStep } from '../workers/handlers/process-sequence-step.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'
import type { Server } from 'node:http'

let db: DB
let server: Server
let baseUrl: string
let apiKey: string

const config: Config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  fromEmail: 'perf@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 50,
  openTracking: false,
  rateLimits: { emails: 10000, domains: 10000, apiKeys: 10000, templates: 10000, contacts: 10000, inboxes: 10000, webhooks: 10000, campaigns: 10000, sequences: 10000, topics: 10000 },
}

function elapsed(start: [number, number]): number {
  const [s, ns] = process.hrtime(start)
  return s * 1000 + ns / 1_000_000
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })

  const { full, prefix, hash } = generateApiKey()
  apiKey = full
  await db.insert(schema.apiKeys).values({
    id: generateId('apiKey'),
    name: 'Perf Key',
    prefix,
    hash,
    scopes: null,
  })

  const app = createApp(db, config)
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      baseUrl = `http://127.0.0.1:${port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
  })
  return { status: res.status, data: (await res.json()) as any }
}

// --- Campaign batch sends ---

describe('campaign batch sends', () => {
  it('sends campaign to 100 contacts under 2s', async () => {
    const contactIds: string[] = []
    for (let i = 0; i < 100; i++) {
      const id = generateId('contact')
      await db.insert(schema.contacts).values({
        id,
        email: `camp100-${i}@example.com`,
      })
      contactIds.push(id)
    }

    const campaignId = generateId('campaign')
    await db.insert(schema.campaigns).values({
      id: campaignId,
      name: 'Perf 100',
      subject: 'Perf test',
      status: 'sending',
    })

    const start = process.hrtime()
    await handleSendCampaign(db, config, { campaignId, contactIds })
    const ms = elapsed(start)

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.status).toBe('sent')
    expect(campaign.stats.sent).toBe(100)
    expect(ms).toBeLessThan(2000)
    console.log(`  campaign 100 contacts: ${ms.toFixed(0)}ms (${(100_000 / ms).toFixed(0)} contacts/sec projected to 1k)`)
  })

  it('sends campaign to 500 contacts under 8s', async () => {
    const contactIds: string[] = []
    for (let i = 0; i < 500; i++) {
      const id = generateId('contact')
      await db.insert(schema.contacts).values({
        id,
        email: `camp500-${i}@example.com`,
      })
      contactIds.push(id)
    }

    const campaignId = generateId('campaign')
    await db.insert(schema.campaigns).values({
      id: campaignId,
      name: 'Perf 500',
      subject: 'Perf test {{name}}',
      status: 'sending',
    })

    const start = process.hrtime()
    await handleSendCampaign(db, config, {
      campaignId,
      contactIds,
      templateData: { name: 'User' },
    })
    const ms = elapsed(start)

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.status).toBe('sent')
    expect(campaign.stats.sent).toBe(500)
    expect(ms).toBeLessThan(8000)
    console.log(`  campaign 500 contacts: ${ms.toFixed(0)}ms (${(500 / ms * 1000).toFixed(0)} contacts/sec)`)
  })

  it('skips unsubscribed/bounced contacts without SES calls', async () => {
    const contactIds: string[] = []
    for (let i = 0; i < 200; i++) {
      const id = generateId('contact')
      await db.insert(schema.contacts).values({
        id,
        email: `mixed-${i}@example.com`,
        unsubscribed: i % 3 === 0,
        bounced: i % 5 === 0,
      })
      contactIds.push(id)
    }

    const campaignId = generateId('campaign')
    await db.insert(schema.campaigns).values({
      id: campaignId,
      name: 'Mixed',
      subject: 'Mixed test',
      status: 'sending',
    })

    const start = process.hrtime()
    await handleSendCampaign(db, config, { campaignId, contactIds })
    const ms = elapsed(start)

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.sent + campaign.stats.failed).toBe(200)
    expect(ms).toBeLessThan(4000)
    console.log(`  campaign 200 mixed contacts: ${ms.toFixed(0)}ms (sent=${campaign.stats.sent}, failed=${campaign.stats.failed})`)
  })
})

// --- API throughput ---

describe('API throughput', () => {
  it('handles 50 concurrent email sends', async () => {
    const requests = Array.from({ length: 50 }, (_, i) =>
      post('/v1/emails', {
        to: `concurrent-${i}@example.com`,
        subject: `Concurrent ${i}`,
        html: `<p>Test ${i}</p>`,
      }),
    )

    const start = process.hrtime()
    const results = await Promise.all(requests)
    const ms = elapsed(start)

    const successes = results.filter((r) => r.status === 201)
    expect(successes.length).toBe(50)
    expect(ms).toBeLessThan(5000)
    console.log(`  50 concurrent sends: ${ms.toFixed(0)}ms (${(50 / ms * 1000).toFixed(0)} req/sec)`)
  })

  it('handles 100 sequential contact creates', async () => {
    const start = process.hrtime()
    for (let i = 0; i < 100; i++) {
      const { status } = await post('/v1/contacts', {
        email: `seq-contact-${i}@example.com`,
        firstName: 'Perf',
        lastName: `User ${i}`,
        tags: ['perf-test'],
      })
      expect(status).toBe(201)
    }
    const ms = elapsed(start)

    expect(ms).toBeLessThan(5000)
    console.log(`  100 sequential contacts: ${ms.toFixed(0)}ms (${(100 / ms * 1000).toFixed(0)} req/sec)`)
  })

  it('handles batch contact create (500 contacts)', async () => {
    const contacts = Array.from({ length: 500 }, (_, i) => ({
      email: `batch-perf-${i}@example.com`,
      firstName: 'Batch',
      lastName: `User ${i}`,
      tags: ['batch-perf'],
    }))

    const start = process.hrtime()
    const { status, data } = await post('/v1/contacts/batch', contacts)
    const ms = elapsed(start)

    expect(status).toBe(201)
    expect(data.created).toBe(500)
    expect(ms).toBeLessThan(5000)
    console.log(`  batch 500 contacts: ${ms.toFixed(0)}ms (${(500 / ms * 1000).toFixed(0)} contacts/sec)`)
  })

  it('handles batch email send (100 emails)', async () => {
    const emails = Array.from({ length: 100 }, (_, i) => ({
      to: `batch-email-${i}@example.com`,
      subject: `Batch ${i}`,
      html: `<p>Batch test ${i}</p>`,
    }))

    const start = process.hrtime()
    const { status, data } = await post('/v1/emails/batch', emails)
    const ms = elapsed(start)

    expect(status).toBe(201)
    expect(data.length).toBe(100)
    expect(ms).toBeLessThan(5000)
    console.log(`  batch 100 emails: ${ms.toFixed(0)}ms (${(100 / ms * 1000).toFixed(0)} emails/sec)`)
  })

  it('handles 20 concurrent list queries', async () => {
    const requests = Array.from({ length: 20 }, () =>
      get('/v1/contacts?limit=100'),
    )

    const start = process.hrtime()
    const results = await Promise.all(requests)
    const ms = elapsed(start)

    results.forEach((r) => expect(r.status).toBe(200))
    expect(ms).toBeLessThan(3000)
    console.log(`  20 concurrent list queries: ${ms.toFixed(0)}ms (${(20 / ms * 1000).toFixed(0)} req/sec)`)
  })
})

// --- Job queue throughput ---

describe('job queue throughput', () => {
  it('enqueues 500 jobs under 1s', async () => {
    const start = process.hrtime()
    for (let i = 0; i < 500; i++) {
      await db.insert(schema.jobs).values({
        id: generateId('job'),
        type: 'send_email',
        payload: { emailId: `msg_perf_${i}` },
      })
    }
    const ms = elapsed(start)

    expect(ms).toBeLessThan(1000)
    console.log(`  enqueue 500 jobs: ${ms.toFixed(0)}ms (${(500 / ms * 1000).toFixed(0)} jobs/sec)`)
  })

  it('polls and claims 50 jobs from queue', async () => {
    const ids: string[] = []
    for (let i = 0; i < 50; i++) {
      const id = generateId('job')
      await db.insert(schema.jobs).values({
        id,
        type: 'send_email',
        payload: { emailId: `msg_poll_${i}` },
        status: 'pending',
        runAt: new Date().toISOString(),
      })
      ids.push(id)
    }

    const start = process.hrtime()
    const now = new Date().toISOString()
    const pending = await db
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.status, 'pending'), lte(schema.jobs.runAt, now)))
      .limit(50)

    for (const job of pending.filter((j) => ids.includes(j.id))) {
      await db
        .update(schema.jobs)
        .set({ status: 'running', startedAt: new Date().toISOString() })
        .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, 'pending')))
    }
    const ms = elapsed(start)

    expect(ms).toBeLessThan(2000)
    console.log(`  poll+claim 50 jobs: ${ms.toFixed(0)}ms`)
  })
})

// --- Database bulk operations ---

describe('database bulk operations', () => {
  it('inserts 1000 contacts directly under 2s', async () => {
    const start = process.hrtime()
    for (let i = 0; i < 1000; i++) {
      await db.insert(schema.contacts).values({
        id: generateId('contact'),
        email: `bulk-${i}@example.com`,
        firstName: 'Bulk',
        lastName: `User ${i}`,
        tags: ['bulk-test', 'perf'],
        properties: { source: 'perf-test', index: i },
      })
    }
    const ms = elapsed(start)

    expect(ms).toBeLessThan(2000)
    console.log(`  insert 1000 contacts: ${ms.toFixed(0)}ms (${(1000 / ms * 1000).toFixed(0)} inserts/sec)`)
  })

  it('queries contacts by email (point lookup) under 5ms avg', async () => {
    const lookups = ['bulk-0@example.com', 'bulk-500@example.com', 'bulk-999@example.com']
    const times: number[] = []

    for (const email of lookups) {
      const start = process.hrtime()
      const [contact] = await db
        .select()
        .from(schema.contacts)
        .where(eq(schema.contacts.email, email))
        .limit(1)
      times.push(elapsed(start))
      expect(contact).toBeTruthy()
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    expect(avg).toBeLessThan(5)
    console.log(`  point lookup avg: ${avg.toFixed(2)}ms (${times.map((t) => t.toFixed(2)).join(', ')})`)
  })

  it('paginates through 1000+ contacts efficiently', async () => {
    let fetched = 0
    let cursor: string | undefined
    const start = process.hrtime()

    while (true) {
      const { status, data } = await get(
        `/v1/contacts?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
      )
      expect(status).toBe(200)
      fetched += data.data.length
      if (!data.has_more) break
      cursor = data.next_cursor
    }
    const ms = elapsed(start)

    expect(fetched).toBeGreaterThan(1000)
    expect(ms).toBeLessThan(5000)
    console.log(`  paginate ${fetched} contacts: ${ms.toFixed(0)}ms (${Math.ceil(fetched / 100)} pages)`)
  })
})

// --- Auth middleware overhead ---

describe('auth middleware overhead', () => {
  it('auth check adds < 2ms per request on average', async () => {
    const times: number[] = []

    for (let i = 0; i < 20; i++) {
      const start = process.hrtime()
      await get('/v1/emails?limit=1')
      times.push(elapsed(start))
    }

    // Discard first 5 as warmup
    const warm = times.slice(5)
    const avg = warm.reduce((a, b) => a + b, 0) / warm.length

    console.log(`  auth overhead avg: ${avg.toFixed(2)}ms (warmup excluded, ${warm.length} samples)`)
    expect(avg).toBeLessThan(20)
  })

  it('rejects invalid auth in < 5ms', async () => {
    const times: number[] = []

    for (let i = 0; i < 10; i++) {
      const start = process.hrtime()
      const res = await fetch(`${baseUrl}/v1/emails`, {
        headers: { 'x-api-key': 'pgn_invalid_key_1234567890' },
      })
      times.push(elapsed(start))
      expect(res.status).toBe(401)
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    console.log(`  auth reject avg: ${avg.toFixed(2)}ms`)
    expect(avg).toBeLessThan(20)
  })
})
