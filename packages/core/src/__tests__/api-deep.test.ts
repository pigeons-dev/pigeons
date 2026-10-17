import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { createApp } from '../app.js'
import { generateApiKey } from '../utils/crypto.js'
import { generateId } from '../utils/id.js'
import type { Config } from '../config.js'
import type { Server } from 'node:http'
import type { DB } from '../db/index.js'

let server: Server
let baseUrl: string
let apiKey: string
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
  workerPollInterval: 1000,
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
      const port = typeof addr === 'object' && addr ? addr.port : 0
      baseUrl = `http://127.0.0.1:${port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

async function get(path: string, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...headers },
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function post(path: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function patch(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function del(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  return { status: res.status, data: (await res.json()) as any }
}

async function rawPost(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as any }
}

function snsNotification(payload: unknown) {
  return { Type: 'Notification', Message: JSON.stringify(payload) }
}

// =========================================
// Auth middleware deep tests
// =========================================

describe('auth edge cases', () => {
  it('rejects Authorization without Bearer prefix', async () => {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: apiKey },
    })
    expect(res.status).toBe(401)
  })

  it('rejects Basic auth scheme', async () => {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}` },
    })
    expect(res.status).toBe(401)
  })

  it('rejects empty Bearer token', async () => {
    const res = await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: 'Bearer ' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects expired API key', async () => {
    const { full, prefix, hash } = generateApiKey()
    const keyId = generateId('apiKey')
    await db.insert(schema.apiKeys).values({
      id: keyId,
      name: 'Expired Key',
      prefix,
      hash,
      scopes: null,
      expiresAt: '2020-01-01T00:00:00.000Z',
    })

    const res = await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: `Bearer ${full}` },
    })
    expect(res.status).toBe(401)
  })

  it('updates lastUsedAt on successful auth', async () => {
    const { full, prefix, hash } = generateApiKey()
    const keyId = generateId('apiKey')
    await db.insert(schema.apiKeys).values({
      id: keyId,
      name: 'Track Usage Key',
      prefix,
      hash,
      scopes: null,
    })

    const before = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId))
    expect(before[0].lastUsedAt).toBeNull()

    await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: `Bearer ${full}` },
    })

    const after = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId))
    expect(after[0].lastUsedAt).toBeTruthy()
  })

  it('revoked key can no longer authenticate', async () => {
    const created = await post('/v1/api-keys', { name: 'Revokable' })
    const tempKey = created.data.key

    // Verify it works
    const check = await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: `Bearer ${tempKey}` },
    })
    expect(check.status).toBe(200)

    // Revoke it
    await del(`/v1/api-keys/${created.data.id}`)

    // Verify it no longer works
    const recheck = await fetch(`${baseUrl}/v1/emails`, {
      headers: { Authorization: `Bearer ${tempKey}` },
    })
    expect(recheck.status).toBe(401)
  })
})

// =========================================
// API keys deep tests
// =========================================

describe('API keys edge cases', () => {
  it('creates key with scopes', async () => {
    const { status, data } = await post('/v1/api-keys', {
      name: 'Scoped Key',
      scopes: ['send', 'contacts.read'],
    })
    expect(status).toBe(201)
    expect(data.scopes).toEqual(['send', 'contacts.read'])
  })

  it('creates key with expiration', async () => {
    const { status, data } = await post('/v1/api-keys', {
      name: 'Expiring Key',
      expiresAt: '2030-12-31T23:59:59.000Z',
    })
    expect(status).toBe(201)
  })

  it('returns 404 revoking non-existent key', async () => {
    const { status } = await del('/v1/api-keys/key_nonexistent')
    expect(status).toBe(404)
  })

  it('list never exposes hash field', async () => {
    const { data } = await get('/v1/api-keys')
    data.data.forEach((k: any) => {
      expect(k.hash).toBeUndefined()
    })
  })

  it('rejects create with empty name', async () => {
    const { status } = await post('/v1/api-keys', { name: '' })
    expect(status).toBe(400)
  })
})

// =========================================
// Email sending deep tests
// =========================================

