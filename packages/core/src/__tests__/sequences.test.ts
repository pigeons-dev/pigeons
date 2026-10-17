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

describe('sequences', () => {
  describe('POST /v1/sequences', () => {
    it('creates a sequence', async () => {
      const { status, data } = await post('/v1/sequences', {
        name: 'Welcome Flow',
      })
      expect(status).toBe(201)
      expect(data.id).toMatch(/^seq_/)
      expect(data.name).toBe('Welcome Flow')
      expect(data.status).toBe('draft')
      expect(data.steps).toEqual([])
    })

    it('creates a sequence with steps', async () => {
      const { status, data } = await post('/v1/sequences', {
        name: 'Onboarding',
        steps: [
          { type: 'email', subject: 'Welcome!' },
          { type: 'delay', delayDuration: '2d' },
          { type: 'email', subject: 'Getting started' },
        ],
      })
      expect(status).toBe(201)
      expect(data.steps).toHaveLength(3)
      expect(data.steps[0].type).toBe('email')
      expect(data.steps[0].position).toBe(0)
      expect(data.steps[1].type).toBe('delay')
      expect(data.steps[1].position).toBe(1)
      expect(data.steps[2].position).toBe(2)
    })

    it('creates a sequence with a trigger', async () => {
      const { data } = await post('/v1/sequences', {
        name: 'Trial Signup',
        trigger: { event: 'contact.created', filter: { tags: ['trial'] } },
      })
      expect(data.trigger).toEqual({ event: 'contact.created', filter: { tags: ['trial'] } })
    })

    it('rejects empty name', async () => {
      const { status } = await post('/v1/sequences', { name: '' })
      expect(status).toBe(400)
    })
  })

  describe('GET /v1/sequences', () => {
    it('lists sequences', async () => {
      const { status, data } = await get('/v1/sequences')
      expect(status).toBe(200)
      expect(data.data.length).toBeGreaterThanOrEqual(3)
      expect(data).toHaveProperty('has_more')
    })

    it('filters by status', async () => {
      const { data } = await get('/v1/sequences?status=draft')
      expect(data.data.every((s: any) => s.status === 'draft')).toBe(true)
    })
  })

  describe('GET /v1/sequences/:id', () => {
    it('returns a sequence with steps', async () => {
      const { data: created } = await post('/v1/sequences', {
        name: 'Get Test',
        steps: [{ type: 'email', subject: 'Hi' }],
      })
      const { status, data } = await get(`/v1/sequences/${created.id}`)
      expect(status).toBe(200)
      expect(data.name).toBe('Get Test')
      expect(data.steps).toHaveLength(1)
    })

    it('returns 404 for missing sequence', async () => {
      const { status } = await get('/v1/sequences/seq_nonexistent')
      expect(status).toBe(404)
    })
  })

  describe('PATCH /v1/sequences/:id', () => {
    it('updates a draft sequence name', async () => {
      const { data: created } = await post('/v1/sequences', { name: 'Old Name' })
      const { status, data } = await patch(`/v1/sequences/${created.id}`, { name: 'New Name' })
      expect(status).toBe(200)
      expect(data.name).toBe('New Name')
    })

    it('replaces steps on update', async () => {
      const { data: created } = await post('/v1/sequences', {
        name: 'Replace Steps',
        steps: [{ type: 'email', subject: 'Old' }],
      })
      const { data } = await patch(`/v1/sequences/${created.id}`, {
        steps: [
          { type: 'delay', delayDuration: '1d' },
          { type: 'email', subject: 'New' },
        ],
      })
      expect(data.steps).toHaveLength(2)
      expect(data.steps[0].type).toBe('delay')
      expect(data.steps[1].type).toBe('email')
    })

    it('rejects updating an active sequence', async () => {
      const { data: created } = await post('/v1/sequences', {
        name: 'Active Seq',
        steps: [{ type: 'email', subject: 'Hi' }],
      })
      await post(`/v1/sequences/${created.id}/activate`, {})
      const { status } = await patch(`/v1/sequences/${created.id}`, { name: 'Nope' })
      expect(status).toBe(400)
    })
  })

  describe('POST /v1/sequences/:id/activate', () => {
    it('activates a draft sequence with steps', async () => {
      const { data: created } = await post('/v1/sequences', {
        name: 'Activate Me',
        steps: [{ type: 'email', subject: 'Welcome' }],
      })
      const { status, data } = await post(`/v1/sequences/${created.id}/activate`, {})
      expect(status).toBe(200)
      expect(data.status).toBe('active')
    })

    it('rejects activating without steps', async () => {
      const { data: created } = await post('/v1/sequences', { name: 'No Steps' })
      const { status } = await post(`/v1/sequences/${created.id}/activate`, {})
      expect(status).toBe(400)
    })

    it('rejects activating an already active sequence', async () => {
      const { data: created } = await post('/v1/sequences', {
        name: 'Already Active',
        steps: [{ type: 'email', subject: 'Hi' }],
      })
      await post(`/v1/sequences/${created.id}/activate`, {})
      const { status } = await post(`/v1/sequences/${created.id}/activate`, {})
      expect(status).toBe(400)
    })
  })

  describe('POST /v1/sequences/:id/pause', () => {
    it('pauses an active sequence', async () => {
      const { data: created } = await post('/v1/sequences', {
        name: 'Pause Me',
        steps: [{ type: 'email', subject: 'Hi' }],
      })
      await post(`/v1/sequences/${created.id}/activate`, {})
      const { status, data } = await post(`/v1/sequences/${created.id}/pause`, {})
      expect(status).toBe(200)
      expect(data.status).toBe('paused')
    })

    it('rejects pausing a draft', async () => {
      const { data: created } = await post('/v1/sequences', { name: 'Draft Pause' })
      const { status } = await post(`/v1/sequences/${created.id}/pause`, {})
      expect(status).toBe(400)
    })
  })

  describe('POST /v1/sequences/:id/enroll', () => {
    it('enrolls a contact in an active sequence', async () => {
      const contactId = generateId('contact')
      await db.insert(schema.contacts).values({
        id: contactId,
        email: `enroll-${Date.now()}@example.com`,
      })

      const { data: seq } = await post('/v1/sequences', {
        name: 'Enroll Test',
        steps: [{ type: 'email', subject: 'Step 1' }],
      })
      await post(`/v1/sequences/${seq.id}/activate`, {})

      const { status, data } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId })
      expect(status).toBe(201)
      expect(data.id).toMatch(/^enr_/)
      expect(data.sequenceId).toBe(seq.id)
      expect(data.contactId).toBe(contactId)
      expect(data.status).toBe('active')
    })

    it('rejects enrolling in a draft sequence', async () => {
      const contactId = generateId('contact')
      await db.insert(schema.contacts).values({
        id: contactId,
        email: `draft-enroll-${Date.now()}@example.com`,
      })

      const { data: seq } = await post('/v1/sequences', { name: 'Draft Enroll' })
      const { status } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId })
      expect(status).toBe(400)
    })

    it('rejects enrolling a nonexistent contact', async () => {
      const { data: seq } = await post('/v1/sequences', {
        name: 'No Contact',
        steps: [{ type: 'email', subject: 'Hi' }],
      })
      await post(`/v1/sequences/${seq.id}/activate`, {})
      const { status } = await post(`/v1/sequences/${seq.id}/enroll`, { contactId: 'ctc_nonexistent' })
      expect(status).toBe(404)
    })
  })

  describe('GET /v1/sequences/:id/enrollments', () => {
    it('lists enrollments for a sequence', async () => {
      const contactId = generateId('contact')
      await db.insert(schema.contacts).values({
        id: contactId,
        email: `list-enroll-${Date.now()}@example.com`,
      })

      const { data: seq } = await post('/v1/sequences', {
        name: 'List Enrollments',
        steps: [{ type: 'email', subject: 'Hi' }],
      })
      await post(`/v1/sequences/${seq.id}/activate`, {})
      await post(`/v1/sequences/${seq.id}/enroll`, { contactId })

      const { status, data } = await get(`/v1/sequences/${seq.id}/enrollments`)
      expect(status).toBe(200)
      expect(data.data.length).toBeGreaterThanOrEqual(1)
      expect(data.data[0].contactId).toBe(contactId)
    })

    it('returns 404 for missing sequence', async () => {
      const { status } = await get('/v1/sequences/seq_nonexistent/enrollments')
      expect(status).toBe(404)
    })
  })
})
