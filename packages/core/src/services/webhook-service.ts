import { createHmac, randomBytes } from 'node:crypto'
import { eq, and, desc, lt } from 'drizzle-orm'
import { webhooks, webhookDeliveries, jobs } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError } from '../utils/errors.js'
import { validateWebhookUrl } from '../utils/url-validation.js'
import type { DB } from '../db/index.js'

const VALID_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.bounced',
  'email.complained',
  'email.failed',
  'inbox.message.received',
  'inbox.message.sent',
  'contact.created',
  'contact.updated',
  'contact.unsubscribed',
  'campaign.sent',
  'campaign.completed',
  'sequence.step.sent',
] as const

export interface CreateWebhookInput {
  url: string
  events: string[]
  secret?: string
}

export interface UpdateWebhookInput {
  url?: string
  events?: string[]
  status?: 'active' | 'disabled'
}

export async function createWebhook(db: DB, input: CreateWebhookInput) {
  const id = generateId('webhook')
  const secret = input.secret ?? `whsec_${randomBytes(24).toString('hex')}`

  await db.insert(webhooks).values({
    id,
    url: input.url,
    events: input.events,
    secret,
  })

  const [created] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  return { ...created!, secret }
}

export async function listWebhooks(
  db: DB,
  opts: { limit?: number; cursor?: string } = {},
) {
  const limit = Math.min(opts.limit ?? 25, 100)
  const conditions = []
  if (opts.cursor) conditions.push(lt(webhooks.createdAt, opts.cursor))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const data = await db
    .select()
    .from(webhooks)
    .where(where)
    .orderBy(desc(webhooks.createdAt))
    .limit(limit + 1)

  const hasMore = data.length > limit
  if (hasMore) data.pop()

  // Strip secrets from list response
  const sanitized = data.map(({ secret, ...rest }) => rest)

  return {
    data: sanitized,
    has_more: hasMore,
    next_cursor: hasMore ? data[data.length - 1].createdAt : null,
  }
}

export async function getWebhook(db: DB, id: string) {
  const [webhook] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  if (!webhook) throw new NotFoundError('Webhook', id)
  const { secret, ...rest } = webhook
  return rest
}

export async function updateWebhook(db: DB, id: string, input: UpdateWebhookInput) {
  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Webhook', id)

  const updates: Record<string, unknown> = {}
  if (input.url !== undefined) updates.url = input.url
  if (input.events !== undefined) updates.events = input.events
  if (input.status !== undefined) updates.status = input.status

  await db.update(webhooks).set(updates).where(eq(webhooks.id, id))

  const [updated] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  const { secret, ...rest } = updated!
  return rest
}

export async function deleteWebhook(db: DB, id: string) {
  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Webhook', id)

  await db.delete(webhooks).where(eq(webhooks.id, id))
  return { id, deleted: true }
}

export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export async function fireWebhooks(
  db: DB,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const matchingWebhooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.status, 'active'))

  const matching = matchingWebhooks.filter((w) => w.events.includes(eventType))

  for (const webhook of matching) {
    const deliveryId = generateId('webhookDelivery')
    await db.insert(webhookDeliveries).values({
      id: deliveryId,
      webhookId: webhook.id,
      eventType,
      payload: { event: eventType, data: payload },
    })

    // Enqueue delivery job
    await db.insert(jobs).values({
      id: generateId('job'),
      type: 'webhook.deliver',
      payload: { deliveryId, webhookId: webhook.id },
      status: 'pending',
    })
  }
}

export async function deliverWebhook(db: DB, deliveryId: string) {
  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)

  if (!delivery) return

  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId))
    .limit(1)

  if (!webhook || webhook.status !== 'active') return

  // Validate URL before each delivery to prevent DNS rebinding attacks
  try {
    await validateWebhookUrl(webhook.url)
  } catch {
    await db
      .update(webhookDeliveries)
      .set({
        responseBody: 'Webhook URL failed SSRF validation',
        attempts: delivery.attempts + 1,
      })
      .where(eq(webhookDeliveries.id, deliveryId))
    await handleDeliveryFailure(db, webhook.id, deliveryId, delivery.attempts + 1)
    return
  }

  const body = JSON.stringify(delivery.payload)
  const signature = signPayload(body, webhook.secret)

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pigeons-Signature': signature,
        'X-Pigeons-Event': delivery.eventType,
        'X-Pigeons-Delivery': delivery.id,
      },
      body,
      signal: AbortSignal.timeout(10000),
    })

    await db
      .update(webhookDeliveries)
      .set({
        responseStatus: response.status,
        responseBody: (await response.text()).slice(0, 1000),
        attempts: delivery.attempts + 1,
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    if (response.ok) {
      await db
        .update(webhooks)
        .set({ lastTriggeredAt: new Date().toISOString(), failureCount: 0 })
        .where(eq(webhooks.id, webhook.id))
    } else {
      await handleDeliveryFailure(db, webhook.id, deliveryId, delivery.attempts + 1)
    }
  } catch (err) {
    await db
      .update(webhookDeliveries)
      .set({
        responseBody: err instanceof Error ? err.message : 'Unknown error',
        attempts: delivery.attempts + 1,
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    await handleDeliveryFailure(db, webhook.id, deliveryId, delivery.attempts + 1)
  }
}

async function handleDeliveryFailure(
  db: DB,
  webhookId: string,
  deliveryId: string,
  attempts: number,
) {
  const [webhook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1)
  if (!webhook) return

  const newFailureCount = webhook.failureCount + 1
  await db
    .update(webhooks)
    .set({ failureCount: newFailureCount })
    .where(eq(webhooks.id, webhookId))

  // Retry with exponential backoff: 1m, 5m, 15m (max 3 attempts)
  if (attempts < 3) {
    const delays = [60, 300, 900]
    const delay = delays[attempts - 1] ?? 900
    const nextRetryAt = new Date(Date.now() + delay * 1000).toISOString()

    await db
      .update(webhookDeliveries)
      .set({ nextRetryAt })
      .where(eq(webhookDeliveries.id, deliveryId))

    await db.insert(jobs).values({
      id: generateId('job'),
      type: 'webhook.deliver',
      payload: { deliveryId, webhookId },
      status: 'pending',
      runAt: nextRetryAt,
    })
  }

  // Auto-disable after 10 consecutive failures
  if (newFailureCount >= 10) {
    await db
      .update(webhooks)
      .set({ status: 'disabled' as const })
      .where(eq(webhooks.id, webhookId))
  }
}
