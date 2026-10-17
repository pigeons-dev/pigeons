import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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

describe('health', () => {
  it('returns 200 without auth', async () => {
    const res = await fetch(`${baseUrl}/health`)
    const data = (await res.json()) as any
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
  })
})

describe('auth', () => {
  it('rejects requests without auth header', async () => {
    const res = await fetch(`${baseUrl}/v1/emails`)
    expect(res.status).toBe(401)
  })

  it('rejects invalid api keys', async () => {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      headers: { 'x-api-key': 'pgn_invalid' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects non-pgn tokens', async () => {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      headers: { 'x-api-key': 'some_random_token' },
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /v1/emails', () => {
  it('queues an email', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'user@example.com',
      subject: 'Test',
      html: '<h1>Hello</h1>',
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^msg_/)
    expect(data.status).toBe('queued')
    expect(data.from).toBe('test@example.com')
    expect(data.to).toEqual(['user@example.com'])
  })

  it('rejects missing subject', async () => {
    const { status } = await post('/v1/emails', {
      to: 'user@example.com',
      html: '<h1>Hello</h1>',
    })
    expect(status).toBe(400)
  })

  it('rejects missing body', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'user@example.com',
      subject: 'Test',
    })
    expect(status).toBe(400)
    expect(data.error.message).toContain('html, text, or templateId')
  })

  it('rejects invalid email address', async () => {
    const { status } = await post('/v1/emails', {
      to: 'not-an-email',
      subject: 'Test',
      html: '<p>Hi</p>',
    })
    expect(status).toBe(400)
  })
})

describe('GET /v1/emails', () => {
  it('lists emails with pagination', async () => {
    const { status, data } = await get('/v1/emails')
    expect(status).toBe(200)
    expect(data).toHaveProperty('data')
    expect(data).toHaveProperty('has_more')
    expect(data).toHaveProperty('next_cursor')
    expect(Array.isArray(data.data)).toBe(true)
  })
})

describe('GET /v1/emails/:id', () => {
  it('returns an email by id', async () => {
    const created = await post('/v1/emails', {
      to: 'get-test@example.com',
      subject: 'Get Test',
      html: '<p>Test</p>',
    })

    const { status, data } = await get(`/v1/emails/${created.data.id}`)
    expect(status).toBe(200)
    expect(data.id).toBe(created.data.id)
    expect(data.subject).toBe('Get Test')
  })

  it('returns 404 for unknown id', async () => {
    const { status } = await get('/v1/emails/msg_nonexistent')
    expect(status).toBe(404)
  })
})

describe('POST /v1/emails/:id/cancel', () => {
  it('cancels a queued email', async () => {
    const created = await post('/v1/emails', {
      to: 'cancel@example.com',
      subject: 'Cancel Me',
      html: '<p>Cancel</p>',
    })

    const { status, data } = await post(`/v1/emails/${created.data.id}/cancel`, {})
    expect(status).toBe(200)
    expect(data.status).toBe('failed')
  })
})

describe('POST /v1/emails/batch', () => {
  it('queues multiple emails', async () => {
    const { status, data } = await post('/v1/emails/batch', [
      { to: 'a@example.com', subject: 'A', html: '<p>A</p>' },
      { to: 'b@example.com', subject: 'B', html: '<p>B</p>' },
    ])
    expect(status).toBe(201)
    expect(data).toHaveLength(2)
    expect(data[0].id).toMatch(/^msg_/)
    expect(data[1].id).toMatch(/^msg_/)
  })
})