describe('email sending edge cases', () => {
  it('sends with text-only (no html)', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'text-only@example.com',
      subject: 'Text Only',
      text: 'Plain text content',
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^msg_/)
  })

  it('sends with both html and text', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'both@example.com',
      subject: 'Both',
      html: '<p>HTML</p>',
      text: 'Plain text',
    })
    expect(status).toBe(201)
  })

  it('sends with custom from address', async () => {
    const { status, data } = await post('/v1/emails', {
      from: 'custom@myapp.com',
      to: 'user@example.com',
      subject: 'Custom From',
      html: '<p>Hi</p>',
    })
    expect(status).toBe(201)
    expect(data.from).toBe('custom@myapp.com')
  })

  it('defaults from to config.fromEmail', async () => {
    const { data } = await post('/v1/emails', {
      to: 'user@example.com',
      subject: 'Default From',
      html: '<p>Hi</p>',
    })
    expect(data.from).toBe('test@example.com')
  })

  it('sends with tags', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'tagged@example.com',
      subject: 'Tagged',
      html: '<p>Hi</p>',
      tags: ['transactional', 'welcome'],
    })
    expect(status).toBe(201)

    const { data: fetched } = await get(`/v1/emails/${data.id}`)
    expect(fetched.tags).toEqual(['transactional', 'welcome'])
  })

  it('sends with multiple recipients (to as array)', async () => {
    const { status, data } = await post('/v1/emails', {
      to: ['a@example.com', 'b@example.com'],
      subject: 'Multi',
      html: '<p>Hi all</p>',
    })
    expect(status).toBe(201)
    expect(data.to).toEqual(['a@example.com', 'b@example.com'])
  })

  it('sends with cc and bcc', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'main@example.com',
      cc: ['cc1@example.com'],
      bcc: ['bcc1@example.com'],
      subject: 'CC/BCC Test',
      html: '<p>Hi</p>',
    })
    expect(status).toBe(201)

    const { data: fetched } = await get(`/v1/emails/${data.id}`)
    expect(fetched.cc).toEqual(['cc1@example.com'])
    expect(fetched.bcc).toEqual(['bcc1@example.com'])
  })

  it('sends with custom headers', async () => {
    const { status, data } = await post('/v1/emails', {
      to: 'headers@example.com',
      subject: 'Custom Headers',
      html: '<p>Hi</p>',
      headers: { 'X-Custom': 'test-value' },
    })
    expect(status).toBe(201)

    const { data: fetched } = await get(`/v1/emails/${data.id}`)
    expect(fetched.headers).toEqual({ 'X-Custom': 'test-value' })
  })

  it('rejects invalid from email', async () => {
    const { status } = await post('/v1/emails', {
      from: 'not-email',
      to: 'user@example.com',
      subject: 'Bad From',
      html: '<p>Hi</p>',
    })
    expect(status).toBe(400)
  })

  it('rejects invalid cc email', async () => {
    const { status } = await post('/v1/emails', {
      to: 'user@example.com',
      cc: ['not-email'],
      subject: 'Bad CC',
      html: '<p>Hi</p>',
    })
    expect(status).toBe(400)
  })

  it('stores email without subject when using template', async () => {
    // Create a template first
    await post('/v1/templates', {
      slug: 'deep-test-tpl',
      name: 'Deep Test',
      subject: 'Hello {{name}}',
      body: 'const Template = (data) => createElement("p", null, "Hi " + data.name)',
    })

    const { status, data } = await post('/v1/emails', {
      to: 'tpl-user@example.com',
      templateId: 'deep-test-tpl',
      data: { name: 'Alice' },
    })
    expect(status).toBe(201)
    expect(data.subject).toBe('Hello Alice')
  })

  it('sends with templateId using tpl_ prefix', async () => {
    const { data: tpl } = await get('/v1/templates/deep-test-tpl')

    const { status, data } = await post('/v1/emails', {
      to: 'tpl-id@example.com',
      templateId: tpl.id,
      data: { name: 'Bob' },
    })
    expect(status).toBe(201)
    expect(data.subject).toBe('Hello Bob')
  })

  it('returns 404 for non-existent templateId', async () => {
    const { status } = await post('/v1/emails', {
      to: 'user@example.com',
      templateId: 'nonexistent-slug',
    })
    expect(status).toBe(404)
  })

  it('subject override takes precedence over template subject', async () => {
    const { data } = await post('/v1/emails', {
      to: 'override@example.com',
      subject: 'Override Subject',
      templateId: 'deep-test-tpl',
      data: { name: 'Charlie' },
    })
    expect(data.subject).toBe('Override Subject')
  })
})

