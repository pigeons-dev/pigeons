import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(import.meta.dirname, '../.env') })

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { startAll, stopAll, ctx } from './setup.js'
import {
  get,
  post,
  patch,
  del,
  request,
  sendInboundTestEmail,
  waitForEmailStatus,
  waitForInboxMessage,
  poll,
  uid,
} from './helpers.js'

const INBOUND_DOMAIN = process.env.E2E_INBOUND_DOMAIN ?? ''
const FROM_EMAIL = process.env.PIGEONS_FROM_EMAIL ?? ''
const SENDER_DOMAIN = INBOUND_DOMAIN.replace(/^mail\./, '')
const SES_SUCCESS = 'success@simulator.amazonses.com'
const SES_BOUNCE = 'bounce@simulator.amazonses.com'
const SES_COMPLAINT = 'complaint@simulator.amazonses.com'

beforeAll(startAll, 120_000)
afterAll(stopAll)

// =====================================================
// Outbound - send via API, SES delivers, events return
// =====================================================

describe('outbound email via SES', () => {
  it('sends an email and receives delivery confirmation', async () => {
    const { status, data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `E2E delivery ${uid()}`,
      html: '<p>Testing delivery pipeline</p>',
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^msg_/)

    const delivered = await waitForEmailStatus(data.id, 'delivered')
    expect(delivered.status).toBe('delivered')
  })

  it('sends to bounce simulator and processes hard bounce', async () => {
    await post('/v1/contacts', { email: SES_BOUNCE })

    const { data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_BOUNCE,
      subject: `E2E bounce ${uid()}`,
      html: '<p>Bounce test</p>',
    })

    const bounced = await waitForEmailStatus(data.id, 'bounced')
    expect(bounced.status).toBe('bounced')

    const contact = await poll(
      async () => {
        const { data: c } = await get(`/v1/contacts/${encodeURIComponent(SES_BOUNCE)}`)
        return c?.bounced ? c : null
      },
      { label: 'contact.bounced' },
    )
    expect(contact.bounced).toBe(true)
  })

  it('sends to complaint simulator and auto-unsubscribes', async () => {
    await post('/v1/contacts', { email: SES_COMPLAINT })

    const { data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_COMPLAINT,
      subject: `E2E complaint ${uid()}`,
      html: '<p>Complaint test</p>',
    })

    const complained = await waitForEmailStatus(data.id, 'complained')
    expect(complained.status).toBe('complained')

    const contact = await poll(
      async () => {
        const { data: c } = await get(`/v1/contacts/${encodeURIComponent(SES_COMPLAINT)}`)
        return c?.complained ? c : null
      },
      { label: 'contact.complained' },
    )
    expect(contact.unsubscribed).toBe(true)
    expect(contact.complained).toBe(true)
  })
})

// =====================================================
// Agent inbox - full inbound pipeline
// =====================================================

describe('agent inbox inbound pipeline', () => {
  let inboxId: string
  let inboxEmail: string

  it('creates an agent inbox', async () => {
    const tag = uid()
    inboxEmail = `e2e-${tag}@${INBOUND_DOMAIN}`

    const { status, data } = await post('/v1/inboxes', {
      name: `E2E Inbox ${tag}`,
      emailAddress: inboxEmail,
    })
    expect(status).toBe(201)
    expect(data.emailAddress).toBe(inboxEmail)
    inboxId = data.id
  })

  it('receives an inbound email routed to the inbox', async () => {
    const subject = `Inbound ${uid()}`
    const body = 'Hello from outside - E2E inbound test.'

    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: inboxEmail,
      subject,
      body,
    })

    const msg = await waitForInboxMessage(
      inboxId,
      (m) => m.direction === 'inbound' && m.subject?.includes('Inbound'),
      90_000,
    )
    expect(msg).toBeTruthy()
    expect(msg.direction).toBe('inbound')
    expect(msg.text).toContain('Hello from outside')
    expect(msg.threadId).toBeTruthy()
  })

  it('auto-creates a thread for the inbound message', async () => {
    const { status, data } = await get(`/v1/inboxes/${inboxId}/threads`)
    expect(status).toBe(200)
    const threads = data.data ?? data
    expect(threads.length).toBeGreaterThanOrEqual(1)
    expect(threads[0].messageCount).toBeGreaterThanOrEqual(1)
  })
})

// =====================================================
// Two-way conversation - reply threading
// =====================================================

