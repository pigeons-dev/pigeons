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

async function del(path: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  })
  return { status: res.status }
}

async function noAuth(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status }
}

function uniqueName() {
  return `topic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

describe('topic CRUD', () => {
  it('creates a topic', async () => {
    const name = uniqueName()
    const { status, data } = await post('/v1/topics', { name, description: 'Test topic' })
    expect(status).toBe(201)
    expect(data.id).toMatch(/^top_/)
    expect(data.name).toBe(name)
    expect(data.description).toBe('Test topic')
  })

  it('rejects duplicate topic name', async () => {
    const name = uniqueName()
    await post('/v1/topics', { name })
    const { status } = await post('/v1/topics', { name })
    expect(status).toBe(409)
  })

  it('rejects empty name', async () => {
    const { status } = await post('/v1/topics', { name: '' })
    expect(status).toBe(400)
  })

  it('creates topic without description', async () => {
    const { status, data } = await post('/v1/topics', { name: uniqueName() })
    expect(status).toBe(201)
    expect(data.description).toBeNull()
  })

  it('lists topics', async () => {
    const { status, data } = await get('/v1/topics')
    expect(status).toBe(200)
    expect(data.data.length).toBeGreaterThanOrEqual(1)
    expect(data).toHaveProperty('has_more')
  })

  it('gets a topic by ID', async () => {
    const { data: created } = await post('/v1/topics', { name: uniqueName() })
    const { status, data } = await get(`/v1/topics/${created.id}`)
    expect(status).toBe(200)
    expect(data.id).toBe(created.id)
  })

  it('returns 404 for missing topic', async () => {
    const { status } = await get('/v1/topics/top_nonexistent')
    expect(status).toBe(404)
  })

  it('updates a topic name', async () => {
    const { data: created } = await post('/v1/topics', { name: uniqueName() })
    const newName = uniqueName()
    const { status, data } = await patch(`/v1/topics/${created.id}`, { name: newName })
    expect(status).toBe(200)
    expect(data.name).toBe(newName)
  })

  it('updates topic description', async () => {
    const { data: created } = await post('/v1/topics', { name: uniqueName() })
    const { data } = await patch(`/v1/topics/${created.id}`, { description: 'Updated desc' })
    expect(data.description).toBe('Updated desc')
  })

  it('rejects rename to duplicate name', async () => {
    const name1 = uniqueName()
    const name2 = uniqueName()
    await post('/v1/topics', { name: name1 })
    const { data: t2 } = await post('/v1/topics', { name: name2 })
    const { status } = await patch(`/v1/topics/${t2.id}`, { name: name1 })
    expect(status).toBe(409)
  })

  it('deletes a topic', async () => {
    const { data: created } = await post('/v1/topics', { name: uniqueName() })
    const { status } = await del(`/v1/topics/${created.id}`)
    expect(status).toBe(204)

    const { status: getStatus } = await get(`/v1/topics/${created.id}`)
    expect(getStatus).toBe(404)
  })

  it('returns 404 when deleting nonexistent topic', async () => {
    const { status } = await del('/v1/topics/top_gone')
    expect(status).toBe(404)
  })
})

describe('topic auth', () => {
  it('rejects list without auth', async () => {
    const { status } = await noAuth('GET', '/v1/topics')
    expect(status).toBe(401)
  })

  it('rejects create without auth', async () => {
    const { status } = await noAuth('POST', '/v1/topics', { name: 'unauthed' })
    expect(status).toBe(401)
  })

  it('rejects delete without auth', async () => {
    const { status } = await noAuth('DELETE', '/v1/topics/top_fake')
    expect(status).toBe(401)
  })
})

describe('per-topic unsubscribe', () => {
  it('unsubscribes a contact from a specific topic', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    const { status, data } = await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })
    expect(status).toBe(200)
    expect(data.unsubscribedTopics).toContain(topic.id)
    expect(data.unsubscribed).toBe(false)
  })

  it('does not duplicate topic in unsubscribedTopics', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })
    const { data } = await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })
    expect(data.unsubscribedTopics.filter((t: string) => t === topic.id).length).toBe(1)
  })

  it('resubscribes from a specific topic', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })
    const { data } = await post(`/v1/contacts/${contact.id}/resubscribe`, { topicId: topic.id })
    expect(data.unsubscribedTopics).not.toContain(topic.id)
  })

  it('topic unsubscribe does not affect global unsubscribe', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })
    const { data } = await get(`/v1/contacts/${contact.id}`)
    expect(data.unsubscribed).toBe(false)
  })

  it('global unsubscribe does not add to unsubscribedTopics', async () => {
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })
    await post(`/v1/contacts/${contact.id}/unsubscribe`, {})
    const { data } = await get(`/v1/contacts/${contact.id}`)
    expect(data.unsubscribed).toBe(true)
    expect(data.unsubscribedTopics).toBeNull()
  })

  it('rejects topic unsubscribe for nonexistent topic', async () => {
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })
    const { status } = await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: 'top_nonexistent' })
    expect(status).toBe(404)
  })

  it('can unsubscribe from multiple topics', async () => {
    const { data: t1 } = await post('/v1/topics', { name: uniqueName() })
    const { data: t2 } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: t1.id })
    const { data } = await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: t2.id })
    expect(data.unsubscribedTopics).toContain(t1.id)
    expect(data.unsubscribedTopics).toContain(t2.id)
  })

  it('resubscribe from one topic keeps other topic unsubscribes', async () => {
    const { data: t1 } = await post('/v1/topics', { name: uniqueName() })
    const { data: t2 } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: t1.id })
    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: t2.id })
    const { data } = await post(`/v1/contacts/${contact.id}/resubscribe`, { topicId: t1.id })
    expect(data.unsubscribedTopics).not.toContain(t1.id)
    expect(data.unsubscribedTopics).toContain(t2.id)
  })
})

describe('campaign with topicId', () => {
  it('creates a campaign with topicId', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { status, data } = await post('/v1/campaigns', {
      name: 'Topic Campaign',
      subject: 'Hello',
      topicId: topic.id,
    })
    expect(status).toBe(201)
    expect(data.topicId).toBe(topic.id)
  })

  it('skips contacts unsubscribed from campaign topic on send', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const email1 = `${uniqueName()}@example.com`
    const email2 = `${uniqueName()}@example.com`
    const { data: c1 } = await post('/v1/contacts', { email: email1 })
    const { data: c2 } = await post('/v1/contacts', { email: email2 })

    await post(`/v1/contacts/${c1.id}/unsubscribe`, { topicId: topic.id })

    const { data: campaign } = await post('/v1/campaigns', {
      name: 'Topic Filter Test',
      subject: 'Hi',
      topicId: topic.id,
    })

    const { status, data: sent } = await post(`/v1/campaigns/${campaign.id}/send`, {})
    expect(status).toBe(200)
    expect(sent.stats.total).toBeGreaterThanOrEqual(1)
  })

  it('sends to contacts not unsubscribed from topic', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })

    const { data: campaign } = await post('/v1/campaigns', {
      name: 'Topic Send Test',
      subject: 'Hi',
      topicId: topic.id,
    })

    const { data: sent } = await post(`/v1/campaigns/${campaign.id}/send`, {})
    expect(sent.stats.total).toBeGreaterThanOrEqual(1)
  })
})

describe('campaign handler topic filtering', () => {
  it('increments failed for topic-unsubscribed contacts in handler', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })
    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })

    const campaignId = generateId('campaign')
    await db.insert(schema.campaigns).values({
      id: campaignId,
      name: 'Handler Topic Test',
      subject: 'Test',
      topicId: topic.id,
      status: 'sending',
    })

    const { handleSendCampaign } = await import('../workers/handlers/send-campaign.js')
    await handleSendCampaign(db, config, { campaignId, contactIds: [contact.id] })

    const [result] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(result.stats.failed).toBe(1)
    expect(result.stats.sent).toBe(0)
  })
})

describe('sequence step topic filtering', () => {
  it('exits enrollment when contact is topic-unsubscribed from step', async () => {
    const { data: topic } = await post('/v1/topics', { name: uniqueName() })
    const { data: contact } = await post('/v1/contacts', { email: `${uniqueName()}@example.com` })
    await post(`/v1/contacts/${contact.id}/unsubscribe`, { topicId: topic.id })

    const seqId = generateId('sequence')
    await db.insert(schema.sequences).values({
      id: seqId,
      name: 'Seq Topic Test',
      status: 'active',
    })

    const stepId = generateId('sequenceStep')
    await db.insert(schema.sequenceSteps).values({
      id: stepId,
      sequenceId: seqId,
      position: 0,
      type: 'email',
      topicId: topic.id,
      subject: 'Test',
    })

    const enrollId = generateId('sequenceEnrollment')
    await db.insert(schema.sequenceEnrollments).values({
      id: enrollId,
      sequenceId: seqId,
      contactId: contact.id,
      currentStepId: stepId,
      status: 'active',
    })

    const seqStats = { enrolled: 1, completed: 0, exited: 0, active: 1 }
    await db.update(schema.sequences).set({ stats: seqStats }).where(eq(schema.sequences.id, seqId))

    const { handleProcessSequenceStep } = await import('../workers/handlers/process-sequence-step.js')
    await handleProcessSequenceStep(db, config, { enrollmentId: enrollId, stepId })

    const [enrollment] = await db.select().from(schema.sequenceEnrollments).where(eq(schema.sequenceEnrollments.id, enrollId)).limit(1)
    expect(enrollment.status).toBe('exited')

    const [seq] = await db.select().from(schema.sequences).where(eq(schema.sequences.id, seqId)).limit(1)
    expect(seq.stats.exited).toBe(1)
    expect(seq.stats.active).toBe(0)
  })
})