describe('email cancel edge cases', () => {
  it('returns 404 for cancelling non-existent email', async () => {
    const { status } = await post('/v1/emails/msg_nonexistent/cancel', {})
    expect(status).toBe(404)
  })

  it('rejects cancelling already-cancelled email', async () => {
    const { data: created } = await post('/v1/emails', {
      to: 'cancel-twice@example.com',
      subject: 'Cancel Twice',
      html: '<p>Hi</p>',
    })
    await post(`/v1/emails/${created.id}/cancel`, {})

    const { status, data } = await post(`/v1/emails/${created.id}/cancel`, {})
    expect(status).toBe(400)
    expect(data.error.message).toContain('Cannot cancel')
  })
})

describe('email batch edge cases', () => {
  it('rejects empty batch array', async () => {
    const { status } = await post('/v1/emails/batch', [])
    expect(status).toBe(400)
  })

  it('rejects batch with invalid email in one item', async () => {
    const { status } = await post('/v1/emails/batch', [
      { to: 'valid@example.com', subject: 'OK', html: '<p>Hi</p>' },
      { to: 'not-an-email', subject: 'Bad', html: '<p>Hi</p>' },
    ])
    expect(status).toBe(400)
  })

  it('rejects batch exceeding 100 items', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({
      to: `batch${i}@example.com`,
      subject: `Batch ${i}`,
      html: '<p>Hi</p>',
    }))
    const { status } = await post('/v1/emails/batch', items)
    expect(status).toBe(400)
  })
})

describe('email list filtering', () => {
  it('filters by status', async () => {
    const { status, data } = await get('/v1/emails?status=queued')
    expect(status).toBe(200)
    data.data.forEach((e: any) => expect(e.status).toBe('queued'))
  })

  it('rejects invalid status filter', async () => {
    const { status } = await get('/v1/emails?status=bogus')
    expect(status).toBe(400)
  })

  it('respects limit parameter', async () => {
    const { status, data } = await get('/v1/emails?limit=2')
    expect(status).toBe(200)
    expect(data.data.length).toBeLessThanOrEqual(2)
  })

  it('cursor-based pagination returns non-overlapping pages', async () => {
    const page1 = await get('/v1/emails?limit=3')
    if (page1.data.has_more) {
      const page2 = await get(`/v1/emails?limit=3&cursor=${page1.data.next_cursor}`)
      const ids1 = page1.data.data.map((e: any) => e.id)
      const ids2 = page2.data.data.map((e: any) => e.id)
      ids2.forEach((id: string) => expect(ids1).not.toContain(id))
    }
  })
})

// =========================================
// Template deep tests
// =========================================

