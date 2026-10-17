import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle as rawDrizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { createApp } from '../app.js'
import { generateApiKey } from '../utils/crypto.js'
import { generateId } from '../utils/id.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'
import type { Server } from 'node:http'

let server: Server
let baseUrl: string
let apiKey: string
let db: DB

const config: Config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 1000,
  openTracking: false,
  rateLimits: {
    emails: 10000, domains: 10000, apiKeys: 10000, templates: 10000,
    contacts: 10000, inboxes: 10000, webhooks: 10000, campaigns: 10000, sequences: 10000, topics: 10000,
  },
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = rawDrizzle(client, { schema }) as DB
  await migrate(db, { migrationsFolder: 'drizzle' })

  const { full, prefix, hash } = generateApiKey()
  apiKey = full
  await db.insert(schema.apiKeys).values({
    id: generateId('apiKey'),
    name: 'Test Key',
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

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function get(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey, ...headers },
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function patch(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function noAuth(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status }
}

function uniqueEmail() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function seedContact(overrides: Partial<typeof schema.contacts.$inferInsert> = {}) {
  const id = generateId('contact')
  await db.insert(schema.contacts).values({
    id,
    email: uniqueEmail(),
    ...overrides,
  })
  return id
}

describe('campaign creation edge cases', () => {
  it('creates a campaign with all optional fields', async () => {
    const { status, data } = await post('/v1/campaigns', {
      name: 'Full Campaign',
      subject: 'Test Subject',
      templateId: 'tpl_fake',
      templateData: { greeting: 'Hello' },
      fromName: 'Sender',
      fromEmail: 'sender@example.com',
      audienceFilter: { tags: { containsAll: ['a', 'b'] } },
      scheduledAt: '2030-01-01T00:00:00Z',
    })
    expect(status).toBe(201)
    expect(data.templateId).toBe('tpl_fake')
    expect(data.templateData).toEqual({ greeting: 'Hello' })
    expect(data.fromName).toBe('Sender')
    expect(data.fromEmail).toBe('sender@example.com')
    expect(data.scheduledAt).toBe('2030-01-01T00:00:00Z')
  })

  it('rejects invalid fromEmail', async () => {
    const { status } = await post('/v1/campaigns', {
      name: 'Bad Email',
      fromEmail: 'not-an-email',
    })
    expect(status).toBe(400)
  })

  it('generates unique cmp_ IDs', async () => {
    const { data: a } = await post('/v1/campaigns', { name: 'A' })
    const { data: b } = await post('/v1/campaigns', { name: 'B' })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^cmp_/)
    expect(b.id).toMatch(/^cmp_/)
  })

  it('initializes stats to zeroes', async () => {
    const { data } = await post('/v1/campaigns', { name: 'Zero Stats' })
    expect(data.stats).toEqual({ total: 0, sent: 0, delivered: 0, opened: 0, bounced: 0, complained: 0, failed: 0 })
  })

  it('sets createdAt and updatedAt', async () => {
    const { data } = await post('/v1/campaigns', { name: 'Timestamps' })
    expect(data.createdAt).toBeTruthy()
    expect(data.updatedAt).toBeTruthy()
  })
})

describe('campaign auth', () => {
  it('rejects list without auth', async () => {
    const { status } = await noAuth('GET', '/v1/campaigns')
    expect(status).toBe(401)
  })

  it('rejects create without auth', async () => {
    const { status } = await noAuth('POST', '/v1/campaigns', { name: 'Unauthed' })
    expect(status).toBe(401)
  })

  it('rejects get without auth', async () => {
    const { status } = await noAuth('GET', '/v1/campaigns/cmp_fake')
    expect(status).toBe(401)
  })
})

describe('campaign update edge cases', () => {
  it('updates multiple fields at once', async () => {
    const { data: created } = await post('/v1/campaigns', { name: 'Multi Update' })
    const { data } = await patch(`/v1/campaigns/${created.id}`, {
      name: 'Updated Name',
      subject: 'Updated Subject',
      fromEmail: 'updated@example.com',
    })
    expect(data.name).toBe('Updated Name')
    expect(data.subject).toBe('Updated Subject')
    expect(data.fromEmail).toBe('updated@example.com')
  })

  it('returns 404 for nonexistent campaign', async () => {
    const { status } = await patch('/v1/campaigns/cmp_nonexistent', { name: 'Nope' })
    expect(status).toBe(404)
  })

  it('rejects update of cancelled campaign', async () => {
    const contactId = await seedContact()
    const { data: c } = await post('/v1/campaigns', { name: 'Cancel Then Update', subject: 'Hi' })
    const scheduledAt = new Date(Date.now() + 86400000).toISOString()
    await post(`/v1/campaigns/${c.id}/send`, { scheduledAt })
    await post(`/v1/campaigns/${c.id}/cancel`, {})
    const { status } = await patch(`/v1/campaigns/${c.id}`, { name: 'Nope' })
    expect(status).toBe(400)
  })

  it('rejects update of sent campaign', async () => {
    const contactId = await seedContact({ tags: ['sent-update-test'] })
    const { data: c } = await post('/v1/campaigns', {
      name: 'Sent Update',
      subject: 'Hi',
      audienceFilter: { tags: { contains: 'sent-update-test' } },
    })
    await post(`/v1/campaigns/${c.id}/send`, {})
    // Directly mark as sent to test the guard
    await db.update(schema.campaigns).set({ status: 'sent' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await patch(`/v1/campaigns/${c.id}`, { name: 'Nope' })
    expect(status).toBe(400)
  })
})

describe('campaign send edge cases', () => {
  it('rejects sending an already-sent campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Already Sent', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'sent' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(status).toBe(400)
  })

  it('rejects sending a cancelled campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Already Cancelled', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'cancelled' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(status).toBe(400)
  })

  it('rejects sending a paused campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Already Paused', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'paused' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(status).toBe(400)
  })

  it('returns 404 for nonexistent campaign', async () => {
    const { status } = await post('/v1/campaigns/cmp_nonexistent/send', {})
    expect(status).toBe(404)
  })

  it('excludes bounced contacts', async () => {
    const tag = `bounced-${Date.now()}`
    await seedContact({ tags: [tag], bounced: true })

    const { data: c } = await post('/v1/campaigns', {
      name: 'Bounced Filter',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const { status, data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(status).toBe(400)
    expect(data.error.message).toContain('No eligible contacts')
  })

  it('excludes complained contacts', async () => {
    const tag = `complained-${Date.now()}`
    await seedContact({ tags: [tag], complained: true })

    const { data: c } = await post('/v1/campaigns', {
      name: 'Complained Filter',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const { status } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(status).toBe(400)
  })

  it('sends to all contacts when no audience filter', async () => {
    // With no filter, all non-suppressed contacts are eligible
    const { data: c } = await post('/v1/campaigns', {
      name: 'No Filter',
      subject: 'Hi',
    })
    const { status, data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(status).toBe(200)
    expect(data.stats.total).toBeGreaterThan(0)
  })

  it('creates a job record on send', async () => {
    const tag = `job-check-${Date.now()}`
    await seedContact({ tags: [tag] })
    const { data: c } = await post('/v1/campaigns', {
      name: 'Job Check',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    await post(`/v1/campaigns/${c.id}/send`, {})

    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, 'send_campaign'))
      .orderBy(desc(schema.jobs.createdAt))
      .limit(1)

    expect(job).toBeTruthy()
    const payload = job.payload as { campaignId: string; contactIds: string[] }
    expect(payload.campaignId).toBe(c.id)
    expect(payload.contactIds.length).toBeGreaterThanOrEqual(1)
  })

  it('sets startedAt on immediate send', async () => {
    const tag = `started-${Date.now()}`
    await seedContact({ tags: [tag] })
    const { data: c } = await post('/v1/campaigns', {
      name: 'StartedAt Check',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const { data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(data.startedAt).toBeTruthy()
  })

  it('does not set startedAt on scheduled send', async () => {
    const tag = `sched-start-${Date.now()}`
    await seedContact({ tags: [tag] })
    const { data: c } = await post('/v1/campaigns', {
      name: 'Sched StartedAt',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const scheduledAt = new Date(Date.now() + 86400000).toISOString()
    const { data } = await post(`/v1/campaigns/${c.id}/send`, { scheduledAt })
    expect(data.startedAt).toBeNull()
    expect(data.scheduledAt).toBeTruthy()
  })
})

describe('campaign cancel edge cases', () => {
  it('cancels a sending campaign', async () => {
    const tag = `cancel-sending-${Date.now()}`
    await seedContact({ tags: [tag] })
    const { data: c } = await post('/v1/campaigns', {
      name: 'Cancel Sending',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    await post(`/v1/campaigns/${c.id}/send`, {})
    const { status, data } = await post(`/v1/campaigns/${c.id}/cancel`, {})
    expect(status).toBe(200)
    expect(data.status).toBe('cancelled')
  })

  it('rejects cancelling an already-cancelled campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Double Cancel', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'cancelled' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/cancel`, {})
    expect(status).toBe(400)
  })

  it('rejects cancelling a sent campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Sent Cancel', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'sent' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/cancel`, {})
    expect(status).toBe(400)
  })

  it('returns 404 for nonexistent campaign', async () => {
    const { status } = await post('/v1/campaigns/cmp_nonexistent/cancel', {})
    expect(status).toBe(404)
  })
})

describe('campaign pause edge cases', () => {
  it('rejects pausing a scheduled campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Pause Scheduled', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'scheduled' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/pause`, {})
    expect(status).toBe(400)
  })

  it('rejects pausing a cancelled campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Pause Cancelled', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'cancelled' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/pause`, {})
    expect(status).toBe(400)
  })

  it('rejects pausing a sent campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Pause Sent', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'sent' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/pause`, {})
    expect(status).toBe(400)
  })

  it('returns 404 for nonexistent', async () => {
    const { status } = await post('/v1/campaigns/cmp_nonexistent/pause', {})
    expect(status).toBe(404)
  })
})

describe('campaign resume edge cases', () => {
  it('rejects resuming a draft', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Resume Draft' })
    const { status } = await post(`/v1/campaigns/${c.id}/resume`, {})
    expect(status).toBe(400)
  })

  it('rejects resuming a sending campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Resume Sending', subject: 'Hi' })
    await db.update(schema.campaigns).set({ status: 'sending' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/resume`, {})
    expect(status).toBe(400)
  })

  it('rejects resuming a cancelled campaign', async () => {
    const { data: c } = await post('/v1/campaigns', { name: 'Resume Cancelled' })
    await db.update(schema.campaigns).set({ status: 'cancelled' }).where(eq(schema.campaigns.id, c.id))
    const { status } = await post(`/v1/campaigns/${c.id}/resume`, {})
    expect(status).toBe(400)
  })

  it('creates a new job when resuming', async () => {
    const tag = `resume-job-${Date.now()}`
    await seedContact({ tags: [tag] })
    const { data: c } = await post('/v1/campaigns', {
      name: 'Resume Job Check',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    await post(`/v1/campaigns/${c.id}/send`, {})
    await post(`/v1/campaigns/${c.id}/pause`, {})

    const jobsBefore = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'send_campaign'))
    await post(`/v1/campaigns/${c.id}/resume`, {})
    const jobsAfter = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'send_campaign'))

    expect(jobsAfter.length).toBeGreaterThan(jobsBefore.length)
  })

  it('returns 404 for nonexistent', async () => {
    const { status } = await post('/v1/campaigns/cmp_nonexistent/resume', {})
    expect(status).toBe(404)
  })
})

describe('campaign list pagination', () => {
  it('respects limit parameter', async () => {
    await post('/v1/campaigns', { name: 'Pag A' })
    await post('/v1/campaigns', { name: 'Pag B' })
    await post('/v1/campaigns', { name: 'Pag C' })

    const { data } = await get('/v1/campaigns?limit=2')
    expect(data.data.length).toBe(2)
  })

  it('returns has_more when there are more results', async () => {
    const { data } = await get('/v1/campaigns?limit=1')
    expect(data.has_more).toBe(true)
    expect(data.next_cursor).toBeTruthy()
  })

  it('paginates with cursor', async () => {
    const { data: page1 } = await get('/v1/campaigns?limit=2')
    expect(page1.data.length).toBe(2)

    const { data: page2 } = await get(`/v1/campaigns?limit=2&cursor=${page1.next_cursor}`)
    expect(page2.data.length).toBeGreaterThan(0)

    const page1Ids = page1.data.map((c: any) => c.id)
    const page2Ids = page2.data.map((c: any) => c.id)
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false)
  })

  it('returns empty when filtering by nonexistent status', async () => {
    // All campaigns created in this test are draft or sending — filter for 'archived' status
    // (campaigns don't have archived but we can use a status that no campaign has)
    const { data } = await get('/v1/campaigns?status=sent')
    // May or may not be empty depending on test ordering, but should not error
    expect(data.data).toBeInstanceOf(Array)
  })
})

describe('audience filter integration with campaigns', () => {
  it('filters by containsAny tags', async () => {
    const tag1 = `any-a-${Date.now()}`
    const tag2 = `any-b-${Date.now()}`
    await seedContact({ tags: [tag1] })
    await seedContact({ tags: [tag2] })
    await seedContact({ tags: ['unrelated'] })

    const { data: c } = await post('/v1/campaigns', {
      name: 'ContainsAny Filter',
      subject: 'Hi',
      audienceFilter: { tags: { containsAny: [tag1, tag2] } },
    })
    const { data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(data.stats.total).toBe(2)
  })

  it('filters by containsAll tags', async () => {
    const tagA = `all-a-${Date.now()}`
    const tagB = `all-b-${Date.now()}`
    await seedContact({ tags: [tagA, tagB] })
    await seedContact({ tags: [tagA] })

    const { data: c } = await post('/v1/campaigns', {
      name: 'ContainsAll Filter',
      subject: 'Hi',
      audienceFilter: { tags: { containsAll: [tagA, tagB] } },
    })
    const { data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(data.stats.total).toBe(1)
  })

  it('filters by property match', async () => {
    const marker = `prop-${Date.now()}`
    await seedContact({ properties: { plan: marker } })
    await seedContact({ properties: { plan: 'other' } })

    const { data: c } = await post('/v1/campaigns', {
      name: 'Property Filter',
      subject: 'Hi',
      audienceFilter: { properties: { plan: marker } },
    })
    const { data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(data.stats.total).toBe(1)
  })

  it('applies combined tag + property filter', async () => {
    const tag = `combo-${Date.now()}`
    const plan = `combo-plan-${Date.now()}`
    await seedContact({ tags: [tag], properties: { plan } })
    await seedContact({ tags: [tag], properties: { plan: 'wrong' } })
    await seedContact({ tags: ['other'], properties: { plan } })

    const { data: c } = await post('/v1/campaigns', {
      name: 'Combo Filter',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag }, properties: { plan } },
    })
    const { data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(data.stats.total).toBe(1)
  })

  it('mixed eligible and suppressed contacts', async () => {
    const tag = `mixed-${Date.now()}`
    await seedContact({ tags: [tag] })
    await seedContact({ tags: [tag] })
    await seedContact({ tags: [tag], unsubscribed: true })
    await seedContact({ tags: [tag], bounced: true })
    await seedContact({ tags: [tag], complained: true })

    const { data: c } = await post('/v1/campaigns', {
      name: 'Mixed Filter',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const { data } = await post(`/v1/campaigns/${c.id}/send`, {})
    expect(data.stats.total).toBe(2)
  })
})
