import { eq, and, desc, lt } from 'drizzle-orm'
import { inboxes, inboxMessages, threads } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js'
import type { DB } from '../db/index.js'

export interface CreateInboxInput {
  name: string
  emailAddress: string
  description?: string
  webhookUrl?: string
  metadata?: Record<string, unknown>
  labels?: string[]
}

export interface UpdateInboxInput {
  name?: string
  description?: string
  webhookUrl?: string | null
  metadata?: Record<string, unknown>
  labels?: string[]
  autoReplyEnabled?: boolean
}

export async function createInbox(db: DB, input: CreateInboxInput) {
  const [existing] = await db
    .select()
    .from(inboxes)
    .where(eq(inboxes.emailAddress, input.emailAddress))
    .limit(1)

  if (existing) throw new ConflictError(`Inbox with address '${input.emailAddress}' already exists`)

  const id = generateId('inbox')
  await db.insert(inboxes).values({
    id,
    name: input.name,
    emailAddress: input.emailAddress,
    description: input.description ?? null,
    webhookUrl: input.webhookUrl ?? null,
    metadata: input.metadata ?? null,
    labels: input.labels ?? null,
  })

  const [created] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  return created!
}

export async function getInbox(db: DB, id: string) {
  const [inbox] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  if (!inbox) throw new NotFoundError('Inbox', id)
  return inbox
}

export async function listInboxes(
  db: DB,
  opts: { limit?: number; cursor?: string; status?: string; label?: string } = {},
) {
  const limit = Math.min(opts.limit ?? 25, 100)
  const conditions = []

  if (opts.cursor) conditions.push(lt(inboxes.createdAt, opts.cursor))
  if (opts.status) conditions.push(eq(inboxes.status, opts.status as 'active' | 'paused' | 'archived'))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  let data = await db
    .select()
    .from(inboxes)
    .where(where)
    .orderBy(desc(inboxes.createdAt))
    .limit(limit + 1)

  if (opts.label) {
    data = data.filter((i) => i.labels?.includes(opts.label!))
  }

  const hasMore = data.length > limit
  if (hasMore) data.pop()

  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore ? data[data.length - 1].createdAt : null,
  }
}

export async function updateInbox(db: DB, id: string, input: UpdateInboxInput) {
  const [existing] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Inbox', id)

  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.description !== undefined) updates.description = input.description
  if (input.webhookUrl !== undefined) updates.webhookUrl = input.webhookUrl
  if (input.metadata !== undefined) updates.metadata = input.metadata
  if (input.labels !== undefined) updates.labels = input.labels
  if (input.autoReplyEnabled !== undefined) updates.autoReplyEnabled = input.autoReplyEnabled

  await db.update(inboxes).set(updates).where(eq(inboxes.id, id))

  const [updated] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  return updated!
}

export async function deleteInbox(db: DB, id: string) {
  const [existing] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Inbox', id)

  await db
    .update(inboxes)
    .set({ status: 'archived' as const })
    .where(eq(inboxes.id, id))

  return { id, deleted: true }
}

export async function pauseInbox(db: DB, id: string) {
  const [existing] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Inbox', id)
  if (existing.status === 'archived') throw new ValidationError('Cannot pause an archived inbox')

  await db
    .update(inboxes)
    .set({ status: 'paused' as const })
    .where(eq(inboxes.id, id))

  const [updated] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  return updated!
}

export async function resumeInbox(db: DB, id: string) {
  const [existing] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Inbox', id)
  if (existing.status !== 'paused') throw new ValidationError('Inbox is not paused')

  await db
    .update(inboxes)
    .set({ status: 'active' as const })
    .where(eq(inboxes.id, id))

  const [updated] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  return updated!
}

export async function setCatchAll(db: DB, id: string) {
  const [existing] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  if (!existing) throw new NotFoundError('Inbox', id)

  await db.update(inboxes).set({ catchAll: false }).where(eq(inboxes.catchAll, true))
  await db.update(inboxes).set({ catchAll: true }).where(eq(inboxes.id, id))

  const [updated] = await db.select().from(inboxes).where(eq(inboxes.id, id)).limit(1)
  return updated!
}

export async function listMessages(
  db: DB,
  inboxId: string,
  opts: { limit?: number; cursor?: string; direction?: string; threadId?: string; label?: string } = {},
) {
  await getInbox(db, inboxId)

  const limit = Math.min(opts.limit ?? 25, 100)
  const conditions = [eq(inboxMessages.inboxId, inboxId)]

  if (opts.cursor) conditions.push(lt(inboxMessages.createdAt, opts.cursor))
  if (opts.direction) conditions.push(eq(inboxMessages.direction, opts.direction as 'inbound' | 'outbound'))
  if (opts.threadId) conditions.push(eq(inboxMessages.threadId, opts.threadId))

  let data = await db
    .select()
    .from(inboxMessages)
    .where(and(...conditions))
    .orderBy(desc(inboxMessages.createdAt))
    .limit(limit + 1)

  if (opts.label) {
    data = data.filter((m) => m.labels?.includes(opts.label!))
  }

  const hasMore = data.length > limit
  if (hasMore) data.pop()

  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore ? data[data.length - 1].createdAt : null,
  }
}

export async function getMessage(db: DB, inboxId: string, messageId: string) {
  await getInbox(db, inboxId)

  const [message] = await db
    .select()
    .from(inboxMessages)
    .where(and(eq(inboxMessages.inboxId, inboxId), eq(inboxMessages.id, messageId)))
    .limit(1)

  if (!message) throw new NotFoundError('Message', messageId)
  return message
}

export async function listThreads(
  db: DB,
  inboxId: string,
  opts: { limit?: number; cursor?: string; status?: string } = {},
) {
  await getInbox(db, inboxId)

  const limit = Math.min(opts.limit ?? 25, 100)
  const conditions = [eq(threads.inboxId, inboxId)]

  if (opts.cursor) conditions.push(lt(threads.lastMessageAt, opts.cursor))
  if (opts.status) conditions.push(eq(threads.status, opts.status as 'open' | 'closed' | 'snoozed'))

  const data = await db
    .select()
    .from(threads)
    .where(and(...conditions))
    .orderBy(desc(threads.lastMessageAt))
    .limit(limit + 1)

  const hasMore = data.length > limit
  if (hasMore) data.pop()

  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore ? data[data.length - 1].lastMessageAt : null,
  }
}

export async function getThread(db: DB, inboxId: string, threadId: string) {
  await getInbox(db, inboxId)

  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.inboxId, inboxId), eq(threads.id, threadId)))
    .limit(1)

  if (!thread) throw new NotFoundError('Thread', threadId)

  const messages = await db
    .select()
    .from(inboxMessages)
    .where(and(eq(inboxMessages.inboxId, inboxId), eq(inboxMessages.threadId, threadId)))
    .orderBy(inboxMessages.createdAt)

  return { ...thread, messages }
}

export async function updateThread(
  db: DB,
  inboxId: string,
  threadId: string,
  input: { status?: string; metadata?: Record<string, unknown> },
) {
  await getInbox(db, inboxId)

  const [existing] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.inboxId, inboxId), eq(threads.id, threadId)))
    .limit(1)

  if (!existing) throw new NotFoundError('Thread', threadId)

  const updates: Record<string, unknown> = {}
  if (input.status !== undefined) updates.status = input.status
  if (input.metadata !== undefined) updates.metadata = input.metadata

  await db.update(threads).set(updates).where(eq(threads.id, threadId))

  const [updated] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1)
  return updated!
}