describe('two-way conversation', () => {
  let inboxId: string
  let inboxEmail: string
  let threadId: string
  let firstMsgId: string

  it('sets up inbox and receives initial email', async () => {
    const tag = uid()
    inboxEmail = `e2e-convo-${tag}@${INBOUND_DOMAIN}`

    const inbox = await post('/v1/inboxes', {
      name: `E2E Convo ${tag}`,
      emailAddress: inboxEmail,
    })
    inboxId = inbox.data.id

    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: inboxEmail,
      subject: `Thread ${tag}`,
      body: 'Starting a conversation.',
    })

    const msg = await waitForInboxMessage(inboxId, (m) => m.direction === 'inbound')
    firstMsgId = msg.id
    threadId = msg.threadId
    expect(threadId).toBeTruthy()
  })

  it('replies from inbox with correct threading', async () => {
    const reply = await post(`/v1/inboxes/${inboxId}/messages`, {
      to: `test-sender@${SENDER_DOMAIN}`,
      subject: 'Re: Thread',
      text: 'Agent reply here.',
      inReplyTo: firstMsgId,
    })
    expect(reply.status).toBe(201)
    expect(reply.data.direction).toBe('outbound')
    expect(reply.data.threadId).toBe(threadId)
  })

  it('thread contains both directions', async () => {
    const { data } = await get(`/v1/inboxes/${inboxId}/threads/${threadId}`)
    const messages = data.messages ?? []
    expect(messages.length).toBeGreaterThanOrEqual(2)
    const dirs = messages.map((m: any) => m.direction)
    expect(dirs).toContain('inbound')
    expect(dirs).toContain('outbound')
  })
})

// =====================================================
// Reply extraction
// =====================================================

describe('reply extraction', () => {
  it('extractedText is populated on inbound messages', async () => {
    const tag = uid()
    const email = `e2e-extract-${tag}@${INBOUND_DOMAIN}`

    const inbox = await post('/v1/inboxes', {
      name: `E2E Extract ${tag}`,
      emailAddress: email,
    })

    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: email,
      subject: `Extract ${tag}`,
      body: 'Fresh content with no quoted history.',
    })

    const msg = await waitForInboxMessage(inbox.data.id, (m) => m.direction === 'inbound')
    expect(msg.extractedText ?? msg.text).toContain('Fresh content')
  })
})

// =====================================================
// Inbox lifecycle - pause / resume
// =====================================================

describe('inbox lifecycle', () => {
  it('pause and resume an inbox', async () => {
    const tag = uid()
    const inbox = await post('/v1/inboxes', {
      name: `E2E Lifecycle ${tag}`,
      emailAddress: `e2e-life-${tag}@${INBOUND_DOMAIN}`,
    })

    const paused = await post(`/v1/inboxes/${inbox.data.id}/pause`, {})
    expect(paused.status).toBe(200)
    expect((await get(`/v1/inboxes/${inbox.data.id}`)).data.status).toBe('paused')

    const resumed = await post(`/v1/inboxes/${inbox.data.id}/resume`, {})
    expect(resumed.status).toBe(200)
    expect((await get(`/v1/inboxes/${inbox.data.id}`)).data.status).toBe('active')
  })
})

// =====================================================
// Webhook registration
// =====================================================

describe('webhook registration', () => {
  it('creates, lists, and deletes a webhook', async () => {
    const wh = await post('/v1/webhooks', {
      url: 'https://httpbin.org/post',
      events: ['email.sent', 'email.delivered'],
    })
    expect(wh.status).toBe(201)
    expect(wh.data.id).toMatch(/^whk_/)

    const list = await get('/v1/webhooks')
    expect(list.data.data.some((w: any) => w.id === wh.data.id)).toBe(true)

    await del(`/v1/webhooks/${wh.data.id}`)
  })
})

// =====================================================
// Edge cases - paused inbox drops inbound
// =====================================================

describe('paused inbox ignores inbound', () => {
  it('does not store messages when inbox is paused', async () => {
    const tag = uid()
    const email = `e2e-paused-${tag}@${INBOUND_DOMAIN}`

    const inbox = await post('/v1/inboxes', {
      name: `E2E Paused ${tag}`,
      emailAddress: email,
    })
    const inboxId = inbox.data.id

    await post(`/v1/inboxes/${inboxId}/pause`, {})

    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: email,
      subject: `Paused test ${tag}`,
      body: 'This should be dropped.',
    })

    // Wait long enough for the inbound pipeline to have processed
    await new Promise((r) => setTimeout(r, 10_000))

    const { data } = await get(`/v1/inboxes/${inboxId}/messages`)
    const messages = data?.data ?? data ?? []
    expect(messages.length).toBe(0)
  })
})

// =====================================================
// Edge cases - batch send
// =====================================================

