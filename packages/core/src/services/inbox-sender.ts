import { eq, and } from 'drizzle-orm'
import { inboxes, inboxMessages } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { sendEmail } from './email-sender.js'
import {
  generateMessageId,
  generateThreadIndex,
  buildReferences,
  resolveThread,
  incrementThreadCount,
  stripSubjectPrefix,
} from './threading.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

export interface SendInboxMessageInput {
  to: string | string[]
  cc?: string[]
  subject?: string
  html?: string
  text?: string
  inReplyTo?: string
  labels?: string[]
}

export async function sendInboxMessage(
  db: DB,
  config: Config,
  inboxId: string,
  input: SendInboxMessageInput,
) {
  const [inbox] = await db.select().from(inboxes).where(eq(inboxes.id, inboxId)).limit(1)
  if (!inbox) throw new NotFoundError('Inbox', inboxId)
  if (inbox.status === 'paused') throw new ValidationError('Inbox is paused')
  if (inbox.status === 'archived') throw new ValidationError('Inbox is archived')
  if (!input.html && !input.text) throw new ValidationError('Either html or text is required')

  const toArray = Array.isArray(input.to) ? input.to : [input.to]
  const domain = inbox.emailAddress.split('@')[1]

  let threadId: string
  let parentReferences: string[] = []
  let parentMessageId: string | undefined
  let parentThreadIndex: string | undefined
  let subject = input.subject ?? ''

  if (input.inReplyTo) {
    // Replying to an existing message
    const [parentMsg] = await db
      .select()
      .from(inboxMessages)
      .where(
        and(eq(inboxMessages.inboxId, inboxId), eq(inboxMessages.id, input.inReplyTo)),
      )
      .limit(1)

    if (!parentMsg) throw new NotFoundError('Message', input.inReplyTo)

    threadId = parentMsg.threadId!
    parentMessageId = parentMsg.messageId ?? parentMsg.sesMessageId ?? undefined
    parentReferences = parentMsg.references ?? []

    if (parentMsg.headers?.['thread-index']) {
      parentThreadIndex = parentMsg.headers['thread-index']
    }

    if (!subject && parentMsg.subject) {
      const stripped = stripSubjectPrefix(parentMsg.subject)
      subject = `Re: ${stripped}`
    }
  } else {
    // New conversation
    const resolved = await resolveThread(db, inboxId, {
      subject: subject || undefined,
      from: inbox.emailAddress,
      to: toArray,
    })
    threadId = resolved.threadId
  }

  // Build threading headers
  const messageId = generateMessageId(domain, threadId)
  const references = parentMessageId
    ? buildReferences(parentReferences, parentMessageId)
    : [messageId]
  const threadIndex = generateThreadIndex(parentThreadIndex)

  const headers: Record<string, string> = {
    'Message-ID': messageId,
    'Thread-Index': threadIndex,
    'Thread-Topic': stripSubjectPrefix(subject) || subject,
  }

  if (parentMessageId) {
    headers['In-Reply-To'] = parentMessageId
    headers['References'] = references.join(' ')
  }

  // Send via SES
  if (!subject) throw new ValidationError('Subject is required for new conversations')

  const sesResult = await sendEmail(config, {
    from: inbox.emailAddress,
    to: toArray,
    cc: input.cc,
    subject,
    html: input.html,
    text: input.text,
    headers,
  })

  // Store outbound message
  const id = generateId('inboxMessage')
  await db.insert(inboxMessages).values({
    id,
    inboxId,
    direction: 'outbound',
    from: inbox.emailAddress,
    to: toArray,
    cc: input.cc ?? null,
    subject,
    html: input.html ?? null,
    text: input.text ?? null,
    threadId,
    messageId,
    inReplyTo: parentMessageId ?? null,
    references,
    sesMessageId: sesResult.messageId,
    labels: input.labels ?? null,
    headers,
  })

  await incrementThreadCount(db, threadId, inbox.emailAddress)

  const [message] = await db
    .select()
    .from(inboxMessages)
    .where(eq(inboxMessages.id, id))
    .limit(1)

  return message!
}