describe('template edge cases', () => {
  it('rejects uppercase in slug', async () => {
    const { status } = await post('/v1/templates', {
      slug: 'Has-Uppercase',
      name: 'Bad Slug',
      subject: 'Test',
      body: 'const Template = () => createElement("p", null, "hi")',
    })
    expect(status).toBe(400)
  })

  it('rejects special chars in slug', async () => {
    const { status } = await post('/v1/templates', {
      slug: 'has_underscore',
      name: 'Bad Slug',
      subject: 'Test',
      body: 'const Template = () => createElement("p", null, "hi")',
    })
    expect(status).toBe(400)
  })

  it('accepts valid slug with hyphens', async () => {
    const { status, data } = await post('/v1/templates', {
      slug: 'my-valid-slug-123',
      name: 'Valid',
      subject: 'Test',
      body: 'const Template = () => createElement("p", null, "hi")',
    })
    expect(status).toBe(201)
    expect(data.slug).toBe('my-valid-slug-123')
  })

  it('does not increment version on name-only change', async () => {
    const { data: created } = await post('/v1/templates', {
      slug: 'version-test',
      name: 'V1',
      subject: 'Sub',
      body: 'const Template = () => createElement("p", null, "v1")',
    })
    expect(created.version).toBe(1)

    const { data: updated } = await patch(`/v1/templates/${created.id}`, {
      name: 'V1 Renamed',
    })
    expect(updated.version).toBe(1)
  })

  it('increments version on subject change', async () => {
    const { data: created } = await post('/v1/templates', {
      slug: 'subject-version-test',
      name: 'Subject V',
      subject: 'Old Subject',
      body: 'const Template = () => createElement("p", null, "hi")',
    })

    const { data: updated } = await patch(`/v1/templates/${created.id}`, {
      subject: 'New Subject',
    })
    expect(updated.version).toBe(2)
  })

  it('returns 404 getting non-existent template', async () => {
    const { status } = await get('/v1/templates/no-such-slug')
    expect(status).toBe(404)
  })

  it('returns 404 updating non-existent template', async () => {
    const { status } = await patch('/v1/templates/no-such-slug', { name: 'New' })
    expect(status).toBe(404)
  })

  it('returns 404 deleting non-existent template', async () => {
    const { status } = await del('/v1/templates/no-such-slug')
    expect(status).toBe(404)
  })

  it('returns 404 previewing non-existent template', async () => {
    const { status } = await post('/v1/templates/no-such-slug/preview', {})
    expect(status).toBe(404)
  })

  it('preview uses sampleData when no data provided', async () => {
    const { data: tpl } = await post('/v1/templates', {
      slug: 'sample-data-test',
      name: 'Sample',
      subject: 'Hi {{name}}',
      body: 'const Template = (data) => createElement("p", null, "Hello " + data.name)',
      sampleData: { name: 'SampleUser' },
    })

    const { data } = await post(`/v1/templates/${tpl.id}/preview`, {})
    expect(data.subject).toBe('Hi SampleUser')
  })

  it('subject interpolation preserves unmatched variables', async () => {
    const { data: tpl } = await post('/v1/templates', {
      slug: 'partial-interp',
      name: 'Partial',
      subject: '{{greeting}} {{name}}!',
      body: 'const Template = () => createElement("p", null, "hi")',
    })

    const { data } = await post(`/v1/templates/${tpl.id}/preview`, {
      data: { name: 'Alice' },
    })
    expect(data.subject).toBe('{{greeting}} Alice!')
  })

  it('template pagination works', async () => {
    const { data } = await get('/v1/templates?limit=2')
    expect(data.data.length).toBeLessThanOrEqual(2)
    if (data.has_more) {
      expect(data.next_cursor).toBeTruthy()
    }
  })
})

// =========================================
// Contact deep tests
// =========================================