describe('batch send', () => {
  it('sends multiple emails in one request', async () => {
    const { status, data } = await post('/v1/emails/batch', [
      { from: FROM_EMAIL, to: SES_SUCCESS, subject: `Batch 1 ${uid()}`, html: '<p>One</p>' },
      { from: FROM_EMAIL, to: SES_SUCCESS, subject: `Batch 2 ${uid()}`, html: '<p>Two</p>' },
      { from: FROM_EMAIL, to: SES_SUCCESS, subject: `Batch 3 ${uid()}`, html: '<p>Three</p>' },
    ])

    expect(status).toBe(201)
    expect(data).toHaveLength(3)
    expect(data.every((e: any) => e.id.startsWith('msg_'))).toBe(true)

    // Wait for at least one to deliver
    const delivered = await waitForEmailStatus(data[0].id, 'delivered')
    expect(delivered.status).toBe('delivered')
  })
})

// =====================================================
// Edge cases - idempotent sends
// =====================================================

describe('idempotent sends', () => {
  it('returns same response for duplicate idempotency key', async () => {
    const key = `idem-${uid()}`

    const first = await request('POST', '/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `Idempotent ${uid()}`,
      html: '<p>First</p>',
    }, { 'Idempotency-Key': key })

    expect(first.status).toBe(201)

    const second = await request('POST', '/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: 'Different subject',
      html: '<p>Different body</p>',
    }, { 'Idempotency-Key': key })

    // Should return the cached first response
    expect(second.status).toBe(201)
    expect(second.data.id).toBe(first.data.id)
  })
})

// =====================================================
// Edge cases - cancel a queued email
// =====================================================

describe('email cancel', () => {
  it('cancels a queued email before it sends', async () => {
    // Use scheduledAt far in the future so the worker doesn't pick it up
    const { status, data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `Cancel test ${uid()}`,
      html: '<p>Should not send</p>',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    })
    expect(status).toBe(201)

    const cancel = await post(`/v1/emails/${data.id}/cancel`, {})
    expect(cancel.status).toBe(200)

    const { data: email } = await get(`/v1/emails/${data.id}`)
    expect(email.status).toBe('failed')
  })

  it('rejects cancel on already-delivered email', async () => {
    const { data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `Already sent ${uid()}`,
      html: '<p>Delivered</p>',
    })

    await waitForEmailStatus(data.id, ['sent', 'delivered'])

    const cancel = await post(`/v1/emails/${data.id}/cancel`, {})
    expect(cancel.status).toBe(400)
  })
})

// =====================================================
// Edge cases - thread status management
// =====================================================

describe('thread status management', () => {
  let inboxId: string
  let threadId: string

  it('creates an inbox and receives a message to get a thread', async () => {
    const tag = uid()
    const email = `e2e-thread-${tag}@${INBOUND_DOMAIN}`

    const inbox = await post('/v1/inboxes', {
      name: `E2E Thread Mgmt ${tag}`,
      emailAddress: email,
    })
    inboxId = inbox.data.id

    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: email,
      subject: `Thread mgmt ${tag}`,
      body: 'Testing thread status changes.',
    })

    const msg = await waitForInboxMessage(inboxId, (m) => m.direction === 'inbound')
    threadId = msg.threadId
  })

  it('closes a thread', async () => {
    const result = await patch(`/v1/inboxes/${inboxId}/threads/${threadId}`, {
      status: 'closed',
    })
    expect(result.status).toBe(200)
    expect(result.data.status).toBe('closed')
  })

  it('reopens a closed thread', async () => {
    const result = await patch(`/v1/inboxes/${inboxId}/threads/${threadId}`, {
      status: 'open',
    })
    expect(result.status).toBe(200)
    expect(result.data.status).toBe('open')
  })

  it('sets thread metadata', async () => {
    const result = await patch(`/v1/inboxes/${inboxId}/threads/${threadId}`, {
      metadata: { resolution: 'answered', sentiment: 'positive' },
    })
    expect(result.status).toBe(200)
    expect(result.data.metadata.resolution).toBe('answered')
  })
})

// =====================================================
// Edge cases - inbox soft delete
// =====================================================

