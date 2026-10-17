import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { like } from 'drizzle-orm'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as schema from '../db/schema.js'
import { createApp } from '../app.js'
import { generateApiKey } from '../utils/crypto.js'
import { generateId } from '../utils/id.js'
import type { Config } from '../config.js'
import type { Server } from 'node:http'

vi.mock('sns-validator', () => {
  return {
    default: class {
      validate(_msg: unknown, cb: (err: Error | null) => void) {
        cb(null)
      }
    },
  }
})

let server: Server
let baseUrl: string
let apiKey: string
let db: ReturnType<typeof drizzle<typeof schema>>

const config: Config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 1000,
  openTracking: false,
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
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
      baseUrl = `http://127.0.0.1:${(addr as any).port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

describe('domain stats', () => {
  let domainId: string

  it('sets up a domain and seed emails', async () => {
    await db.insert(schema.domains).values({
      id: generateId('domain'),
      domain: 'example.com',
      region: 'us-east-1',
      verificationStatus: 'verified',
    })

    const [dom] = await db.select().from(schema.domains).limit(1)
    domainId = dom!.id

    const statuses = ['sent', 'delivered', 'delivered', 'delivered', 'bounced', 'complained', 'failed'] as const
    for (const status of statuses) {
      await db.insert(schema.emails).values({
        id: generateId('email'),
        from: 'test@example.com',
        to: ['user@recipient.com'],
        subject: `Stats test ${status}`,
        html: '<p>test</p>',
        status,
      })
    }

    await db.insert(schema.emails).values({
      id: generateId('email'),
      from: 'test@example.com',
      to: ['user@recipient.com'],
      subject: 'Opened email',
      html: '<p>test</p>',
      status: 'delivered',
      trackOpens: true,
      openCount: 3,
      firstOpenedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    })
  })

  it('GET /v1/domains/:id/stats returns stats with rates', async () => {
    const { status, data } = await get(`/v1/domains/${domainId}/stats`)
    expect(status).toBe(200)
    expect(data.domain).toBe('example.com')
    expect(data.domainId).toBe(domainId)

    const s = data.last30d
    expect(s.sent).toBe(7)
    expect(s.delivered).toBe(4)
    expect(s.bounced).toBe(1)
    expect(s.complained).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.opened).toBe(1)
    expect(s.deliveryRate).toBeCloseTo(4 / 7, 3)
    expect(s.bounceRate).toBeCloseTo(1 / 7, 3)
    expect(s.complaintRate).toBeCloseTo(1 / 4, 3)
    expect(s.openRate).toBeCloseTo(1 / 4, 3)
  })

  it('returns warmup guidance', async () => {
    const { data } = await get(`/v1/domains/${domainId}/stats`)
    expect(data.warmup).toBeTruthy()
    expect(['new', 'warming', 'established']).toContain(data.warmup.phase)
    expect(data.warmup.dailyLimit).toBeGreaterThan(0)
    expect(data.warmup.recommendation).toBeTruthy()
  })

  it('returns 404 for unknown domain', async () => {
    const { status } = await get('/v1/domains/dom_nonexistent/stats')
    expect(status).toBe(404)
  })

  it('returns zero stats for domain with no emails', async () => {
    await db.insert(schema.domains).values({
      id: generateId('domain'),
      domain: 'empty.com',
      region: 'us-east-1',
      verificationStatus: 'verified',
    })
    const [dom] = await db
      .select()
      .from(schema.domains)
      .where(like(schema.domains.domain, 'empty%'))
      .limit(1)

    const { status, data } = await get(`/v1/domains/${dom!.id}/stats`)
    expect(status).toBe(200)
    expect(data.last30d.sent).toBe(0)
    expect(data.last30d.deliveryRate).toBe(0)
    expect(data.last30d.bounceRate).toBe(0)
  })
})

describe('global stats', () => {
  it('GET /v1/stats returns aggregated stats', async () => {
    const { status, data } = await get('/v1/stats')
    expect(status).toBe(200)
    expect(data.last24h).toBeTruthy()
    expect(data.last7d).toBeTruthy()
    expect(data.last30d).toBeTruthy()
    expect(data.last30d.sent).toBeGreaterThan(0)
  })

  it('includes top domains list', async () => {
    const { data } = await get('/v1/stats')
    expect(Array.isArray(data.topDomains)).toBe(true)
    expect(data.topDomains.length).toBeGreaterThan(0)
    expect(data.topDomains[0].domain).toBeTruthy()
    expect(data.topDomains[0].sent).toBeGreaterThanOrEqual(0)
    expect(data.topDomains[0].deliveryRate).toBeGreaterThanOrEqual(0)
  })

  it('top domains are sorted by send volume', async () => {
    const { data } = await get('/v1/stats')
    for (let i = 1; i < data.topDomains.length; i++) {
      expect(data.topDomains[i - 1].sent).toBeGreaterThanOrEqual(data.topDomains[i].sent)
    }
  })
})

describe('warmup guidance phases', () => {
  it('new domain gets "new" phase', async () => {
    const id = generateId('domain')
    await db.insert(schema.domains).values({
      id,
      domain: 'brand-new.com',
      region: 'us-east-1',
      verificationStatus: 'verified',
      createdAt: new Date().toISOString(),
    })

    const { data } = await get(`/v1/domains/${id}/stats`)
    expect(data.warmup.phase).toBe('new')
    expect(data.warmup.dailyLimit).toBe(200)
  })

  it('older domain with low volume gets "warming" phase', async () => {
    const id = generateId('domain')
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString()
    await db.insert(schema.domains).values({
      id,
      domain: 'warming-up.com',
      region: 'us-east-1',
      verificationStatus: 'verified',
      createdAt: twoWeeksAgo,
    })

    for (let i = 0; i < 5; i++) {
      await db.insert(schema.emails).values({
        id: generateId('email'),
        from: `test@warming-up.com`,
        to: ['user@recipient.com'],
        subject: 'Warming',
        html: '<p>test</p>',
        status: 'delivered',
      })
    }

    const { data } = await get(`/v1/domains/${id}/stats`)
    expect(data.warmup.phase).toBe('warming')
  })

  it('established domain with high volume gets "established" phase', async () => {
    const id = generateId('domain')
    const twoMonthsAgo = new Date(Date.now() - 60 * 86_400_000).toISOString()
    await db.insert(schema.domains).values({
      id,
      domain: 'big-sender.com',
      region: 'us-east-1',
      verificationStatus: 'verified',
      createdAt: twoMonthsAgo,
    })

    const batch = Array.from({ length: 400 }, () => ({
      id: generateId('email'),
      from: 'test@big-sender.com',
      to: ['user@recipient.com'],
      subject: 'Volume',
      html: '<p>test</p>',
      status: 'delivered' as const,
    }))
    for (let i = 0; i < batch.length; i += 100) {
      await db.insert(schema.emails).values(batch.slice(i, i + 100))
    }

    const { data } = await get(`/v1/domains/${id}/stats`)
    expect(data.warmup.phase).toBe('established')
  })
})
