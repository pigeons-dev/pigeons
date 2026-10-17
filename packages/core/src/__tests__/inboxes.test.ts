import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../utils/url-validation.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}))
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as schema from '../db/schema.js'
import { createApp } from '../app.js'
import { generateApiKey } from '../utils/crypto.js'
import { generateId } from '../utils/id.js'
import type { Config } from '../config.js'
import type { Server } from 'node:http'

let server: Server
let baseUrl: string
let apiKey: string

const config: Config = {
  aws: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
    region: 'us-east-1',
  },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 1000,
  openTracking: false,
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })
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

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
  })
  return { status: res.status, data: (await res.json()) as any }
}

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

async function patch(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function del(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  })
  return { status: res.status, data: (await res.json()) as any }
}

describe('POST /v1/inboxes', () => {
  it('creates an inbox', async () => {
    const { status, data } = await post('/v1/inboxes', {
      name: 'support-agent',
      emailAddress: 'support@mail.example.com',
      description: 'Handles support inquiries',
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^inb_/)
    expect(data.name).toBe('support-agent')
    expect(data.emailAddress).toBe('support@mail.example.com')
    expect(data.status).toBe('active')
  })

  it('rejects duplicate email addresses', async () => {
    const { status, data } = await post('/v1/inboxes', {
      name: 'duplicate',
      emailAddress: 'support@mail.example.com',
    })
    expect(status).toBe(409)
  })

  it('validates required fields', async () => {
    const { status } = await post('/v1/inboxes', { name: 'test' })
    expect(status).toBe(400)
  })
})

describe('GET /v1/inboxes', () => {
  it('lists inboxes', async () => {
    const { status, data } = await get('/v1/inboxes')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThan(0)
    expect(data.data[0].id).toMatch(/^inb_/)
  })

  it('filters by status', async () => {
    const { status, data } = await get('/v1/inboxes?status=active')
    expect(status).toBe(200)
    data.data.forEach((inbox: any) => expect(inbox.status).toBe('active'))
  })
})

describe('GET /v1/inboxes/:id', () => {
  it('gets inbox details', async () => {
    const list = await get('/v1/inboxes')
    const id = list.data.data[0].id

    const { status, data } = await get(`/v1/inboxes/${id}`)
    expect(status).toBe(200)
    expect(data.name).toBe('support-agent')
  })

  it('returns 404 for unknown inbox', async () => {
    const { status } = await get('/v1/inboxes/inb_nonexistent')
    expect(status).toBe(404)
  })
})

describe('PATCH /v1/inboxes/:id', () => {
  it('updates inbox fields', async () => {
    const list = await get('/v1/inboxes')
    const id = list.data.data[0].id

    const { status, data } = await patch(`/v1/inboxes/${id}`, {
      description: 'Updated description',
      labels: ['priority', 'active'],
    })
    expect(status).toBe(200)
    expect(data.description).toBe('Updated description')
    expect(data.labels).toEqual(['priority', 'active'])
  })
})

describe('POST /v1/inboxes/:id/pause + resume', () => {
  it('pauses and resumes an inbox', async () => {
    const list = await get('/v1/inboxes')
    const id = list.data.data[0].id

    const pause = await post(`/v1/inboxes/${id}/pause`, {})
    expect(pause.status).toBe(200)
    expect(pause.data.status).toBe('paused')

    const resume = await post(`/v1/inboxes/${id}/resume`, {})
    expect(resume.status).toBe(200)
    expect(resume.data.status).toBe('active')
  })
})

describe('DELETE /v1/inboxes/:id', () => {
  it('archives an inbox (soft delete)', async () => {
    const created = await post('/v1/inboxes', {
      name: 'to-delete',
      emailAddress: 'delete-me@mail.example.com',
    })
    const id = created.data.id

    const { status, data } = await del(`/v1/inboxes/${id}`)
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)

    const verify = await get(`/v1/inboxes/${id}`)
    expect(verify.data.status).toBe('archived')
  })
})

describe('threads', () => {
  it('lists threads for an inbox', async () => {
    const list = await get('/v1/inboxes')
    const id = list.data.data[0].id

    const { status, data } = await get(`/v1/inboxes/${id}/threads`)
    expect(status).toBe(200)
    expect(data.data).toBeInstanceOf(Array)
  })
})

describe('messages', () => {
  it('lists messages for an inbox', async () => {
    const list = await get('/v1/inboxes')
    const id = list.data.data[0].id

    const { status, data } = await get(`/v1/inboxes/${id}/messages`)
    expect(status).toBe(200)
    expect(data.data).toBeInstanceOf(Array)
  })
})

describe('webhooks', () => {
  let webhookId: string

  it('creates a webhook', async () => {
    const { status, data } = await post('/v1/webhooks', {
      url: 'https://example.com/webhook',
      events: ['inbox.message.received', 'email.sent'],
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^whk_/)
    expect(data.secret).toBeTruthy()
    expect(data.events).toEqual(['inbox.message.received', 'email.sent'])
    webhookId = data.id
  })

  it('lists webhooks without secrets', async () => {
    const { status, data } = await get('/v1/webhooks')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThan(0)
    data.data.forEach((w: any) => expect(w.secret).toBeUndefined())
  })

  it('gets webhook without secret', async () => {
    const { status, data } = await get(`/v1/webhooks/${webhookId}`)
    expect(status).toBe(200)
    expect(data.secret).toBeUndefined()
    expect(data.url).toBe('https://example.com/webhook')
  })

  it('updates webhook', async () => {
    const { status, data } = await patch(`/v1/webhooks/${webhookId}`, {
      events: ['email.delivered'],
    })
    expect(status).toBe(200)
    expect(data.events).toEqual(['email.delivered'])
  })

  it('rejects webhook with invalid event type', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com/webhook',
        events: ['email.sent', 'totally.made.up'],
      }),
    })
    expect(res.status).toBe(400)
    const data = (await res.json()) as any
    expect(data.error.message).toContain('Invalid webhook event type')
  })

  it('deletes webhook', async () => {
    const { status, data } = await del(`/v1/webhooks/${webhookId}`)
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)
  })
})