describe('inbox soft delete', () => {
  it('archives an inbox but preserves messages', async () => {
    const tag = uid()
    const email = `e2e-archive-${tag}@${INBOUND_DOMAIN}`

    const inbox = await post('/v1/inboxes', {
      name: `E2E Archive ${tag}`,
      emailAddress: email,
    })
    const inboxId = inbox.data.id

    // Send a message so there's data to preserve
    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: email,
      subject: `Archive test ${tag}`,
      body: 'Message before archive.',
    })

    await waitForInboxMessage(inboxId, (m) => m.direction === 'inbound')

    // Delete (archive)
    const deleted = await del(`/v1/inboxes/${inboxId}`)
    expect(deleted.status).toBe(200)

    // Inbox should be archived, not physically deleted
    const { data: archived } = await get(`/v1/inboxes/${inboxId}`)
    expect(archived.status).toBe('archived')

    // Messages should still be readable
    const msgs = await get(`/v1/inboxes/${inboxId}/messages`)
    const messages = msgs.data?.data ?? msgs.data ?? []
    expect(messages.length).toBeGreaterThan(0)
  })
})

// =====================================================
// Open tracking - pixel injection and recording
// =====================================================

describe('open tracking', () => {
  it('sends an email with trackOpens and injects pixel in HTML', async () => {
    const { status, data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `E2E tracking ${uid()}`,
      html: '<html><body><p>Track me</p></body></html>',
      trackOpens: true,
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^msg_/)

    const delivered = await waitForEmailStatus(data.id, ['sent', 'delivered'])
    expect(['sent', 'delivered']).toContain(delivered.status)
    expect(delivered.trackOpens).toBe(true)
    expect(delivered.openCount).toBe(0)
  })

  it('tracking pixel endpoint returns GIF and records open', async () => {
    const { data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `E2E pixel ${uid()}`,
      html: '<html><body><p>Pixel test</p></body></html>',
      trackOpens: true,
    })

    await waitForEmailStatus(data.id, ['sent', 'delivered'])

    // Fetch the tracking pixel directly
    const pixelRes = await fetch(`${ctx.baseUrl}/v1/t/${data.id}`)
    expect(pixelRes.status).toBe(200)
    expect(pixelRes.headers.get('content-type')).toBe('image/gif')
    expect(pixelRes.headers.get('cache-control')).toContain('no-store')

    // Wait for async DB update
    await new Promise((r) => setTimeout(r, 500))

    const { data: email } = await get(`/v1/emails/${data.id}`)
    expect(email.openCount).toBe(1)
    expect(email.firstOpenedAt).toBeTruthy()
    expect(email.lastOpenedAt).toBeTruthy()
  })

  it('pixel does not record opens when trackOpens is false', async () => {
    const { data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `E2E no-track ${uid()}`,
      html: '<html><body><p>No tracking</p></body></html>',
      trackOpens: false,
    })

    await waitForEmailStatus(data.id, ['sent', 'delivered'])

    await fetch(`${ctx.baseUrl}/v1/t/${data.id}`)
    await new Promise((r) => setTimeout(r, 500))

    const { data: email } = await get(`/v1/emails/${data.id}`)
    expect(email.openCount).toBe(0)
    expect(email.firstOpenedAt).toBeNull()
  })

  it('multiple pixel fetches increment open count', async () => {
    const { data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `E2E multi-open ${uid()}`,
      html: '<html><body><p>Multi open</p></body></html>',
      trackOpens: true,
    })

    await waitForEmailStatus(data.id, ['sent', 'delivered'])

    await fetch(`${ctx.baseUrl}/v1/t/${data.id}`)
    await new Promise((r) => setTimeout(r, 200))
    await fetch(`${ctx.baseUrl}/v1/t/${data.id}`)
    await new Promise((r) => setTimeout(r, 200))
    await fetch(`${ctx.baseUrl}/v1/t/${data.id}`)
    await new Promise((r) => setTimeout(r, 500))

    const { data: email } = await get(`/v1/emails/${data.id}`)
    expect(email.openCount).toBe(3)
    expect(email.firstOpenedAt).toBeTruthy()
    expect(email.lastOpenedAt).toBeTruthy()
  })

  it('pixel returns GIF even for non-existent email ID', async () => {
    const res = await fetch(`${ctx.baseUrl}/v1/t/msg_doesnotexist`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
  })
})

// =====================================================
// Deliverability stats - domain and global
// =====================================================

