import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../utils/url-validation.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}))
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import {
  signPayload,
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  fireWebhooks,
  deliverWebhook,
} from '../services/webhook-service.js'
import type { DB } from '../db/index.js'

let db: DB

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
})

// --- signPayload ---

describe('signPayload', () => {
  it('produces consistent signatures for the same input', () => {
    const payload = '{"event":"email.sent","data":{"id":"msg_123"}}'
    const secret = 'whsec_testsecret123456789'
    const sig1 = signPayload(payload, secret)
    const sig2 = signPayload(payload, secret)
    expect(sig1).toBe(sig2)
  })

  it('produces different signatures for different secrets', () => {
    const payload = '{"event":"email.sent"}'
    const sig1 = signPayload(payload, 'whsec_secret_one_123456')
    const sig2 = signPayload(payload, 'whsec_secret_two_654321')
    expect(sig1).not.toBe(sig2)
  })

  it('produces different signatures for different payloads', () => {
    const secret = 'whsec_same_secret_123456'
    const sig1 = signPayload('{"event":"email.sent"}', secret)
    const sig2 = signPayload('{"event":"email.delivered"}', secret)
    expect(sig1).not.toBe(sig2)
  })

  it('produces a hex string of expected length', () => {
    const sig = signPayload('test', 'secret1234567890')
    // SHA-256 hex = 64 chars
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
  })

  it('handles empty payload', () => {
    const sig = signPayload('', 'secret1234567890')
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
  })

  it('handles unicode payload', () => {
    const sig = signPayload('{"name":"日本語テスト"}', 'secret1234567890')
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
  })
})

// --- Webhook CRUD service layer ---

describe('webhook service CRUD', () => {
  it('createWebhook generates whsec_ secret when not provided', async () => {
    const wh = await createWebhook(db, {
      url: 'https://test.example.com/hook1',
      events: ['email.sent'],
    })
    expect(wh.id).toMatch(/^whk_/)
    expect(wh.secret).toMatch(/^whsec_/)
    expect(wh.url).toBe('https://test.example.com/hook1')
  })

  it('createWebhook uses provided secret', async () => {
    const wh = await createWebhook(db, {
      url: 'https://test.example.com/hook-custom',
      events: ['email.sent'],
      secret: 'my-custom-provided-secret',
    })
    expect(wh.secret).toBe('my-custom-provided-secret')
  })

  it('listWebhooks strips secrets', async () => {
    const result = await listWebhooks(db)
    result.data.forEach((w: any) => {
      expect(w.secret).toBeUndefined()
    })
  })

  it('getWebhook strips secret', async () => {
    const created = await createWebhook(db, {
      url: 'https://test.example.com/get-test',
      events: ['email.delivered'],
    })
    const fetched = await getWebhook(db, created.id)
    expect((fetched as any).secret).toBeUndefined()
    expect(fetched.url).toBe('https://test.example.com/get-test')
  })

  it('getWebhook throws NotFoundError for missing ID', async () => {
    await expect(getWebhook(db, 'whk_nonexistent')).rejects.toThrow()
  })

  it('updateWebhook throws NotFoundError for missing ID', async () => {
    await expect(
      updateWebhook(db, 'whk_nonexistent', { url: 'https://new.example.com' }),
    ).rejects.toThrow()
  })

  it('deleteWebhook throws NotFoundError for missing ID', async () => {
    await expect(deleteWebhook(db, 'whk_nonexistent')).rejects.toThrow()
  })

  it('deleteWebhook removes the record', async () => {
    const wh = await createWebhook(db, {
      url: 'https://test.example.com/delete-me',
      events: ['email.sent'],
    })
    const result = await deleteWebhook(db, wh.id)
    expect(result.deleted).toBe(true)

    await expect(getWebhook(db, wh.id)).rejects.toThrow()
  })

  it('updateWebhook can change status to disabled', async () => {
    const wh = await createWebhook(db, {
      url: 'https://test.example.com/disable-test',
      events: ['email.sent'],
    })
    const updated = await updateWebhook(db, wh.id, { status: 'disabled' })
    expect(updated.status).toBe('disabled')
  })
})

// --- fireWebhooks ---

describe('fireWebhooks', () => {
  it('creates delivery records and jobs for matching webhooks', async () => {
    const wh = await createWebhook(db, {
      url: 'https://fire-test.example.com/hook',
      events: ['email.sent', 'email.delivered'],
    })

    await fireWebhooks(db, 'email.sent', { email_id: 'msg_test1' })

    // Check delivery was created
    const deliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh.id))
    expect(deliveries.length).toBeGreaterThanOrEqual(1)

    const latestDelivery = deliveries[deliveries.length - 1]
    expect(latestDelivery.eventType).toBe('email.sent')
    expect((latestDelivery.payload as any).event).toBe('email.sent')

    // Check job was created
    const jobsForDelivery = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, 'webhook.deliver'))
    expect(jobsForDelivery.length).toBeGreaterThanOrEqual(1)
  })

  it('does not fire for events the webhook is not subscribed to', async () => {
    const wh = await createWebhook(db, {
      url: 'https://no-match.example.com/hook',
      events: ['email.bounced'],
    })

    const beforeDeliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh.id))

    await fireWebhooks(db, 'email.sent', { email_id: 'msg_no_match' })

    const afterDeliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh.id))

    expect(afterDeliveries.length).toBe(beforeDeliveries.length)
  })

  it('does not fire for disabled webhooks', async () => {
    const wh = await createWebhook(db, {
      url: 'https://disabled-fire.example.com/hook',
      events: ['email.sent'],
    })
    await updateWebhook(db, wh.id, { status: 'disabled' })

    const beforeDeliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh.id))

    await fireWebhooks(db, 'email.sent', { email_id: 'msg_disabled' })

    const afterDeliveries = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh.id))

    expect(afterDeliveries.length).toBe(beforeDeliveries.length)
  })

  it('fires to multiple webhooks subscribed to the same event', async () => {
    const wh1 = await createWebhook(db, {
      url: 'https://multi1.example.com/hook',
      events: ['contact.created'],
    })
    const wh2 = await createWebhook(db, {
      url: 'https://multi2.example.com/hook',
      events: ['contact.created'],
    })

    await fireWebhooks(db, 'contact.created', { contact_id: 'ctc_multi' })

    const d1 = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh1.id))
    const d2 = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.webhookId, wh2.id))

    expect(d1.length).toBeGreaterThanOrEqual(1)
    expect(d2.length).toBeGreaterThanOrEqual(1)
  })

  it('handles no matching webhooks gracefully', async () => {
    await expect(
      fireWebhooks(db, 'totally.unknown.event', { data: true }),
    ).resolves.toBeUndefined()
  })
})