describe('API keys', () => {
  it('lists api keys', async () => {
    const { status, data } = await get('/v1/api-keys')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThan(0)
    expect(data.data[0]).not.toHaveProperty('hash')
  })

  it('creates and revokes an api key', async () => {
    const { status: createStatus, data: key } = await post('/v1/api-keys', { name: 'Temp Key' })
    expect(createStatus).toBe(201)
    expect(key.key).toMatch(/^pgn_/)

    const res = await fetch(`${baseUrl}/v1/api-keys/${key.id}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey },
    })
    expect(res.status).toBe(200)
  })
})

describe('Templates', () => {
  let templateId: string

  it('creates a template', async () => {
    const { status, data } = await post('/v1/templates', {
      slug: 'welcome',
      name: 'Welcome Email',
      subject: 'Welcome {{name}}',
      body: 'const Template = (data) => createElement("p", null, "Hello " + data.name)',
      sampleData: { name: 'Test User' },
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^tpl_/)
    expect(data.slug).toBe('welcome')
    expect(data.version).toBe(1)
    templateId = data.id
  })

  it('rejects duplicate slug', async () => {
    const { status } = await post('/v1/templates', {
      slug: 'welcome',
      name: 'Duplicate',
      subject: 'Dup',
      body: 'const Template = () => createElement("p", null, "dup")',
    })
    expect(status).toBe(409)
  })

  it('lists templates', async () => {
    const { status, data } = await get('/v1/templates')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThan(0)
  })

  it('gets a template by slug', async () => {
    const { status, data } = await get('/v1/templates/welcome')
    expect(status).toBe(200)
    expect(data.name).toBe('Welcome Email')
  })

  it('gets a template by id', async () => {
    const { status, data } = await get(`/v1/templates/${templateId}`)
    expect(status).toBe(200)
    expect(data.slug).toBe('welcome')
  })

  it('updates a template', async () => {
    const { status, data } = await patch(`/v1/templates/${templateId}`, {
      name: 'Updated Welcome',
    })
    expect(status).toBe(200)
    expect(data.name).toBe('Updated Welcome')
  })

  it('increments version on body change', async () => {
    const { data } = await patch(`/v1/templates/${templateId}`, {
      body: 'const Template = (data) => createElement("p", null, "Hi " + data.name)',
    })
    expect(data.version).toBe(2)
  })

  it('previews a template', async () => {
    const { status, data } = await post(`/v1/templates/${templateId}/preview`, {
      data: { name: 'Preview User' },
    })
    expect(status).toBe(200)
    expect(data.subject).toBe('Welcome Preview User')
    expect(data.html).toBeTruthy()
    expect(data.text).toBeTruthy()
  })

  it('deletes a template', async () => {
    const { status, data } = await del(`/v1/templates/${templateId}`)
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)
  })
})

describe('Contacts', () => {
  let contactId: string

  it('creates a contact', async () => {
    const { status, data } = await post('/v1/contacts', {
      email: 'contact@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      tags: ['vip', 'beta'],
      properties: { plan: 'pro' },
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^ctc_/)
    expect(data.email).toBe('contact@example.com')
    expect(data.tags).toEqual(['vip', 'beta'])
    contactId = data.id
  })

  it('rejects duplicate email', async () => {
    const { status } = await post('/v1/contacts', {
      email: 'contact@example.com',
    })
    expect(status).toBe(409)
  })

  it('batch creates contacts', async () => {
    const { status, data } = await post('/v1/contacts/batch', [
      { email: 'batch1@example.com', firstName: 'Batch' },
      { email: 'batch2@example.com', firstName: 'Batch' },
      { email: 'contact@example.com' },
    ])
    expect(status).toBe(201)
    expect(data.created).toBe(2)
    expect(data.skipped).toBe(1)
  })

  it('lists contacts', async () => {
    const { status, data } = await get('/v1/contacts')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThanOrEqual(3)
  })

  it('gets a contact by id', async () => {
    const { status, data } = await get(`/v1/contacts/${contactId}`)
    expect(status).toBe(200)
    expect(data.firstName).toBe('Jane')
  })

  it('gets a contact by email', async () => {
    const { status, data } = await get('/v1/contacts/contact@example.com')
    expect(status).toBe(200)
    expect(data.id).toBe(contactId)
  })

  it('updates a contact', async () => {
    const { status, data } = await patch(`/v1/contacts/${contactId}`, {
      tags: ['vip', 'beta', 'early'],
      properties: { plan: 'enterprise' },
    })
    expect(status).toBe(200)
    expect(data.tags).toEqual(['vip', 'beta', 'early'])
    expect(data.properties).toEqual({ plan: 'enterprise' })
  })

  it('unsubscribes a contact', async () => {
    const { status, data } = await post(`/v1/contacts/${contactId}/unsubscribe`, {})
    expect(status).toBe(200)
    expect(data.unsubscribed).toBe(true)
    expect(data.unsubscribedAt).toBeTruthy()
  })

  it('resubscribes a contact', async () => {
    const { status, data } = await post(`/v1/contacts/${contactId}/resubscribe`, {})
    expect(status).toBe(200)
    expect(data.unsubscribed).toBe(false)
    expect(data.unsubscribedAt).toBeNull()
  })

  it('deletes a contact', async () => {
    const { status, data } = await del(`/v1/contacts/${contactId}`)
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)
  })
})

async function rawPost(path: string, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (body && typeof body === 'object' && 'Type' in body) {
    headers['x-amz-sns-message-type'] = (body as any).Type
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

function snsNotification(payload: unknown) {
  return { Type: 'Notification', Message: JSON.stringify(payload) }
}

describe('SES events (no auth)', () => {
  let testEmailId: string

  it('processes delivery event', async () => {
    const email = await post('/v1/emails', {
      to: 'deliver@example.com',
      subject: 'Delivery test',
      html: '<p>hi</p>',
    })
    testEmailId = email.data.id

    const fakeMessageId = `ses-${Date.now()}`
    await patch(`/v1/emails/${testEmailId}`, { sesMessageId: fakeMessageId }).catch(() => {})

    const { status, data } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Delivery',
        mail: { messageId: email.data.sesMessageId },
      }),
    )
    expect(status).toBe(200)
    expect(data.processed).toBe('Delivery')
  })

  it('processes bounce event and marks contact bounced', async () => {
    const contact = await post('/v1/contacts', { email: 'bouncer@example.com' })
    expect(contact.status).toBe(201)

    const { status, data } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Bounce',
        mail: { messageId: 'nonexistent-msg' },
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'bouncer@example.com' }],
        },
      }),
    )
    expect(status).toBe(200)
    expect(data.processed).toBe('Bounce')

    const fetched = await get(`/v1/contacts/${encodeURIComponent('bouncer@example.com')}`)
    expect(fetched.data.bounced).toBe(true)
    expect(fetched.data.bouncedAt).toBeTruthy()
  })

  it('processes complaint event and auto-unsubscribes contact', async () => {
    const contact = await post('/v1/contacts', { email: 'complainer@example.com' })
    expect(contact.status).toBe(201)

    const { status, data } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Complaint',
        mail: { messageId: 'nonexistent-msg' },
        complaint: {
          complainedRecipients: [{ emailAddress: 'complainer@example.com' }],
        },
      }),
    )
    expect(status).toBe(200)
    expect(data.processed).toBe('Complaint')

    const fetched = await get(`/v1/contacts/${encodeURIComponent('complainer@example.com')}`)
    expect(fetched.data.unsubscribed).toBe(true)
    expect(fetched.data.complained).toBe(true)
  })

  it('handles SNS subscription confirmation', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
      if (url.startsWith('https://sns.')) {
        return Promise.resolve(new Response('ok'))
      }
      return originalFetch(...args)
    }) as typeof fetch
    try {
      const { status, data } = await rawPost('/v1/internal/ses/events', {
        Type: 'SubscriptionConfirmation',
        SubscribeURL: 'https://sns.us-east-1.amazonaws.com/confirm?token=abc',
      })
      expect(status).toBe(200)
      expect(data.confirmed).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects subscription confirmation with non-SNS URL', async () => {
    const { status, data } = await rawPost('/v1/internal/ses/events', {
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://evil.example.com/pwned',
    })
    expect(status).toBe(403)
    expect(data.error).toBe('Invalid SubscribeURL')
  })

  it('skips unknown event types', async () => {
    const { status, data } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({ eventType: 'Send' }),
    )
    expect(status).toBe(200)
    expect(data.processed).toBe('Send')
  })

  it('skips non-Notification SNS messages', async () => {
    const { status, data } = await rawPost('/v1/internal/ses/events', {
      Type: 'UnsubscribeConfirmation',
    })
    expect(status).toBe(200)
    expect(data.skipped).toBe(true)
  })
})