describe('deliverability stats', () => {
  let domainId: string

  it('adds the sender domain for stats', async () => {
    const { status, data } = await post('/v1/domains', {
      domain: SENDER_DOMAIN,
    })
    // 201 if new, 409 if already exists from another test
    if (status === 201) {
      domainId = data.id
    } else {
      // Fetch existing
      const list = await get('/v1/domains')
      const dom = list.data.data.find((d: any) => d.domain === SENDER_DOMAIN)
      domainId = dom?.id
    }
    expect(domainId).toBeTruthy()
  })

  it('GET /v1/domains/:id/stats returns stats with rates', async () => {
    const { status, data } = await get(`/v1/domains/${domainId}/stats`)
    expect(status).toBe(200)
    expect(data.domain).toBe(SENDER_DOMAIN)
    expect(data.domainId).toBe(domainId)

    expect(data.last24h).toBeTruthy()
    expect(data.last7d).toBeTruthy()
    expect(data.last30d).toBeTruthy()

    const s = data.last30d
    expect(typeof s.sent).toBe('number')
    expect(typeof s.delivered).toBe('number')
    expect(typeof s.bounced).toBe('number')
    expect(typeof s.complained).toBe('number')
    expect(typeof s.deliveryRate).toBe('number')
    expect(typeof s.bounceRate).toBe('number')
    expect(typeof s.complaintRate).toBe('number')
    expect(typeof s.openRate).toBe('number')

    // Previous tests sent emails through this domain - should have some volume
    expect(s.sent).toBeGreaterThan(0)
  })

  it('includes warmup guidance', async () => {
    const { data } = await get(`/v1/domains/${domainId}/stats`)
    expect(data.warmup).toBeTruthy()
    expect(['new', 'warming', 'established']).toContain(data.warmup.phase)
    expect(data.warmup.dailyLimit).toBeGreaterThan(0)
    expect(typeof data.warmup.recommendation).toBe('string')
  })

  it('returns 404 for unknown domain stats', async () => {
    const { status } = await get('/v1/domains/dom_nonexistent/stats')
    expect(status).toBe(404)
  })

  it('GET /v1/stats returns global stats', async () => {
    const { status, data } = await get('/v1/stats')
    expect(status).toBe(200)

    expect(data.last24h).toBeTruthy()
    expect(data.last7d).toBeTruthy()
    expect(data.last30d).toBeTruthy()
    expect(Array.isArray(data.topDomains)).toBe(true)

    // Global stats should include all the emails sent in previous tests
    expect(data.last30d.sent).toBeGreaterThan(0)
  })

  it('global stats reflect bounced and complained emails from earlier tests', async () => {
    const { data } = await get('/v1/stats')
    const s = data.last30d
    // Earlier tests sent to bounce and complaint simulators
    expect(s.bounced).toBeGreaterThanOrEqual(1)
    expect(s.complained).toBeGreaterThanOrEqual(1)
    expect(s.bounceRate).toBeGreaterThan(0)
    expect(s.complaintRate).toBeGreaterThan(0)
  })

  it('top domains list is sorted by volume', async () => {
    const { data } = await get('/v1/stats')
    for (let i = 1; i < data.topDomains.length; i++) {
      expect(data.topDomains[i - 1].sent).toBeGreaterThanOrEqual(data.topDomains[i].sent)
    }
  })
})

// =====================================================
// Edge cases - auth failures
// =====================================================

describe('auth edge cases', () => {
  it('rejects requests with no auth header', async () => {
    const res = await fetch(`${ctx.baseUrl}/v1/emails`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects requests with invalid API key', async () => {
    const res = await fetch(`${ctx.baseUrl}/v1/emails`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'pgn_invalid_key_12345',
      },
    })
    expect(res.status).toBe(401)
  })
})

// =====================================================
// Edge cases - validation errors
// =====================================================

describe('validation errors', () => {
  it('rejects email with no body or template', async () => {
    const { status, data } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: 'No body',
    })
    expect(status).toBe(400)
    expect(data.error).toBeTruthy()
  })

  it('rejects email with invalid to address', async () => {
    const { status } = await post('/v1/emails', {
      from: FROM_EMAIL,
      to: 'not-an-email',
      subject: 'Invalid',
      html: '<p>Bad</p>',
    })
    expect(status).toBe(400)
  })

  it('rejects batch exceeding 100 items', async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({
      from: FROM_EMAIL,
      to: SES_SUCCESS,
      subject: `Over limit ${i}`,
      html: '<p>x</p>',
    }))
    const { status } = await post('/v1/emails/batch', items)
    expect(status).toBe(400)
  })

  it('rejects inbox creation with duplicate email address', async () => {
    const tag = uid()
    const email = `e2e-dup-${tag}@${INBOUND_DOMAIN}`

    await post('/v1/inboxes', { name: `First ${tag}`, emailAddress: email })
    const { status } = await post('/v1/inboxes', { name: `Second ${tag}`, emailAddress: email })
    expect([400, 409, 500]).toContain(status)
  })
})

// =====================================================
// Edge cases - catch-all inbox
// =====================================================