// --- deliverWebhook edge cases ---

describe('deliverWebhook edge cases', () => {
  it('skips delivery when delivery record does not exist', async () => {
    await expect(deliverWebhook(db, 'wdl_nonexistent')).resolves.toBeUndefined()
  })

  it('skips delivery when webhook is disabled', async () => {
    const wh = await createWebhook(db, {
      url: 'https://deliver-disabled.example.com/hook',
      events: ['email.sent'],
    })
    await updateWebhook(db, wh.id, { status: 'disabled' })

    const deliveryId = generateId('webhookDelivery')
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: wh.id,
      eventType: 'email.sent',
      payload: { event: 'email.sent', data: {} },
    })

    await expect(deliverWebhook(db, deliveryId)).resolves.toBeUndefined()

    const [delivery] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, deliveryId))
    // Should not have been attempted (attempts stays 0)
    expect(delivery.attempts).toBe(0)
  })

  it('skips delivery when webhook has been deleted', async () => {
    const wh = await createWebhook(db, {
      url: 'https://deliver-deleted.example.com/hook',
      events: ['email.sent'],
    })

    const deliveryId = generateId('webhookDelivery')
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: wh.id,
      eventType: 'email.sent',
      payload: { event: 'email.sent', data: {} },
    })

    await deleteWebhook(db, wh.id)
    await expect(deliverWebhook(db, deliveryId)).resolves.toBeUndefined()
  })

  it('records failure and increments failure count on network error', async () => {
    const wh = await createWebhook(db, {
      url: 'https://this-will-not-resolve.invalid/hook',
      events: ['email.sent'],
    })

    const deliveryId = generateId('webhookDelivery')
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: wh.id,
      eventType: 'email.sent',
      payload: { event: 'email.sent', data: { test: true } },
    })

    await deliverWebhook(db, deliveryId)

    const [delivery] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, deliveryId))
    expect(delivery.attempts).toBe(1)
    expect(delivery.responseBody).toBeTruthy()

    const [webhook] = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, wh.id))
    expect(webhook.failureCount).toBe(1)
  })

  it('schedules retry job on first failure', async () => {
    const wh = await createWebhook(db, {
      url: 'https://retry-test.invalid/hook',
      events: ['email.sent'],
    })

    const deliveryId = generateId('webhookDelivery')
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: wh.id,
      eventType: 'email.sent',
      payload: { event: 'email.sent', data: {} },
    })

    await deliverWebhook(db, deliveryId)

    const [delivery] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.id, deliveryId))
    expect(delivery.nextRetryAt).toBeTruthy()

    // Verify a retry job was enqueued
    const retryJobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, 'webhook.deliver'))
    const matchingJob = retryJobs.find(
      (j) => (j.payload as any).deliveryId === deliveryId,
    )
    expect(matchingJob).toBeTruthy()
    expect(matchingJob!.runAt > new Date().toISOString() || matchingJob!.status === 'pending').toBe(true)
  })

  it('auto-disables webhook after 10 consecutive failures', async () => {
    const wh = await createWebhook(db, {
      url: 'https://ten-failures.invalid/hook',
      events: ['email.sent'],
    })

    // Manually set failure count to 9
    await db
      .update(schema.webhooks)
      .set({ failureCount: 9 })
      .where(eq(schema.webhooks.id, wh.id))

    const deliveryId = generateId('webhookDelivery')
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: wh.id,
      eventType: 'email.sent',
      payload: { event: 'email.sent', data: {} },
    })

    await deliverWebhook(db, deliveryId)

    const [webhook] = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, wh.id))
    expect(webhook.failureCount).toBe(10)
    expect(webhook.status).toBe('disabled')
  })

  it('does not disable webhook before reaching 10 failures', async () => {
    const wh = await createWebhook(db, {
      url: 'https://eight-failures.invalid/hook',
      events: ['email.sent'],
    })

    await db
      .update(schema.webhooks)
      .set({ failureCount: 8 })
      .where(eq(schema.webhooks.id, wh.id))

    const deliveryId = generateId('webhookDelivery')
    await db.insert(schema.webhookDeliveries).values({
      id: deliveryId,
      webhookId: wh.id,
      eventType: 'email.sent',
      payload: { event: 'email.sent', data: {} },
    })

    await deliverWebhook(db, deliveryId)

    const [webhook] = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, wh.id))
    expect(webhook.failureCount).toBe(9)
    expect(webhook.status).toBe('active')
  })
})

// --- Job queue handler ---

describe('webhook job handler', () => {
  it('handleWebhookDeliver requires deliveryId in payload', async () => {
    const { handleWebhookDeliver } = await import('../workers/handlers/webhook-deliver.js')
    await expect(
      handleWebhookDeliver(db, {} as any, {}),
    ).rejects.toThrow('Missing deliveryId')
  })
})
