import { simpleParser, type ParsedMail } from 'mailparser'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { eq } from 'drizzle-orm'
import { inboxes, inboxMessages } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { resolveThread, incrementThreadCount } from './threading.js'
import { extractTextReply, extractHtmlReply } from './reply-extractor.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

export interface SesNotification {
  notificationType: string
  mail: {
    messageId: string
    source: string
    destination: string[]
    commonHeaders: {
      from: string[]
      to: string[]
      cc?: string[]
      subject: string
      messageId: string
      date: string
    }
    headers: Array<{ name: string; value: string }>
  }
  receipt: {
    action: { type: string; bucketName: string; objectKey: string }
    spamVerdict: { status: string }
    virusVerdict: { status: string }
    spfVerdict: { status: string }
    dkimVerdict: { status: string }
    dmarcVerdict: { status: string }
    processingTimeMillis: number
  }
}

let s3Client: S3Client | null = null

function getS3Client(config: Config): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    })
  }
  return s3Client
}

export async function processInboundEmail(
  db: DB,
  config: Config,
  notification: SesNotification,
): Promise<{ messageId: string; inboxId: string; threadId: string } | null> {
  const { mail, receipt } = notification

  if (receipt.spamVerdict?.status === 'FAIL') return null
  if (receipt.virusVerdict?.status === 'FAIL') return null

  const s3 = getS3Client(config)

  const configBucket = config.inboundS3Bucket
  const bucket = receipt.action.bucketName ?? configBucket
  if (!bucket) throw new Error('Cannot determine S3 bucket for inbound email')

  if (configBucket && bucket !== configBucket) {
    throw new Error(`Unexpected S3 bucket '${bucket}', expected '${configBucket}'`)
  }

  const key = receipt.action.objectKey ?? `${config.inboundS3KeyPrefix ?? 'inbound/'}${mail.messageId}`

  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(key) || key.startsWith('/')) {
    throw new Error(`Invalid S3 key: ${key}`)
  }

  const MAX_INBOUND_SIZE = 30 * 1024 * 1024

  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  )

  const bodyStream = s3Response.Body
  if (!bodyStream) throw new Error(`Empty S3 object: ${bucket}/${key}`)

  if (s3Response.ContentLength && s3Response.ContentLength > MAX_INBOUND_SIZE) {
    throw new Error(`Inbound email too large: ${s3Response.ContentLength} bytes (max ${MAX_INBOUND_SIZE})`)
  }

  const bodyBytes = await bodyStream.transformToByteArray()

  if (bodyBytes.length > MAX_INBOUND_SIZE) {
    throw new Error(`Inbound email too large: ${bodyBytes.length} bytes (max ${MAX_INBOUND_SIZE})`)
  }

  const parsed = await simpleParser(Buffer.from(bodyBytes.buffer, bodyBytes.byteOffset, bodyBytes.byteLength))

  // Route to inbox by matching destination addresses
  const destination = mail.destination.map((d) => d.toLowerCase())
  const inbox = await findInboxForAddress(db, destination)

  if (!inbox) return null

  if (inbox.status === 'paused') return null

  // Resolve or create thread
  const inReplyTo = parsed.inReplyTo
    ? (typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : undefined)
    : undefined
  const references = parsed.references
    ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
    : undefined

  const fromEmail = extractEmail(parsed.from?.text ?? mail.source)
  const toEmails = destination

  const { threadId } = await resolveThread(db, inbox.id, {
    inReplyTo,
    references,
    subject: parsed.subject,
    from: fromEmail,
    to: toEmails,
  })

  // Extract reply content
  const extractedText = parsed.text ? extractTextReply(parsed.text) : null
  const extractedHtml = parsed.html ? extractHtmlReply(parsed.html as string) : null

  // Parse attachments
  const attachments = (parsed.attachments ?? []).map((att) => {
    const rawName = att.filename ?? att.cid ?? 'unnamed'
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.')
    return {
      filename: att.filename ?? 'attachment',
      contentType: att.contentType,
      size: att.size,
      s3Key: `${key}/attachments/${safeName}`,
    }
  })

  // Store message
  const messageId = generateId('inboxMessage')
  await db.insert(inboxMessages).values({
    id: messageId,
    inboxId: inbox.id,
    direction: 'inbound',
    from: fromEmail,
    to: toEmails,
    cc: parsed.cc ? extractEmails(Array.isArray(parsed.cc) ? parsed.cc.map((a) => a.text).join(', ') : parsed.cc.text) : null,
    subject: parsed.subject ?? null,
    html: (parsed.html as string) ?? null,
    text: parsed.text ?? null,
    extractedHtml,
    extractedText,
    threadId,
    messageId: parsed.messageId ?? null,
    inReplyTo: inReplyTo ?? null,
    references: references ?? null,
    sesMessageId: mail.messageId,
    attachments: attachments.length > 0 ? attachments : null,
    rawMimePath: `${bucket}/${key}`,
    headers: headersToRecord(parsed.headers),
  })

  await incrementThreadCount(db, threadId, fromEmail)

  return { messageId, inboxId: inbox.id, threadId }
}

async function findInboxForAddress(db: DB, addresses: string[]) {
  // Exact match first
  for (const addr of addresses) {
    const [inbox] = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.emailAddress, addr))
      .limit(1)
    if (inbox) return inbox
  }

  // Catch-all fallback
  const [catchAll] = await db
    .select()
    .from(inboxes)
    .where(eq(inboxes.catchAll, true))
    .limit(1)

  return catchAll ?? null
}

function extractEmail(text: string): string {
  const match = text.match(/<([^>]+)>/)
  return match ? match[1].toLowerCase() : text.toLowerCase().trim()
}

function extractEmails(text: string): string[] {
  return text.split(',').map((e) => extractEmail(e.trim())).filter(Boolean)
}

function headersToRecord(headers: ParsedMail['headers']): Record<string, string> {
  const result: Record<string, string> = {}
  if (headers) {
    headers.forEach((value, key) => {
      if (typeof value === 'string') {
        result[key] = value
      } else if (value && typeof value === 'object' && 'text' in value) {
        result[key] = (value as { text: string }).text
      }
    })
  }
  return result
}
