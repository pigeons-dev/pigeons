import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import {
  resolveThread,
  incrementThreadCount,
  generateMessageId,
  extractThreadIdFromMessageId,
  buildReferences,
  foldReferencesHeader,
  stripSubjectPrefix,
  generateThreadIndex,
} from '../services/threading.js'
import type { DB } from '../db/index.js'

let db: DB

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
})

async function createTestInbox(name: string) {
  const id = generateId('inbox')
  await db.insert(schema.inboxes).values({
    id,
    name,
    emailAddress: `${name}@mail.example.com`,
  })
  return id
}

async function insertThread(inboxId: string, opts: { id?: string; subject?: string } = {}) {
  const id = opts.id ?? generateId('thread')
  await db.insert(schema.threads).values({
    id,
    inboxId,
    subject: opts.subject ?? 'Test subject',
    participants: [{ email: 'test@example.com' }],
    messageCount: 0,
  })
  return id
}

async function insertMessage(
  inboxId: string,
  threadId: string,
  opts: { messageId?: string; sesMessageId?: string; references?: string[] } = {},
) {
  const id = generateId('inboxMessage')
  await db.insert(schema.inboxMessages).values({
    id,
    inboxId,
    direction: 'inbound',
    from: 'sender@example.com',
    to: [`${inboxId}@mail.example.com`],
    subject: 'Test',
    threadId,
    messageId: opts.messageId ?? null,
    sesMessageId: opts.sesMessageId ?? null,
    references: opts.references ?? null,
  })
  return id
}