describe('contact edge cases', () => {
  it('creates contact with email only (minimal)', async () => {
    const { status, data } = await post('/v1/contacts', {
      email: 'minimal@example.com',
    })
    expect(status).toBe(201)
    expect(data.email).toBe('minimal@example.com')
    expect(data.firstName).toBeNull()
    expect(data.lastName).toBeNull()
  })

  it('rejects invalid email on create', async () => {
    const { status } = await post('/v1/contacts', {
      email: 'not-valid',
    })
    expect(status).toBe(400)
  })

  it('returns 404 getting non-existent contact by ID', async () => {
    const { status } = await get('/v1/contacts/ctc_nonexistent')
    expect(status).toBe(404)
  })

  it('returns 404 getting non-existent contact by email', async () => {
    const { status } = await get('/v1/contacts/nope@nowhere.com')
    expect(status).toBe(404)
  })

  it('returns 404 updating non-existent contact', async () => {
    const { status } = await patch('/v1/contacts/ctc_nonexistent', { firstName: 'X' })
    expect(status).toBe(404)
  })

  it('returns 404 deleting non-existent contact', async () => {
    const { status } = await del('/v1/contacts/ctc_nonexistent')
    expect(status).toBe(404)
  })

  it('returns 404 unsubscribing non-existent contact', async () => {
    const { status } = await post('/v1/contacts/ctc_nonexistent/unsubscribe', {})
    expect(status).toBe(404)
  })

  it('returns 404 resubscribing non-existent contact', async () => {
    const { status } = await post('/v1/contacts/ctc_nonexistent/resubscribe', {})
    expect(status).toBe(404)
  })

  it('unsubscribe is idempotent', async () => {
    const { data: contact } = await post('/v1/contacts', { email: 'double-unsub@example.com' })

    await post(`/v1/contacts/${contact.id}/unsubscribe`, {})
    const { status, data } = await post(`/v1/contacts/${contact.id}/unsubscribe`, {})
    expect(status).toBe(200)
    expect(data.unsubscribed).toBe(true)
  })

  it('updates contact by email', async () => {
    await post('/v1/contacts', { email: 'update-by-email@example.com', firstName: 'Old' })

    const { status, data } = await patch('/v1/contacts/update-by-email@example.com', {
      firstName: 'New',
    })
    expect(status).toBe(200)
    expect(data.firstName).toBe('New')
  })

  it('deletes contact by email', async () => {
    await post('/v1/contacts', { email: 'delete-by-email@example.com' })

    const { status, data } = await del('/v1/contacts/delete-by-email@example.com')
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)
  })

  it('filters contacts by tag', async () => {
    await post('/v1/contacts', {
      email: 'tagged1@example.com',
      tags: ['premium'],
    })
    await post('/v1/contacts', {
      email: 'tagged2@example.com',
      tags: ['free'],
    })

    const { data } = await get('/v1/contacts?tag=premium')
    data.data.forEach((c: any) => {
      expect(c.tags).toContain('premium')
    })
  })

  it('tag filter returns empty for non-existent tag', async () => {
    const { data } = await get('/v1/contacts?tag=nonexistent-tag-xyz')
    expect(data.data.length).toBe(0)
  })

  it('batch with all duplicates returns zero created', async () => {
    await post('/v1/contacts', { email: 'batch-dup@example.com' })

    const { status, data } = await post('/v1/contacts/batch', [
      { email: 'batch-dup@example.com' },
      { email: 'batch-dup@example.com' },
    ])
    expect(status).toBe(201)
    expect(data.created).toBe(0)
    expect(data.skipped).toBe(2)
  })

  it('contact list pagination with cursor', async () => {
    const page1 = await get('/v1/contacts?limit=2')
    if (page1.data.has_more) {
      const page2 = await get(`/v1/contacts?limit=2&cursor=${page1.data.next_cursor}`)
      const ids1 = page1.data.data.map((c: any) => c.id)
      const ids2 = page2.data.data.map((c: any) => c.id)
      ids2.forEach((id: string) => expect(ids1).not.toContain(id))
    }
  })
})

// =========================================
// Idempotency deep tests
// =========================================

describe('idempotency', () => {
  it('returns cached response on replay', async () => {
    const idempotencyKey = `idem-${Date.now()}`

    const first = await post(
      '/v1/emails',
      {
        to: 'idempotent@example.com',
        subject: 'Idempotent',
        html: '<p>Hi</p>',
      },
      { 'Idempotency-Key': idempotencyKey },
    )
    expect(first.status).toBe(201)

    const second = await post(
      '/v1/emails',
      {
        to: 'idempotent@example.com',
        subject: 'Idempotent',
        html: '<p>Hi</p>',
      },
      { 'Idempotency-Key': idempotencyKey },
    )
    expect(second.status).toBe(201)
    expect(second.data.id).toBe(first.data.id)
  })

  it('different keys produce different responses', async () => {
    const first = await post(
      '/v1/emails',
      {
        to: 'idem-a@example.com',
        subject: 'A',
        html: '<p>A</p>',
      },
      { 'Idempotency-Key': `key-a-${Date.now()}` },
    )

    const second = await post(
      '/v1/emails',
      {
        to: 'idem-b@example.com',
        subject: 'B',
        html: '<p>B</p>',
      },
      { 'Idempotency-Key': `key-b-${Date.now()}` },
    )

    expect(first.data.id).not.toBe(second.data.id)
  })

  it('no idempotency key creates new resources each time', async () => {
    const first = await post('/v1/emails', {
      to: 'no-key@example.com',
      subject: 'No Key',
      html: '<p>Hi</p>',
    })
    const second = await post('/v1/emails', {
      to: 'no-key@example.com',
      subject: 'No Key',
      html: '<p>Hi</p>',
    })
    expect(first.data.id).not.toBe(second.data.id)
  })
})

// =========================================
// SES events deep tests
// =========================================