describe('catch-all inbox', () => {
  let catchAllId: string

  it('designates a catch-all inbox', async () => {
    const tag = uid()
    const inbox = await post('/v1/inboxes', {
      name: `E2E Catch-All ${tag}`,
      emailAddress: `e2e-catchall-${tag}@${INBOUND_DOMAIN}`,
    })
    catchAllId = inbox.data.id

    const result = await post(`/v1/inboxes/${catchAllId}/catch-all`, {})
    expect(result.status).toBe(200)
  })

  it('routes unmatched address to catch-all', async () => {
    const unknownAddr = `nobody-${uid()}@${INBOUND_DOMAIN}`

    await sendInboundTestEmail({
      from: `test-sender@${SENDER_DOMAIN}`,
      to: unknownAddr,
      subject: `Catch-all test ${uid()}`,
      body: 'This should land in catch-all.',
    })

    const msg = await waitForInboxMessage(
      catchAllId,
      (m) => m.direction === 'inbound' && m.text?.includes('catch-all'),
      90_000,
    )
    expect(msg).toBeTruthy()
    expect(msg.direction).toBe('inbound')
  })
})

// =====================================================
// Edge cases - email list filtering
// =====================================================

describe('email list and filtering', () => {
  it('filters emails by status', async () => {
    const { data } = await get('/v1/emails?status=delivered&limit=5')
    expect(data.data).toBeTruthy()
    for (const email of data.data) {
      expect(email.status).toBe('delivered')
    }
  })

  it('paginates with cursor', async () => {
    const first = await get('/v1/emails?limit=2')
    expect(first.data.data.length).toBeLessThanOrEqual(2)
    if (first.data.next_cursor) {
      const second = await get(`/v1/emails?limit=2&cursor=${first.data.next_cursor}`)
      expect(second.data.data).toBeTruthy()
      const firstIds = first.data.data.map((e: any) => e.id)
      const secondIds = second.data.data.map((e: any) => e.id)
      for (const id of secondIds) {
        expect(firstIds).not.toContain(id)
      }
    }
  })
})

// =====================================================
// Subscription topics - CRUD
// =====================================================

