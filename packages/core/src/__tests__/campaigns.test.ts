import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle as rawDrizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
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

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
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

async function patch(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

describe('campaigns', () => {
  describe('POST /v1/campaigns', () => {
    it('creates a draft campaign', async () => {
      const { status, data } = await post('/v1/campaigns', {
        name: 'October Newsletter',
        subject: 'October Updates',
        fromEmail: 'news@example.com',
      })
      expect(status).toBe(201)
      expect(data.id).toMatch(/^cmp_/)
      expect(data.name).toBe('October Newsletter')
      expect(data.status).toBe('draft')
      expect(data.stats).toEqual({ total: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 })
    })

    it('creates a campaign with audience filter', async () => {
      const { status, data } = await post('/v1/campaigns', {
        name: 'Developer Campaign',
        subject: 'For developers',
        audienceFilter: { tags: { contains: 'developer' } },
      })
      expect(status).toBe(201)
      expect(data.audienceFilter).toEqual({ tags: { contains: 'developer' } })
    })

    it('rejects empty name', async () => {
      const { status } = await post('/v1/campaigns', { name: '' })
      expect(status).toBe(400)
    })
  })

  describe('GET /v1/campaigns', () => {
    it('lists campaigns', async () => {
      const { status, data } = await get('/v1/campaigns')
      expect(status).toBe(200)
      expect(data.data.length).toBeGreaterThanOrEqual(2)
      expect(data).toHaveProperty('has_more')
      expect(data).toHaveProperty('next_cursor')
    })

    it('filters by status', async () => {
      const { data } = await get('/v1/campaigns?status=draft')
      expect(data.data.every((c: any) => c.status === 'draft')).toBe(true)
    })
  })

  describe('GET /v1/campaigns/:id', () => {
    it('returns a campaign by id', async () => {
      const { data: created } = await post('/v1/campaigns', { name: 'Get Test' })
      const { status, data } = await get(`/v1/campaigns/${created.id}`)
      expect(status).toBe(200)
      expect(data.name).toBe('Get Test')
    })

    it('returns 404 for missing campaign', async () => {
      const { status } = await get('/v1/campaigns/cmp_nonexistent')
      expect(status).toBe(404)
    })
  })

  describe('PATCH /v1/campaigns/:id', () => {
    it('updates a draft campaign', async () => {
      const { data: created } = await post('/v1/campaigns', { name: 'Before Update' })
      const { status, data } = await patch(`/v1/campaigns/${created.id}`, { name: 'After Update' })
      expect(status).toBe(200)
      expect(data.name).toBe('After Update')
    })

    it('rejects updating a non-draft campaign', async () => {
      const { data: created } = await post('/v1/campaigns', {
        name: 'Will Send',
        subject: 'Test',
      })

      await db.insert(schema.contacts).values({
        id: generateId('contact'),
        email: 'send-test@example.com',
      })

      await post(`/v1/campaigns/${created.id}/send`, {})
      const { status } = await patch(`/v1/campaigns/${created.id}`, { name: 'Nope' })
      expect(status).toBe(400)
    })
  })

  describe('POST /v1/campaigns/:id/send', () => {
    it('sends a campaign to eligible contacts', async () => {
      await db.insert(schema.contacts).values({
        id: generateId('contact'),
        email: 'eligible@example.com',
        tags: ['newsletter'],
      })

      const { data: campaign } = await post('/v1/campaigns', {
        name: 'Send Test',
        subject: 'Hello',
        audienceFilter: { tags: { contains: 'newsletter' } },
      })

      const { status, data } = await post(`/v1/campaigns/${campaign.id}/send`, {})
      expect(status).toBe(200)
      expect(data.status).toBe('sending')
      expect(data.stats.total).toBeGreaterThanOrEqual(1)
    })

    it('rejects sending without subject or template', async () => {
      await db.insert(schema.contacts).values({
        id: generateId('contact'),
        email: 'contact-for-no-subject@example.com',
      })

      const { data: campaign } = await post('/v1/campaigns', { name: 'No Subject' })
      const { status } = await post(`/v1/campaigns/${campaign.id}/send`, {})
      expect(status).toBe(400)
    })

    it('rejects sending with no eligible contacts', async () => {
      const { data: campaign } = await post('/v1/campaigns', {
        name: 'Empty Audience',
        subject: 'Hi',
        audienceFilter: { tags: { contains: 'nonexistent-tag-xyz' } },
      })
      const { status } = await post(`/v1/campaigns/${campaign.id}/send`, {})
      expect(status).toBe(400)
    })

    it('supports scheduled sends', async () => {
      const { data: campaign } = await post('/v1/campaigns', {
        name: 'Scheduled',
        subject: 'Later',
      })
      const scheduledAt = new Date(Date.now() + 86400000).toISOString()
      const { status, data } = await post(`/v1/campaigns/${campaign.id}/send`, { scheduledAt })
      expect(status).toBe(200)
      expect(data.status).toBe('scheduled')
    })
  })

  describe('POST /v1/campaigns/:id/cancel', () => {
    it('cancels a scheduled campaign', async () => {
      const { data: campaign } = await post('/v1/campaigns', {
        name: 'To Cancel',
        subject: 'Cancel Me',
      })
      const scheduledAt = new Date(Date.now() + 86400000).toISOString()
      await post(`/v1/campaigns/${campaign.id}/send`, { scheduledAt })

      const { status, data } = await post(`/v1/campaigns/${campaign.id}/cancel`, {})
      expect(status).toBe(200)
      expect(data.status).toBe('cancelled')
    })

    it('rejects cancelling a draft', async () => {
      const { data: campaign } = await post('/v1/campaigns', { name: 'Draft Cancel' })
      const { status } = await post(`/v1/campaigns/${campaign.id}/cancel`, {})
      expect(status).toBe(400)
    })
  })

  describe('POST /v1/campaigns/:id/pause', () => {
    it('pauses a sending campaign', async () => {
      const { data: campaign } = await post('/v1/campaigns', {
        name: 'To Pause',
        subject: 'Pause me',
      })
      await post(`/v1/campaigns/${campaign.id}/send`, {})
      const { status, data } = await post(`/v1/campaigns/${campaign.id}/pause`, {})
      expect(status).toBe(200)
      expect(data.status).toBe('paused')
    })

    it('rejects pausing a draft', async () => {
      const { data: campaign } = await post('/v1/campaigns', { name: 'Pause Draft' })
      const { status } = await post(`/v1/campaigns/${campaign.id}/pause`, {})
      expect(status).toBe(400)
    })
  })

  describe('POST /v1/campaigns/:id/resume', () => {
    it('resumes a paused campaign', async () => {
      const { data: campaign } = await post('/v1/campaigns', {
        name: 'To Resume',
        subject: 'Resume me',
      })
      await post(`/v1/campaigns/${campaign.id}/send`, {})
      await post(`/v1/campaigns/${campaign.id}/pause`, {})
      const { status, data } = await post(`/v1/campaigns/${campaign.id}/resume`, {})
      expect(status).toBe(200)
      expect(data.status).toBe('sending')
    })
  })
})

describe('audience filter', () => {
  it('filters by tag contains', async () => {
    const tag = `unique-tag-${Date.now()}`
    await db.insert(schema.contacts).values({
      id: generateId('contact'),
      email: `af-${Date.now()}@example.com`,
      tags: [tag],
    })

    const { data: campaign } = await post('/v1/campaigns', {
      name: 'Tag Filter',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const { data } = await post(`/v1/campaigns/${campaign.id}/send`, {})
    expect(data.stats.total).toBe(1)
  })

  it('excludes unsubscribed contacts', async () => {
    const tag = `unsub-tag-${Date.now()}`
    await db.insert(schema.contacts).values({
      id: generateId('contact'),
      email: `unsub-${Date.now()}@example.com`,
      tags: [tag],
      unsubscribed: true,
    })

    const { data: campaign } = await post('/v1/campaigns', {
      name: 'Unsub Filter',
      subject: 'Hi',
      audienceFilter: { tags: { contains: tag } },
    })
    const { status } = await post(`/v1/campaigns/${campaign.id}/send`, {})
    expect(status).toBe(400)
  })
})