describe('SES events edge cases', () => {
  it('transient bounce does NOT mark contact as bounced', async () => {
    await post('/v1/contacts', { email: 'soft-bounce@example.com' })

    await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Bounce',
        mail: { messageId: 'nonexistent' },
        bounce: {
          bounceType: 'Transient',
          bouncedRecipients: [{ emailAddress: 'soft-bounce@example.com' }],
        },
      }),
    )

    const { data } = await get('/v1/contacts/soft-bounce@example.com')
    expect(data.bounced).toBe(false)
  })

  it('bounce with unknown contact email does not error', async () => {
    const { status } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Bounce',
        mail: { messageId: 'nonexistent' },
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'not-in-db@example.com' }],
        },
      }),
    )
    expect(status).toBe(200)
  })

  it('complaint with multiple recipients marks all', async () => {
    await post('/v1/contacts', { email: 'complain-a@example.com' })
    await post('/v1/contacts', { email: 'complain-b@example.com' })

    await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Complaint',
        mail: { messageId: 'nonexistent' },
        complaint: {
          complainedRecipients: [
            { emailAddress: 'complain-a@example.com' },
            { emailAddress: 'complain-b@example.com' },
          ],
        },
      }),
    )

    const a = await get('/v1/contacts/complain-a@example.com')
    const b = await get('/v1/contacts/complain-b@example.com')
    expect(a.data.complained).toBe(true)
    expect(b.data.complained).toBe(true)
  })

  it('bounce with empty recipients list does not error', async () => {
    const { status } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Bounce',
        mail: { messageId: 'nonexistent' },
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [],
        },
      }),
    )
    expect(status).toBe(200)
  })

  it('complaint with empty recipients does not error', async () => {
    const { status } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Complaint',
        mail: { messageId: 'nonexistent' },
        complaint: { complainedRecipients: [] },
      }),
    )
    expect(status).toBe(200)
  })

  it('delivery with missing messageId does not error', async () => {
    const { status } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Delivery',
        mail: {},
      }),
    )
    expect(status).toBe(200)
  })

  it('bounce without bounce object does not error', async () => {
    const { status } = await rawPost(
      '/v1/internal/ses/events',
      snsNotification({
        eventType: 'Bounce',
        mail: { messageId: 'whatever' },
      }),
    )
    expect(status).toBe(200)
  })
})

// =========================================
// Error handler formatting
// =========================================

describe('error handler', () => {
  it('formats validation errors consistently', async () => {
    const { status, data } = await post('/v1/emails', {})
    expect(status).toBe(400)
    expect(data.error).toHaveProperty('type')
    expect(data.error).toHaveProperty('message')
    expect(data.error).toHaveProperty('code')
  })

  it('formats 404 errors consistently', async () => {
    const { status, data } = await get('/v1/emails/msg_nonexistent')
    expect(status).toBe(404)
    expect(data.error.type).toBe('not_found')
    expect(data.error.code).toBe('not_found')
  })

  it('formats conflict errors consistently', async () => {
    await post('/v1/contacts', { email: 'conflict-test@example.com' })
    const { status, data } = await post('/v1/contacts', { email: 'conflict-test@example.com' })
    expect(status).toBe(409)
    expect(data.error.type).toBe('conflict')
  })
})

// =========================================
// ID generation for all entity types
// =========================================

describe('ID generation completeness', () => {
  it('generates correct prefixes for all entity types', () => {
    expect(generateId('email')).toMatch(/^msg_/)
    expect(generateId('domain')).toMatch(/^dom_/)
    expect(generateId('apiKey')).toMatch(/^key_/)
    expect(generateId('job')).toMatch(/^job_/)
    expect(generateId('inbox')).toMatch(/^inb_/)
    expect(generateId('inboxMessage')).toMatch(/^imsg_/)
    expect(generateId('thread')).toMatch(/^thr_/)
    expect(generateId('contact')).toMatch(/^ctc_/)
    expect(generateId('template')).toMatch(/^tpl_/)
    expect(generateId('campaign')).toMatch(/^cmp_/)
    expect(generateId('sequence')).toMatch(/^seq_/)
    expect(generateId('webhook')).toMatch(/^whk_/)
    expect(generateId('webhookDelivery')).toMatch(/^wdl_/)
  })
})
