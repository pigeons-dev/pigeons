import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle as rawDrizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
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

async function noAuth(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status }
}

function uniqueEmail() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

async function seedContact(overrides: Partial<typeof schema.contacts.$inferInsert> = {}) {
  const id = generateId('contact')
  await db.insert(schema.contacts).values({ id, email: uniqueEmail(), ...overrides })
  return id
}

describe('sequence auth', () => {
  it('rejects list without auth', async () => {
    const { status } = await noAuth('GET', '/v1/sequences')
    expect(status).toBe(401)
  })

  it('rejects create without auth', async () => {
    const { status } = await noAuth('POST', '/v1/sequences', { name: 'Unauthed' })
    expect(status).toBe(401)
  })

  it('rejects get without auth', async () => {
    const { status } = await noAuth('GET', '/v1/sequences/seq_fake')
    expect(status).toBe(401)
  })
})

describe('sequence creation edge cases', () => {
  it('creates a sequence with all step types', async () => {
    const { status, data } = await post('/v1/sequences', {
      name: 'All Types',
      steps: [
        { type: 'email', subject: 'Welcome', templateId: 'tpl_fake', templateData: { name: 'User' } },
        { type: 'delay', delayDuration: '3d' },
        { type: 'condition', condition: { tags: 'vip' } },
        { type: 'email', subject: 'Follow up' },
      ],
    })
    expect(status).toBe(201)
    expect(data.steps).toHaveLength(4)
    expect(data.steps[0].templateId).toBe('tpl_fake')
    expect(data.steps[0].templateData).toEqual({ name: 'User' })
    expect(data.steps[1].delayDuration).toBe('3d')
    expect(data.steps[2].condition).toEqual({ tags: 'vip' })
    expect(data.steps[3].position).toBe(3)
  })

  it('initializes stats to zeroes', async () => {
    const { data } = await post('/v1/sequences', { name: 'Zero Stats' })
    expect(data.stats).toEqual({ enrolled: 0, completed: 0, exited: 0, active: 0 })
  })

  it('initializes step stats to zeroes', async () => {
    const { data } = await post('/v1/sequences', {
      name: 'Step Stats',
      steps: [{ type: 'email', subject: 'Test' }],
    })
    expect(data.steps[0].stats).toEqual({ sent: 0, delivered: 0, bounced: 0, complained: 0 })
  })

  it('generates unique seq_ IDs', async () => {
    const { data: a } = await post('/v1/sequences', { name: 'A' })
    const { data: b } = await post('/v1/sequences', { name: 'B' })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^seq_/)
  })

  it('generates stp_ IDs for steps', async () => {
    const { data } = await post('/v1/sequences', {
      name: 'Step IDs',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    expect(data.steps[0].id).toMatch(/^stp_/)
  })

  it('rejects invalid step type', async () => {
    const { status } = await post('/v1/sequences', {
      name: 'Bad Step',
      steps: [{ type: 'invalid' }],
    })
    expect(status).toBe(400)
  })
})

describe('sequence update edge cases', () => {
  it('updates a paused sequence', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Pause Update',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/pause`, {})
    const { status, data } = await patch(`/v1/sequences/${seq.id}`, { name: 'Paused Updated' })
    expect(status).toBe(200)
    expect(data.name).toBe('Paused Updated')
  })

  it('returns 404 for nonexistent sequence', async () => {
    const { status } = await patch('/v1/sequences/seq_nonexistent', { name: 'Nope' })
    expect(status).toBe(404)
  })

  it('updates trigger without touching steps', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Trigger Update',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    const { status, data } = await patch(`/v1/sequences/${seq.id}`, {
      trigger: { event: 'contact.created' },
    })
    expect(status).toBe(200)
    expect(data.trigger).toEqual({ event: 'contact.created' })
    expect(data.steps).toHaveLength(1)
  })

  it('replaces all steps and re-indexes positions', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Re-index Steps',
      steps: [
        { type: 'email', subject: 'A' },
        { type: 'email', subject: 'B' },
        { type: 'email', subject: 'C' },
      ],
    })
    const { data } = await patch(`/v1/sequences/${seq.id}`, {
      steps: [{ type: 'delay', delayDuration: '1h' }],
    })
    expect(data.steps).toHaveLength(1)
    expect(data.steps[0].type).toBe('delay')
    expect(data.steps[0].position).toBe(0)
  })

  it('empty steps array clears all steps', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Clear Steps',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    const { data } = await patch(`/v1/sequences/${seq.id}`, { steps: [] })
    expect(data.steps).toHaveLength(0)
  })
})

describe('sequence activate edge cases', () => {
  it('re-activates a paused sequence', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Reactivate',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/pause`, {})
    const { status, data } = await post(`/v1/sequences/${seq.id}/activate`, {})
    expect(status).toBe(200)
    expect(data.status).toBe('active')
  })

  it('returns steps in the activate response', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Activate Steps',
      steps: [
        { type: 'email', subject: 'Step 1' },
        { type: 'delay', delayDuration: '1d' },
      ],
    })
    const { data } = await post(`/v1/sequences/${seq.id}/activate`, {})
    expect(data.steps).toHaveLength(2)
  })

  it('returns 404 for nonexistent sequence', async () => {
    const { status } = await post('/v1/sequences/seq_nonexistent/activate', {})
    expect(status).toBe(404)
  })

  it('rejects activating with cleared steps', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'No Steps Activate',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await patch(`/v1/sequences/${seq.id}`, { steps: [] })
    const { status } = await post(`/v1/sequences/${seq.id}/activate`, {})
    expect(status).toBe(400)
  })
})