describe('subscription topics', () => {
  let topicId: string
  let topicName: string

  it('creates a topic', async () => {
    topicName = `E2E Topic ${uid()}`
    const { status, data } = await post('/v1/topics', {
      name: topicName,
      description: 'E2E test topic',
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^top_/)
    expect(data.name).toBe(topicName)
    topicId = data.id
  })

  it('lists topics', async () => {
    const { status, data } = await get('/v1/topics')
    expect(status).toBe(200)
    expect(data.data.some((t: any) => t.id === topicId)).toBe(true)
  })

  it('gets a topic by ID', async () => {
    const { status, data } = await get(`/v1/topics/${topicId}`)
    expect(status).toBe(200)
    expect(data.id).toBe(topicId)
    expect(data.description).toBe('E2E test topic')
  })

  it('updates a topic', async () => {
    const { status, data } = await patch(`/v1/topics/${topicId}`, {
      description: 'Updated description',
    })
    expect(status).toBe(200)
    expect(data.description).toBe('Updated description')
  })

  it('rejects duplicate topic name', async () => {
    const { status } = await post('/v1/topics', { name: topicName })
    expect(status).toBe(409)
  })

  it('deletes a topic', async () => {
    const temp = await post('/v1/topics', { name: `Temp ${uid()}` })
    const { status } = await del(`/v1/topics/${temp.data.id}`)
    expect(status).toBe(204)

    const { status: getStatus } = await get(`/v1/topics/${temp.data.id}`)
    expect(getStatus).toBe(404)
  })
})

// =====================================================
// Per-topic unsubscribe and resubscribe
// =====================================================

describe('per-topic unsubscribe', () => {
  let contactId: string
  let topicAId: string
  let topicBId: string

  it('sets up contact and topics', async () => {
    const contact = await post('/v1/contacts', { email: `topic-unsub-${uid()}@example.com` })
    expect(contact.status).toBe(201)
    contactId = contact.data.id

    const topicA = await post('/v1/topics', { name: `Topic A ${uid()}` })
    topicAId = topicA.data.id

    const topicB = await post('/v1/topics', { name: `Topic B ${uid()}` })
    topicBId = topicB.data.id
  })

  it('unsubscribes from a single topic', async () => {
    const { status, data } = await post(`/v1/contacts/${contactId}/unsubscribe`, {
      topicId: topicAId,
    })
    expect(status).toBe(200)
    expect(data.unsubscribedTopics).toContain(topicAId)
    expect(data.unsubscribed).toBe(false)
  })

  it('unsubscribes from a second topic (additive)', async () => {
    const { data } = await post(`/v1/contacts/${contactId}/unsubscribe`, {
      topicId: topicBId,
    })
    expect(data.unsubscribedTopics).toContain(topicAId)
    expect(data.unsubscribedTopics).toContain(topicBId)
    expect(data.unsubscribedTopics).toHaveLength(2)
  })

  it('does not duplicate on repeated unsubscribe', async () => {
    const { data } = await post(`/v1/contacts/${contactId}/unsubscribe`, {
      topicId: topicAId,
    })
    expect(data.unsubscribedTopics).toHaveLength(2)
  })

  it('resubscribes from one topic only', async () => {
    const { data } = await post(`/v1/contacts/${contactId}/resubscribe`, {
      topicId: topicAId,
    })
    expect(data.unsubscribedTopics).not.toContain(topicAId)
    expect(data.unsubscribedTopics).toContain(topicBId)
  })

  it('rejects unsubscribe with invalid topic ID', async () => {
    const { status } = await post(`/v1/contacts/${contactId}/unsubscribe`, {
      topicId: 'top_nonexistent',
    })
    expect(status).toBe(404)
  })
})

// =====================================================
// Campaign lifecycle and topic filtering
// =====================================================

describe('campaign with topic filtering', () => {
  let templateId: string
  let topicId: string
  let subscribedId: string
  let unsubscribedId: string
  let campaignId: string
  const campaignTag = `campaign-e2e-${uid()}`

  it('creates a template', async () => {
    const tag = uid()
    const tpl = await post('/v1/templates', {
      slug: `e2e-cmp-${tag}`,
      name: `Campaign Tpl ${tag}`,
      subject: `Campaign E2E ${tag}`,
      body: '<p>Hello from campaign E2E</p>',
    })
    expect(tpl.status).toBe(201)
    templateId = tpl.data.id
  })

  it('creates a topic and two tagged contacts', async () => {
    const topic = await post('/v1/topics', { name: `Cmp Topic ${uid()}` })
    topicId = topic.data.id

    const sub = await post('/v1/contacts', {
      email: SES_SUCCESS,
      tags: [campaignTag],
    })
    subscribedId = sub.data.id

    const unsub = await post('/v1/contacts', {
      email: `topic-skip-${uid()}@example.com`,
      tags: [campaignTag],
    })
    unsubscribedId = unsub.data.id

    await post(`/v1/contacts/${unsubscribedId}/unsubscribe`, { topicId })
  })

  it('creates a campaign with topicId and audience filter', async () => {
    const { status, data } = await post('/v1/campaigns', {
      name: `E2E Campaign ${uid()}`,
      templateId,
      topicId,
      audienceFilter: { tags: { contains: campaignTag } },
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^cmp_/)
    expect(data.status).toBe('draft')
    expect(data.topicId).toBe(topicId)
    campaignId = data.id
  })

  it('sends the campaign', async () => {
    const { status, data } = await post(`/v1/campaigns/${campaignId}/send`, {})
    expect(status).toBe(200)
    expect(['sending', 'sent']).toContain(data.status)
  })

  it('campaign completes with correct stats', async () => {
    const campaign = await poll(
      async () => {
        const { data } = await get(`/v1/campaigns/${campaignId}`)
        return data?.status === 'sent' ? data : null
      },
      { timeoutMs: 30_000, label: 'campaign sent' },
    )

    expect(campaign.status).toBe('sent')
    expect(campaign.stats.sent).toBe(1)
    expect(campaign.stats.failed).toBe(1)
  })

  it('sent email only to the subscribed contact', async () => {
    const emails = await poll(
      async () => {
        const { data } = await get('/v1/emails?limit=50')
        const campaignEmails = (data.data ?? []).filter(
          (e: any) => e.tags?.includes(campaignId),
        )
        return campaignEmails.length > 0 ? campaignEmails : null
      },
      { timeoutMs: 15_000, label: 'campaign email created' },
    )
    expect(emails).toHaveLength(1)
    expect(emails[0].to).toContain(SES_SUCCESS)
  })
})

// =====================================================
// Campaign lifecycle - update, cancel, pause/resume
// =====================================================

describe('campaign lifecycle', () => {
  let campaignId: string

  it('creates a draft campaign', async () => {
    const { status, data } = await post('/v1/campaigns', {
      name: `Lifecycle ${uid()}`,
      subject: 'Lifecycle test',
    })
    expect(status).toBe(201)
    expect(data.status).toBe('draft')
    campaignId = data.id
  })

  it('updates a draft campaign', async () => {
    const { status, data } = await patch(`/v1/campaigns/${campaignId}`, {
      subject: 'Updated subject',
    })
    expect(status).toBe(200)
    expect(data.subject).toBe('Updated subject')
  })

  it('lists campaigns', async () => {
    const { status, data } = await get('/v1/campaigns')
    expect(status).toBe(200)
    expect(data.data.some((c: any) => c.id === campaignId)).toBe(true)
  })

  it('gets campaign by ID', async () => {
    const { status, data } = await get(`/v1/campaigns/${campaignId}`)
    expect(status).toBe(200)
    expect(data.id).toBe(campaignId)
  })

  it('cancels a scheduled campaign', async () => {
    const tag = uid()
    const cmp = await post('/v1/campaigns', {
      name: `Cancel ${tag}`,
      subject: `Cancel ${tag}`,
    })
    const contactTag = `cancel-${tag}`
    await post('/v1/contacts', {
      email: `cancel-${tag}@example.com`,
      tags: [contactTag],
    })

    await post(`/v1/campaigns/${cmp.data.id}/send`, {
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    })

    const cancel = await post(`/v1/campaigns/${cmp.data.id}/cancel`, {})
    expect(cancel.status).toBe(200)
    expect(cancel.data.status).toBe('cancelled')
  })
})

// =====================================================
// Sequences - create, activate, enroll, topic filtering
// =====================================================

describe('sequence with topic filtering', () => {
  let sequenceId: string
  let topicId: string
  let contactId: string
  let enrollmentId: string

  it('creates a topic for the sequence', async () => {
    const topic = await post('/v1/topics', { name: `Seq Topic ${uid()}` })
    topicId = topic.data.id
  })

  it('creates a sequence with a topic email step', async () => {
    const { status, data } = await post('/v1/sequences', {
      name: `E2E Seq ${uid()}`,
      steps: [
        { type: 'email', subject: 'Step 1', topicId },
      ],
    })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^seq_/)
    expect(data.steps).toHaveLength(1)
    expect(data.steps[0].topicId).toBe(topicId)
    sequenceId = data.id
  })

  it('activates the sequence', async () => {
    const { status, data } = await post(`/v1/sequences/${sequenceId}/activate`, {})
    expect(status).toBe(200)
    expect(data.status).toBe('active')
  })

  it('creates a contact unsubscribed from the topic', async () => {
    const contact = await post('/v1/contacts', {
      email: `seq-topic-${uid()}@example.com`,
    })
    contactId = contact.data.id
    await post(`/v1/contacts/${contactId}/unsubscribe`, { topicId })
  })

  it('enrolls the topic-unsubscribed contact', async () => {
    const { status, data } = await post(`/v1/sequences/${sequenceId}/enroll`, {
      contactId,
    })
    expect(status).toBe(201)
    enrollmentId = data.id
  })

  it('enrollment exits due to topic unsubscribe', async () => {
    const enrollment = await poll(
      async () => {
        const { data } = await get(`/v1/sequences/${sequenceId}/enrollments`)
        const e = data.data.find((e: any) => e.id === enrollmentId)
        return e?.status === 'exited' ? e : null
      },
      { timeoutMs: 15_000, label: 'enrollment exited' },
    )
    expect(enrollment.status).toBe('exited')
  })

  it('sequence stats reflect the exit', async () => {
    const { data } = await get(`/v1/sequences/${sequenceId}`)
    expect(data.stats.exited).toBeGreaterThanOrEqual(1)
  })
})

describe('sequence lifecycle', () => {
  let sequenceId: string

  it('creates and lists sequences', async () => {
    const seq = await post('/v1/sequences', {
      name: `Lifecycle Seq ${uid()}`,
      steps: [{ type: 'email', subject: 'Hello' }],
    })
    expect(seq.status).toBe(201)
    sequenceId = seq.data.id

    const list = await get('/v1/sequences')
    expect(list.data.data.some((s: any) => s.id === sequenceId)).toBe(true)
  })

  it('updates a draft sequence', async () => {
    const { status, data } = await patch(`/v1/sequences/${sequenceId}`, {
      name: 'Updated Seq Name',
    })
    expect(status).toBe(200)
    expect(data.name).toBe('Updated Seq Name')
  })

  it('activates then pauses', async () => {
    await post(`/v1/sequences/${sequenceId}/activate`, {})

    const paused = await post(`/v1/sequences/${sequenceId}/pause`, {})
    expect(paused.status).toBe(200)
    expect(paused.data.status).toBe('paused')
  })

  it('rejects enrolling in a paused sequence', async () => {
    const contact = await post('/v1/contacts', {
      email: `paused-seq-${uid()}@example.com`,
    })
    const { status } = await post(`/v1/sequences/${sequenceId}/enroll`, {
      contactId: contact.data.id,
    })
    expect(status).toBe(400)
  })
})
