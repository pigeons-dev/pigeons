import { randomBytes } from 'node:crypto'
import { eq, or, and, inArray } from 'drizzle-orm'
import { inboxMessages, threads } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import type { DB } from '../db/index.js'

const MAX_REFERENCES = 20

export function generateMessageId(domain: string, threadId?: string): string {
  const random = randomBytes(8).toString('hex')
  const ts = Date.now().toString(36)
  if (threadId) {
    const encoded = Buffer.from(threadId).toString('base64url')
    return `<tid.${encoded}.${ts}.${random}@${domain}>`
  }
  return `<${ts}.${random}@${domain}>`
}

export function buildReferences(parentReferences: string[], parentMessageId: string): string[] {
  const chain = [...parentReferences, parentMessageId]
  if (chain.length <= MAX_REFERENCES) return chain
  return [chain[0], ...chain.slice(-(MAX_REFERENCES - 1))]
}

export function foldReferencesHeader(references: string[]): string {
  if (references.length === 0) return ''
  const lines: string[] = []
  let current = references[0]
  for (let i = 1; i < references.length; i++) {
    if (current.length + 1 + references[i].length > 76) {
      lines.push(current)
      current = references[i]
    } else {
      current += ' ' + references[i]
    }
  }
  lines.push(current)
  return lines.join('\r\n ')
}

// Thread-Index: 22-byte base (6 bytes timestamp + 16 bytes GUID), base64-encoded
// Child messages append 5-byte blocks for each reply level
export function generateThreadIndex(parentThreadIndex?: string): string {
  if (!parentThreadIndex) {
    const buf = Buffer.alloc(22)
    const now = Date.now()
    // FILETIME: 100-nanosecond intervals since 1601-01-01
    const filetime = BigInt(now + 11644473600000) * 10000n
    buf.writeBigUInt64BE(filetime >> 16n, 0)
    randomBytes(16).copy(buf, 6)
    return buf.toString('base64')
  }
  const parent = Buffer.from(parentThreadIndex, 'base64')
  const child = Buffer.alloc(parent.length + 5)
  parent.copy(child)
  const now = Date.now()
  const filetime = BigInt(now + 11644473600000) * 10000n
  const timeBytes = Buffer.alloc(8)
  timeBytes.writeBigUInt64BE(filetime)
  // 5-byte child block: top 4 bytes of FILETIME delta + 1 random byte
  timeBytes.copy(child, parent.length, 0, 4)
  child[parent.length + 4] = randomBytes(1)[0]
  return child.toString('base64')
}

export function stripSubjectPrefix(subject: string): string {
  // International Re:/Fwd: variants
  return subject.replace(
    /^(Re|Fwd|Fw|AW|WG|SV|VS|REF|TR|R|RIF|I|Odp|PD|RES|ENC|回复|转发|返信|転送)\s*:\s*/gi,
    '',
  ).trim()
}

export function extractThreadIdFromMessageId(messageId: string): string | null {
  const match = messageId.match(/<tid\.([A-Za-z0-9_-]+)\./)
  if (!match) return null
  try {
    return Buffer.from(match[1], 'base64url').toString()
  } catch {
    return null
  }
}

export async function resolveThread(
  db: DB,
  inboxId: string,
  opts: {
    inReplyTo?: string
    references?: string[]
    subject?: string
    from: string
    to: string[]
  },
): Promise<{ threadId: string; isNew: boolean }> {
  // Strategy 1: Match by In-Reply-To or References against known message IDs
  const candidateIds: string[] = []
  if (opts.inReplyTo) candidateIds.push(opts.inReplyTo)
  if (opts.references) candidateIds.push(...opts.references)

  if (candidateIds.length > 0) {
    // Check for embedded thread IDs (our tid. format survives SES rewrite)
    for (const id of candidateIds) {
      const threadId = extractThreadIdFromMessageId(id)
      if (threadId) {
        const [existing] = await db
          .select()
          .from(threads)
          .where(and(eq(threads.id, threadId), eq(threads.inboxId, inboxId)))
          .limit(1)
        if (existing) return { threadId, isNew: false }
      }
    }

    // Match against stored messageId or sesMessageId on inbox_messages
    const matches = await db
      .select({ threadId: inboxMessages.threadId })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.inboxId, inboxId),
          or(
            inArray(inboxMessages.messageId, candidateIds),
            inArray(inboxMessages.sesMessageId, candidateIds),
          ),
        ),
      )
      .limit(1)

    if (matches.length > 0 && matches[0].threadId) {
      return { threadId: matches[0].threadId, isNew: false }
    }
  }

  // Strategy 2: Subject-based fallback (stripped of Re:/Fwd:)
  if (opts.subject) {
    const normalized = stripSubjectPrefix(opts.subject)
    if (normalized.length > 0) {
      const allThreads = await db
        .select()
        .from(threads)
        .where(eq(threads.inboxId, inboxId))

      for (const t of allThreads) {
        if (t.subject && stripSubjectPrefix(t.subject) === normalized) {
          return { threadId: t.id, isNew: false }
        }
      }
    }
  }

  // No match  - create new thread
  const threadId = generateId('thread')
  const participants = [
    { email: opts.from },
    ...opts.to.map((email) => ({ email })),
  ]

  await db.insert(threads).values({
    id: threadId,
    inboxId,
    subject: opts.subject ?? null,
    participants,
    messageCount: 0,
  })

  return { threadId, isNew: true }
}

export async function incrementThreadCount(
  db: DB,
  threadId: string,
  participantEmail?: string,
) {
  const [thread] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1)
  if (!thread) return

  const participants = thread.participants ?? []
  if (participantEmail && !participants.some((p) => p.email === participantEmail)) {
    participants.push({ email: participantEmail })
  }

  await db
    .update(threads)
    .set({
      messageCount: thread.messageCount + 1,
      lastMessageAt: new Date().toISOString(),
      participants,
    })
    .where(eq(threads.id, threadId))
}
