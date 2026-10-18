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
  rateLimits: {
    emails: 10000,
    domains: 10000,
    apiKeys: 10000,
    templates: 10000,
    contacts: 10000,
    inboxes: 10000,
    webhooks: 10000,
    campaigns: 10000,
    sequences: 10000,
    topics: 10000,
  },
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

// --- Auth on new endpoints ---

describe('auth on inbox endpoints', () => {
  it('rejects unauthenticated inbox list', async () => {
    const res = await fetch(`${baseUrl}/v1/inboxes`)
    expect(res.status).toBe(401)
  })

  it('rejects unauthenticated inbox create', async () => {
    const res = await fetch(`${baseUrl}/v1/inboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', emailAddress: 'test@example.com' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects unauthenticated webhook list', async () => {
    const res = await fetch(`${baseUrl}/v1/webhooks`)
    expect(res.status).toBe(401)
  })

  it('rejects invalid bearer token on inbox endpoints', async () => {
    const res = await fetch(`${baseUrl}/v1/inboxes`, {
      headers: { 'x-api-key': 'pgn_garbage' },
    })
    expect(res.status).toBe(401)
  })
})

// --- Inbox creation validation ---

describe('inbox creation validation', () => {
  it('rejects empty name', async () => {
    const { status } = await post('/v1/inboxes', {
      name: '',
      emailAddress: 'empty-name@mail.example.com',
    })
    expect(status).toBe(400)
  })

  it('rejects invalid email address', async () => {
    const { status } = await post('/v1/inboxes', {
      name: 'test',
      emailAddress: 'not-an-email',
    })
    expect(status).toBe(400)
  })

  it('rejects name exceeding 255 chars', async () => {
    const { status } = await post('/v1/inboxes', {
      name: 'x'.repeat(256),
      emailAddress: 'toolong@mail.example.com',
    })
    expect(status).toBe(400)
  })

  it('rejects description exceeding 1000 chars', async () => {
    const { status } = await post('/v1/inboxes', {
      name: 'desc-test',
      emailAddress: 'desc-test@mail.example.com',
      description: 'x'.repeat(1001),
    })
    expect(status).toBe(400)
  })

  it('rejects invalid webhook URL', async () => {
    const { status } = await post('/v1/inboxes', {
      name: 'bad-webhook',
      emailAddress: 'bad-hook@mail.example.com',
      webhookUrl: 'not-a-url',
    })
    expect(status).toBe(400)
  })

  it('accepts inbox with all optional fields', async () => {
    const { status, data } = await post('/v1/inboxes', {
      name: 'full-inbox',
      emailAddress: 'full@mail.example.com',
      description: 'Full featured inbox',
      webhookUrl: 'https://hooks.example.com/inbox',
      metadata: { team: 'support', priority: 1 },
      labels: ['production', 'tier-1'],
    })
    expect(status).toBe(201)
    expect(data.description).toBe('Full featured inbox')
    expect(data.webhookUrl).toBe('https://hooks.example.com/inbox')
    expect(data.metadata).toEqual({ team: 'support', priority: 1 })
    expect(data.labels).toEqual(['production', 'tier-1'])
  })
})

// --- Inbox lifecycle edge cases ---

describe('inbox lifecycle edge cases', () => {
  let inboxId: string

  beforeAll(async () => {
    const { data } = await post('/v1/inboxes', {
      name: 'lifecycle-test',
      emailAddress: 'lifecycle@mail.example.com',
    })
    inboxId = data.id
  })

  it('cannot pause an already archived inbox', async () => {
    const { data: created } = await post('/v1/inboxes', {
      name: 'to-archive',
      emailAddress: 'archive@mail.example.com',
    })
    await del(`/v1/inboxes/${created.id}`)

    const { status, data } = await post(`/v1/inboxes/${created.id}/pause`, {})
    expect(status).toBe(400)
  })

  it('cannot resume an inbox that is not paused', async () => {
    const { status } = await post(`/v1/inboxes/${inboxId}/resume`, {})
    expect(status).toBe(400)
  })

  it('pausing an already paused inbox sets status to paused', async () => {
    await post(`/v1/inboxes/${inboxId}/pause`, {})
    const { status, data } = await post(`/v1/inboxes/${inboxId}/pause`, {})
    expect(status).toBe(200)
    expect(data.status).toBe('paused')
    await post(`/v1/inboxes/${inboxId}/resume`, {})
  })

  it('returns 404 for pause on non-existent inbox', async () => {
    const { status } = await post('/v1/inboxes/inb_nonexistent/pause', {})
    expect(status).toBe(404)
  })

  it('returns 404 for resume on non-existent inbox', async () => {
    const { status } = await post('/v1/inboxes/inb_nonexistent/resume', {})
    expect(status).toBe(404)
  })

  it('returns 404 for delete on non-existent inbox', async () => {
    const { status } = await del('/v1/inboxes/inb_nonexistent')
    expect(status).toBe(404)
  })

  it('returns 404 for update on non-existent inbox', async () => {
    const { status } = await patch('/v1/inboxes/inb_nonexistent', { name: 'nope' })
    expect(status).toBe(404)
  })

  it('archived inbox is still retrievable by ID', async () => {
    const { data: created } = await post('/v1/inboxes', {
      name: 'archive-check',
      emailAddress: 'archive-check@mail.example.com',
    })
    await del(`/v1/inboxes/${created.id}`)

    const { status, data } = await get(`/v1/inboxes/${created.id}`)
    expect(status).toBe(200)
    expect(data.status).toBe('archived')
  })

  it('can update name and description in one call', async () => {
    const { status, data } = await patch(`/v1/inboxes/${inboxId}`, {
      name: 'updated-lifecycle',
      description: 'Updated description',
    })
    expect(status).toBe(200)
    expect(data.name).toBe('updated-lifecycle')
    expect(data.description).toBe('Updated description')
  })

  it('can clear webhook URL by setting to null', async () => {
    await patch(`/v1/inboxes/${inboxId}`, {
      webhookUrl: 'https://temp.example.com',
    })

    const { data } = await patch(`/v1/inboxes/${inboxId}`, {
      webhookUrl: null,
    })
    expect(data.webhookUrl).toBeNull()
  })
})

// --- Catch-all ---

describe('catch-all inbox', () => {
  it('sets catch-all and swaps to a different inbox', async () => {
    const { data: first } = await post('/v1/inboxes', {
      name: 'catchall-1',
      emailAddress: 'catchall1@mail.example.com',
    })
    const { data: second } = await post('/v1/inboxes', {
      name: 'catchall-2',
      emailAddress: 'catchall2@mail.example.com',
    })

    const { data: result1 } = await post(`/v1/inboxes/${first.id}/catch-all`, {})
    expect(result1.catchAll).toBe(true)

    const { data: result2 } = await post(`/v1/inboxes/${second.id}/catch-all`, {})
    expect(result2.catchAll).toBe(true)

    const { data: verify1 } = await get(`/v1/inboxes/${first.id}`)
    expect(verify1.catchAll).toBe(false)
  })

  it('returns 404 for catch-all on non-existent inbox', async () => {
    const { status } = await post('/v1/inboxes/inb_nonexistent/catch-all', {})
    expect(status).toBe(404)
  })
})

// --- List filtering ---

describe('inbox list filtering', () => {
  it('filters by label', async () => {
    await post('/v1/inboxes', {
      name: 'labeled-inbox',
      emailAddress: 'labeled@mail.example.com',
      labels: ['special'],
    })

    const { data } = await get('/v1/inboxes?label=special')
    expect(data.data.length).toBeGreaterThanOrEqual(1)
    data.data.forEach((inbox: any) => {
      expect(inbox.labels).toContain('special')
    })
  })

  it('returns empty when label matches nothing', async () => {
    const { data } = await get('/v1/inboxes?label=nonexistent-label-xyz')
    expect(data.data.length).toBe(0)
  })

  it('filters by archived status', async () => {
    const { data } = await get('/v1/inboxes?status=archived')
    data.data.forEach((inbox: any) => {
      expect(inbox.status).toBe('archived')
    })
  })

  it('respects limit parameter', async () => {
    const { data } = await get('/v1/inboxes?limit=1')
    expect(data.data.length).toBeLessThanOrEqual(1)
    if (data.has_more) {
      expect(data.next_cursor).toBeTruthy()
    }
  })

  it('paginates via cursor', async () => {
    const page1 = await get('/v1/inboxes?limit=2')
    if (page1.data.has_more) {
      const page2 = await get(`/v1/inboxes?limit=2&cursor=${page1.data.next_cursor}`)
      expect(page2.status).toBe(200)
      const page1Ids = page1.data.data.map((i: any) => i.id)
      const page2Ids = page2.data.data.map((i: any) => i.id)
      // No overlap between pages
      page2Ids.forEach((id: string) => expect(page1Ids).not.toContain(id))
    }
  })
})

// --- Messages for inbox ---

describe('inbox messages edge cases', () => {
  it('returns 404 for messages on non-existent inbox', async () => {
    const { status } = await get('/v1/inboxes/inb_nonexistent/messages')
    expect(status).toBe(404)
  })

  it('returns 404 for specific message on non-existent inbox', async () => {
    const { status } = await get('/v1/inboxes/inb_nonexistent/messages/imsg_doesntmatter')
    expect(status).toBe(404)
  })

  it('returns 404 for non-existent message in valid inbox', async () => {
    const list = await get('/v1/inboxes?status=active&limit=1')
    const inboxId = list.data.data[0]?.id
    if (!inboxId) return

    const { status } = await get(`/v1/inboxes/${inboxId}/messages/imsg_nonexistent`)
    expect(status).toBe(404)
  })

  it('returns empty array for inbox with no messages', async () => {
    const { data: inbox } = await post('/v1/inboxes', {
      name: 'empty-messages',
      emailAddress: 'empty-msgs@mail.example.com',
    })

    const { status, data } = await get(`/v1/inboxes/${inbox.id}/messages`)
    expect(status).toBe(200)
    expect(data.data).toEqual([])
    expect(data.has_more).toBe(false)
  })
})

// --- Threads for inbox ---

describe('inbox threads edge cases', () => {
  it('returns 404 for threads on non-existent inbox', async () => {
    const { status } = await get('/v1/inboxes/inb_nonexistent/threads')
    expect(status).toBe(404)
  })

  it('returns 404 for specific thread on non-existent inbox', async () => {
    const { status } = await get('/v1/inboxes/inb_nonexistent/threads/thr_doesntmatter')
    expect(status).toBe(404)
  })

  it('returns 404 for non-existent thread in valid inbox', async () => {
    const list = await get('/v1/inboxes?status=active&limit=1')
    const inboxId = list.data.data[0]?.id
    if (!inboxId) return

    const { status } = await get(`/v1/inboxes/${inboxId}/threads/thr_nonexistent`)
    expect(status).toBe(404)
  })

  it('returns empty array for inbox with no threads', async () => {
    const { data: inbox } = await post('/v1/inboxes', {
      name: 'empty-threads',
      emailAddress: 'empty-threads@mail.example.com',
    })

    const { status, data } = await get(`/v1/inboxes/${inbox.id}/threads`)
    expect(status).toBe(200)
    expect(data.data).toEqual([])
    expect(data.has_more).toBe(false)
  })
})

// --- Thread updates ---

describe('thread update validation', () => {
  it('rejects invalid thread status', async () => {
    const { data: inbox } = await post('/v1/inboxes', {
      name: 'thread-update-test',
      emailAddress: 'thread-update@mail.example.com',
    })

    // We need a thread to test  - create one directly... but through the API
    // we can't create threads directly, they're created via message routing.
    // We'll test the validation rejects invalid status at the route level.
    // If a thread existed, updating with invalid status should 400.
    // For now, test the route rejects the schema:
    const { status } = await patch(
      `/v1/inboxes/${inbox.id}/threads/thr_fake`,
      { status: 'invalid_status' },
    )
    expect(status).toBe(400)
  })

  it('accepts valid thread statuses', async () => {
    const { data: inbox } = await post('/v1/inboxes', {
      name: 'thread-valid-status',
      emailAddress: 'thread-valid@mail.example.com',
    })

    // Trying with non-existent thread but valid status should 404 (not 400)
    const { status: closedStatus } = await patch(
      `/v1/inboxes/${inbox.id}/threads/thr_fake`,
      { status: 'closed' },
    )
    expect(closedStatus).toBe(404)

    const { status: snoozedStatus } = await patch(
      `/v1/inboxes/${inbox.id}/threads/thr_fake`,
      { status: 'snoozed' },
    )
    expect(snoozedStatus).toBe(404)
  })
})

// --- Send message validation ---

describe('send inbox message validation', () => {
  let inboxId: string

  beforeAll(async () => {
    const { data } = await post('/v1/inboxes', {
      name: 'send-test',
      emailAddress: 'send-test@mail.example.com',
    })
    inboxId = data.id
  })

  it('rejects invalid to email', async () => {
    const { status } = await post(`/v1/inboxes/${inboxId}/messages`, {
      to: 'not-an-email',
      subject: 'Test',
      text: 'Hello',
    })
    expect(status).toBe(400)
  })

  it('rejects missing body (no html or text)', async () => {
    const { status } = await post(`/v1/inboxes/${inboxId}/messages`, {
      to: 'user@example.com',
      subject: 'No body',
    })
    // The route schema allows omitting both html and text,
    // but the service will throw ValidationError
    expect(status).toBe(400)
  })

  it('returns 404 for send to non-existent inbox', async () => {
    const { status } = await post('/v1/inboxes/inb_nonexistent/messages', {
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    })
    expect(status).toBe(404)
  })

  it('rejects send from paused inbox', async () => {
    await post(`/v1/inboxes/${inboxId}/pause`, {})

    const { status, data } = await post(`/v1/inboxes/${inboxId}/messages`, {
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    })
    expect(status).toBe(400)

    await post(`/v1/inboxes/${inboxId}/resume`, {})
  })

  it('rejects send from archived inbox', async () => {
    const { data: archiveInbox } = await post('/v1/inboxes', {
      name: 'send-archived',
      emailAddress: 'send-archived@mail.example.com',
    })
    await del(`/v1/inboxes/${archiveInbox.id}`)

    const { status } = await post(`/v1/inboxes/${archiveInbox.id}/messages`, {
      to: 'user@example.com',
      subject: 'Test',
      text: 'Hello',
    })
    expect(status).toBe(400)
  })

  it('accepts array of to addresses', async () => {
    // Will fail at SES level since we're using test credentials,
    // but the validation should pass
    const { status } = await post(`/v1/inboxes/${inboxId}/messages`, {
      to: ['a@example.com', 'b@example.com'],
      subject: 'Multi-recipient',
      text: 'Hello all',
    })
    // Will be 500 because SES isn't real, but should not be 400
    expect(status).not.toBe(400)
  })

  it('rejects reply to non-existent message', async () => {
    const { status } = await post(`/v1/inboxes/${inboxId}/messages`, {
      to: 'user@example.com',
      subject: 'Re: Something',
      text: 'Reply',
      inReplyTo: 'imsg_nonexistent',
    })
    expect(status).toBe(404)
  })
})

// --- Webhook edge cases ---

describe('webhook creation validation', () => {
  it('rejects invalid URL', async () => {
    const { status } = await post('/v1/webhooks', {
      url: 'not-a-url',
      events: ['email.sent'],
    })
    expect(status).toBe(400)
  })

  it('rejects empty events array', async () => {
    const { status } = await post('/v1/webhooks', {
      url: 'https://example.com/hook',
      events: [],
    })
    expect(status).toBe(400)
  })

  it('rejects missing events field', async () => {
    const { status } = await post('/v1/webhooks', {
      url: 'https://example.com/hook',
    })
    expect(status).toBe(400)
  })

  it('rejects missing url field', async () => {
    const { status } = await post('/v1/webhooks', {
      events: ['email.sent'],
    })
    expect(status).toBe(400)
  })

  it('accepts custom secret (min 16 chars)', async () => {
    const { status, data } = await post('/v1/webhooks', {
      url: 'https://example.com/custom-secret',
      events: ['email.sent'],
      secret: 'my-custom-secret-key-123',
    })
    expect(status).toBe(201)
    expect(data.secret).toBe('my-custom-secret-key-123')
  })

  it('rejects custom secret shorter than 16 chars', async () => {
    const { status } = await post('/v1/webhooks', {
      url: 'https://example.com/short-secret',
      events: ['email.sent'],
      secret: 'short',
    })
    expect(status).toBe(400)
  })

  it('auto-generates secret when not provided', async () => {
    const { data } = await post('/v1/webhooks', {
      url: 'https://example.com/auto-secret',
      events: ['email.sent'],
    })
    expect(data.secret).toMatch(/^whsec_/)
  })
})

describe('webhook update and delete edge cases', () => {
  it('returns 404 updating non-existent webhook', async () => {
    const { status } = await patch('/v1/webhooks/whk_nonexistent', {
      url: 'https://new.example.com',
    })
    expect(status).toBe(404)
  })

  it('returns 404 deleting non-existent webhook', async () => {
    const { status } = await del('/v1/webhooks/whk_nonexistent')
    expect(status).toBe(404)
  })

  it('returns 404 getting non-existent webhook', async () => {
    const { status } = await get('/v1/webhooks/whk_nonexistent')
    expect(status).toBe(404)
  })

  it('can disable and re-enable a webhook', async () => {
    const { data: wh } = await post('/v1/webhooks', {
      url: 'https://example.com/toggle',
      events: ['email.sent'],
    })

    const { data: disabled } = await patch(`/v1/webhooks/${wh.id}`, {
      status: 'disabled',
    })
    expect(disabled.status).toBe('disabled')

    const { data: enabled } = await patch(`/v1/webhooks/${wh.id}`, {
      status: 'active',
    })
    expect(enabled.status).toBe('active')
  })

  it('can update events list', async () => {
    const { data: wh } = await post('/v1/webhooks', {
      url: 'https://example.com/update-events',
      events: ['email.sent'],
    })

    const { data: updated } = await patch(`/v1/webhooks/${wh.id}`, {
      events: ['email.sent', 'email.delivered', 'inbox.message.received'],
    })
    expect(updated.events).toEqual(['email.sent', 'email.delivered', 'inbox.message.received'])
  })

  it('can update URL', async () => {
    const { data: wh } = await post('/v1/webhooks', {
      url: 'https://old.example.com/hook',
      events: ['email.sent'],
    })

    const { data: updated } = await patch(`/v1/webhooks/${wh.id}`, {
      url: 'https://new.example.com/hook',
    })
    expect(updated.url).toBe('https://new.example.com/hook')
  })
})

describe('webhook list pagination', () => {
  it('returns paginated results', async () => {
    // Create a few webhooks
    for (let i = 0; i < 3; i++) {
      await post('/v1/webhooks', {
        url: `https://example.com/page-${i}`,
        events: ['email.sent'],
      })
    }

    const page1 = await get('/v1/webhooks?limit=2')
    expect(page1.data.data.length).toBeLessThanOrEqual(2)

    if (page1.data.has_more) {
      const page2 = await get(`/v1/webhooks?limit=2&cursor=${page1.data.next_cursor}`)
      expect(page2.status).toBe(200)
    }
  })

  it('secrets are stripped from list response', async () => {
    const { data } = await get('/v1/webhooks')
    data.data.forEach((w: any) => {
      expect(w.secret).toBeUndefined()
    })
  })
})