describe('sequence pause edge cases', () => {
  it('rejects pausing an already paused sequence', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'Double Pause',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/pause`, {})
    const { status } = await post(`/v1/sequences/${seq.id}/pause`, {})
    expect(status).toBe(400)
  })

  it('returns 404 for nonexistent sequence', async () => {
    const { status } = await post('/v1/sequences/seq_nonexistent/pause', {})
    expect(status).toBe(404)
  })
})

describe('sequence enroll edge cases', () => {
  it('creates a job for the first step on enroll', async () => {
    const contactId = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Enroll Job',
      steps: [{ type: 'email', subject: 'Step 1' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId })

    const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.type, 'process_sequence_step'))
    const enrollJob = allJobs.find((j) => {
      const p = j.payload as { enrollmentId: string }
      return p.enrollmentId !== undefined
    })
    expect(enrollJob).toBeTruthy()
  })

  it('updates sequence stats on enroll', async () => {
    const contactId = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Enroll Stats',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId })

    const { data: updated } = await get(`/v1/sequences/${seq.id}`)
    expect(updated.stats.enrolled).toBeGreaterThanOrEqual(1)
    expect(updated.stats.active).toBeGreaterThanOrEqual(1)
  })

  it('sets currentStepId to the first step', async () => {
    const contactId = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'First Step',
      steps: [{ type: 'email', subject: 'Hi' }, { type: 'delay', delayDuration: '1d' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    const { data: enrollment } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId })
    expect(enrollment.currentStepId).toMatch(/^stp_/)
  })

  it('rejects enrolling without contactId', async () => {
    const { data: seq } = await post('/v1/sequences', {
      name: 'No ContactId',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    const { status } = await post(`/v1/sequences/${seq.id}/enroll`, {})
    expect(status).toBe(400)
  })

  it('rejects enrolling in nonexistent sequence', async () => {
    const { status } = await post('/v1/sequences/seq_nonexistent/enroll', { contactId: 'ctc_fake' })
    expect(status).toBe(404)
  })

  it('rejects enrolling in a paused sequence', async () => {
    const contactId = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Paused Enroll',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/pause`, {})
    const { status } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId })
    expect(status).toBe(400)
  })

  it('allows enrolling multiple contacts', async () => {
    const c1 = await seedContact()
    const c2 = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Multi Enroll',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})

    const { status: s1, data: e1 } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId: c1 })
    const { status: s2, data: e2 } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId: c2 })

    expect(s1).toBe(201)
    expect(s2).toBe(201)
    expect(e1.id).not.toBe(e2.id)
    expect(e1.id).toMatch(/^enr_/)
  })
})

describe('sequence enrollments listing', () => {
  it('filters enrollments by status', async () => {
    const contactId = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Enrollment Status Filter',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId })

    const { data } = await get(`/v1/sequences/${seq.id}/enrollments?status=active`)
    expect(data.data.every((e: any) => e.status === 'active')).toBe(true)
  })

  it('respects limit parameter', async () => {
    const c1 = await seedContact()
    const c2 = await seedContact()
    const c3 = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Enrollment Limit',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId: c1 })
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId: c2 })
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId: c3 })

    const { data } = await get(`/v1/sequences/${seq.id}/enrollments?limit=2`)
    expect(data.data.length).toBe(2)
    expect(data.has_more).toBe(true)
  })

  it('returns empty for completed filter when all active', async () => {
    const contactId = await seedContact()
    const { data: seq } = await post('/v1/sequences', {
      name: 'Enrollment Empty Filter',
      steps: [{ type: 'email', subject: 'Hi' }],
    })
    await post(`/v1/sequences/${seq.id}/activate`, {})
    await post(`/v1/sequences/${seq.id}/enroll`, { contactId })

    const { data } = await get(`/v1/sequences/${seq.id}/enrollments?status=completed`)
    expect(data.data).toHaveLength(0)
  })
})

describe('sequence list pagination', () => {
  it('respects limit', async () => {
    await post('/v1/sequences', { name: 'Pag A' })
    await post('/v1/sequences', { name: 'Pag B' })
    await post('/v1/sequences', { name: 'Pag C' })

    const { data } = await get('/v1/sequences?limit=2')
    expect(data.data.length).toBe(2)
  })

  it('paginates with cursor', async () => {
    const { data: page1 } = await get('/v1/sequences?limit=2')
    expect(page1.next_cursor).toBeTruthy()

    const { data: page2 } = await get(`/v1/sequences?limit=2&cursor=${page1.next_cursor}`)
    const ids1 = page1.data.map((s: any) => s.id)
    const ids2 = page2.data.map((s: any) => s.id)
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false)
  })
})