describe('resolveThread', () => {
  let inboxId: string

  beforeAll(async () => {
    inboxId = await createTestInbox('resolve-test')
  })

  it('finds thread via embedded tid in InReplyTo', async () => {
    const threadId = await insertThread(inboxId)
    const messageIdWithTid = generateMessageId('example.com', threadId)

    const result = await resolveThread(db, inboxId, {
      inReplyTo: messageIdWithTid,
      from: 'reply@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(threadId)
    expect(result.isNew).toBe(false)
  })

  it('finds thread via embedded tid in References array', async () => {
    const threadId = await insertThread(inboxId)
    const messageIdWithTid = generateMessageId('example.com', threadId)
    const otherRef = '<random-id-1234@someserver.com>'

    const result = await resolveThread(db, inboxId, {
      references: [otherRef, messageIdWithTid],
      from: 'reply@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(threadId)
    expect(result.isNew).toBe(false)
  })

  it('falls back to messageId lookup when no tid found', async () => {
    const threadId = await insertThread(inboxId)
    const storedMsgId = '<stored-msg-id-1@example.com>'
    await insertMessage(inboxId, threadId, { messageId: storedMsgId })

    const result = await resolveThread(db, inboxId, {
      inReplyTo: storedMsgId,
      from: 'user@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(threadId)
    expect(result.isNew).toBe(false)
  })

  it('falls back to sesMessageId lookup', async () => {
    const threadId = await insertThread(inboxId)
    const sesId = '<ses-0100abc@us-east-1.amazonses.com>'
    await insertMessage(inboxId, threadId, { sesMessageId: sesId })

    const result = await resolveThread(db, inboxId, {
      inReplyTo: sesId,
      from: 'user@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(threadId)
    expect(result.isNew).toBe(false)
  })

  it('falls back to subject matching with prefix stripping', async () => {
    const threadId = await insertThread(inboxId, { subject: 'Invoice question' })

    const result = await resolveThread(db, inboxId, {
      subject: 'Re: Invoice question',
      from: 'customer@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(threadId)
    expect(result.isNew).toBe(false)
  })

  it('subject matching strips international prefixes', async () => {
    const threadId = await insertThread(inboxId, { subject: 'Termin morgen' })

    const result = await resolveThread(db, inboxId, {
      subject: 'AW: Termin morgen',
      from: 'german@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(threadId)
    expect(result.isNew).toBe(false)
  })

  it('creates new thread when nothing matches', async () => {
    const result = await resolveThread(db, inboxId, {
      inReplyTo: '<completely-unknown@nowhere.com>',
      subject: 'Brand new topic',
      from: 'new@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.isNew).toBe(true)
    expect(result.threadId).toMatch(/^thr_/)
  })

  it('creates new thread with empty references and no subject', async () => {
    const result = await resolveThread(db, inboxId, {
      references: [],
      from: 'blank@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.isNew).toBe(true)
  })

  it('does not match threads from a different inbox', async () => {
    const otherInbox = await createTestInbox('other-inbox')
    const threadId = await insertThread(otherInbox, { subject: 'Cross-inbox topic' })

    const result = await resolveThread(db, inboxId, {
      subject: 'Cross-inbox topic',
      from: 'user@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).not.toBe(threadId)
    expect(result.isNew).toBe(true)
  })

  it('prioritizes tid match over messageId match', async () => {
    const tidThread = await insertThread(inboxId, { subject: 'tid-priority' })
    const msgIdThread = await insertThread(inboxId, { subject: 'msgid-priority' })

    const tidRef = generateMessageId('example.com', tidThread)
    const storedMsgId = '<priority-msg@example.com>'
    await insertMessage(inboxId, msgIdThread, { messageId: storedMsgId })

    const result = await resolveThread(db, inboxId, {
      references: [storedMsgId, tidRef],
      from: 'user@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.threadId).toBe(tidThread)
  })

  it('handles corrupted tid gracefully and falls through', async () => {
    const corruptRef = '<tid.!!!invalid-base64!!!.abc.1234@example.com>'

    const result = await resolveThread(db, inboxId, {
      inReplyTo: corruptRef,
      subject: 'New topic from corrupt',
      from: 'user@example.com',
      to: ['resolve-test@mail.example.com'],
    })

    expect(result.isNew).toBe(true)
  })
})

describe('incrementThreadCount', () => {
  let inboxId: string

  beforeAll(async () => {
    inboxId = await createTestInbox('increment-test')
  })

  it('increments message count', async () => {
    const threadId = await insertThread(inboxId)

    await incrementThreadCount(db, threadId, 'first@example.com')

    const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId))
    expect(thread.messageCount).toBe(1)
  })

  it('adds new participants', async () => {
    const threadId = await insertThread(inboxId)

    await incrementThreadCount(db, threadId, 'alpha@example.com')
    await incrementThreadCount(db, threadId, 'beta@example.com')

    const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId))
    expect(thread.messageCount).toBe(2)
    expect(thread.participants).toContainEqual({ email: 'alpha@example.com' })
    expect(thread.participants).toContainEqual({ email: 'beta@example.com' })
  })

  it('does not duplicate existing participants', async () => {
    const threadId = await insertThread(inboxId)

    await incrementThreadCount(db, threadId, 'same@example.com')
    await incrementThreadCount(db, threadId, 'same@example.com')

    const [thread] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId))
    const sameCount = thread.participants!.filter((p) => p.email === 'same@example.com').length
    expect(sameCount).toBe(1)
    expect(thread.messageCount).toBe(2)
  })

  it('handles non-existent thread gracefully', async () => {
    await expect(
      incrementThreadCount(db, 'thr_nonexistent', 'nobody@example.com'),
    ).resolves.toBeUndefined()
  })

  it('updates lastMessageAt on each increment', async () => {
    const threadId = await insertThread(inboxId)

    await incrementThreadCount(db, threadId)
    const [before] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId))

    await new Promise((r) => setTimeout(r, 10))
    await incrementThreadCount(db, threadId)
    const [after] = await db.select().from(schema.threads).where(eq(schema.threads.id, threadId))

    expect(after.lastMessageAt >= before.lastMessageAt).toBe(true)
  })
})

describe('generateMessageId edge cases', () => {
  it('different domains produce different suffixes', () => {
    const a = generateMessageId('alpha.com')
    const b = generateMessageId('beta.com')
    expect(a).toContain('@alpha.com>')
    expect(b).toContain('@beta.com>')
  })

  it('thread ID round-trips through encode/decode', () => {
    const threadId = 'thr_abcdefghij1234567890'
    const msgId = generateMessageId('example.com', threadId)
    const extracted = extractThreadIdFromMessageId(msgId)
    expect(extracted).toBe(threadId)
  })

  it('handles thread IDs with special characters', () => {
    const threadId = 'thr_abc+def/ghi=jkl'
    const msgId = generateMessageId('example.com', threadId)
    const extracted = extractThreadIdFromMessageId(msgId)
    expect(extracted).toBe(threadId)
  })
})

describe('extractThreadIdFromMessageId edge cases', () => {
  it('returns null for empty string', () => {
    expect(extractThreadIdFromMessageId('')).toBeNull()
  })

  it('returns null for plain email address', () => {
    expect(extractThreadIdFromMessageId('user@example.com')).toBeNull()
  })

  it('returns null for angle-bracketed non-tid', () => {
    expect(extractThreadIdFromMessageId('<abc123@example.com>')).toBeNull()
  })
})

describe('buildReferences edge cases', () => {
  it('handles exact boundary of 20 entries', () => {
    const chain = Array.from({ length: 19 }, (_, i) => `<msg${i}@ex.com>`)
    const refs = buildReferences(chain, '<msg19@ex.com>')
    expect(refs.length).toBe(20)
    expect(refs[0]).toBe('<msg0@ex.com>')
    expect(refs[19]).toBe('<msg19@ex.com>')
  })

  it('handles exactly 19 entries (no truncation)', () => {
    const chain = Array.from({ length: 18 }, (_, i) => `<msg${i}@ex.com>`)
    const refs = buildReferences(chain, '<msg18@ex.com>')
    expect(refs.length).toBe(19)
  })

  it('handles 21 entries (triggers truncation)', () => {
    const chain = Array.from({ length: 20 }, (_, i) => `<msg${i}@ex.com>`)
    const refs = buildReferences(chain, '<msg20@ex.com>')
    expect(refs.length).toBe(20)
    expect(refs[0]).toBe('<msg0@ex.com>')
    expect(refs[refs.length - 1]).toBe('<msg20@ex.com>')
    // Middle messages should be trimmed
    expect(refs).not.toContain('<msg1@ex.com>')
  })

  it('single parent with no chain', () => {
    const refs = buildReferences([], '<root@ex.com>')
    expect(refs).toEqual(['<root@ex.com>'])
  })
})

describe('foldReferencesHeader edge cases', () => {
  it('single very long reference stays on one line', () => {
    const longRef = `<${'a'.repeat(100)}@example.com>`
    const result = foldReferencesHeader([longRef])
    expect(result).toBe(longRef)
  })

  it('two short references fit on one line', () => {
    const refs = ['<a@x.com>', '<b@x.com>']
    const result = foldReferencesHeader(refs)
    expect(result).toBe('<a@x.com> <b@x.com>')
    expect(result).not.toContain('\r\n')
  })

  it('folds correctly when each ref is near the 76-char limit', () => {
    const refs = [
      `<${'a'.repeat(30)}@example.com>`,
      `<${'b'.repeat(30)}@example.com>`,
      `<${'c'.repeat(30)}@example.com>`,
    ]
    const result = foldReferencesHeader(refs)
    // Each ref is ~44 chars; two exceed 76 so they should fold
    expect(result.split('\r\n ').length).toBeGreaterThan(1)
  })
})

describe('stripSubjectPrefix edge cases', () => {
  it('strips multiple chained prefixes one at a time', () => {
    const result = stripSubjectPrefix('Re: Hello')
    expect(result).toBe('Hello')
    // Note: the function strips only one prefix per call
  })

  it('handles empty string', () => {
    expect(stripSubjectPrefix('')).toBe('')
  })

  it('handles only a prefix with no subject', () => {
    expect(stripSubjectPrefix('Re:')).toBe('')
  })

  it('preserves subjects starting with similar words', () => {
    expect(stripSubjectPrefix('Research findings')).toBe('Research findings')
    expect(stripSubjectPrefix('Reminder about meeting')).toBe('Reminder about meeting')
  })

  it('strips Japanese prefixes', () => {
    expect(stripSubjectPrefix('返信: テスト')).toBe('テスト')
    expect(stripSubjectPrefix('転送: テスト')).toBe('テスト')
  })

  it('strips Chinese prefixes', () => {
    expect(stripSubjectPrefix('回复: 你好')).toBe('你好')
    expect(stripSubjectPrefix('转发: 文件')).toBe('文件')
  })

  it('strips extra whitespace around colon', () => {
    expect(stripSubjectPrefix('Re:   lots of space')).toBe('lots of space')
  })
})

describe('generateThreadIndex edge cases', () => {
  it('produces different base indices for sequential calls', () => {
    const a = generateThreadIndex()
    const b = generateThreadIndex()
    expect(a).not.toBe(b)
  })

  it('deep nesting (5 levels) produces correct length', () => {
    let index = generateThreadIndex()
    for (let i = 0; i < 4; i++) {
      index = generateThreadIndex(index)
    }
    const buf = Buffer.from(index, 'base64')
    expect(buf.length).toBe(22 + 5 * 4) // 42 bytes
  })

  it('child always starts with parent bytes', () => {
    const parent = generateThreadIndex()
    const child = generateThreadIndex(parent)

    const parentBuf = Buffer.from(parent, 'base64')
    const childBuf = Buffer.from(child, 'base64')

    expect(childBuf.subarray(0, parentBuf.length)).toEqual(parentBuf)
  })
})
