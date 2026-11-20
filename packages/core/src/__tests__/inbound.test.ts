import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const s3 = vi.hoisted(() => ({ raw: '' }))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send() {
      return { Body: { transformToByteArray: async () => new TextEncoder().encode(s3.raw) } }
    }
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}))

const { processInboundEmail } = await import('../services/inbound.js')

let db: DB

const config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  inboundS3Bucket: 'inbound-bucket',
  inboundS3KeyPrefix: 'inbound/',
} as Config

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
  await db.insert(schema.inboxes).values({
    id: generateId('inbox'),
    name: 'Support',
    emailAddress: 'support@mail.example.com',
  })
})

function notification(sesMessageId: string) {
  return {
    notificationType: 'Received',
    mail: {
      messageId: sesMessageId,
      source: 'sender@example.org',
      destination: ['support@mail.example.com'],
      commonHeaders: { from: [], to: [], subject: '', messageId: '', date: '' },
      headers: [],
    },
    receipt: {
      action: { type: 'SNS', bucketName: 'inbound-bucket', objectKey: `inbound/${sesMessageId}` },
      spamVerdict: { status: 'PASS' },
      virusVerdict: { status: 'PASS' },
      spfVerdict: { status: 'PASS' },
      dkimVerdict: { status: 'PASS' },
      dmarcVerdict: { status: 'PASS' },
      processingTimeMillis: 1,
    },
  }
}

async function storedMessage(id: string) {
  const [row] = await db.select().from(schema.inboxMessages).where(eq(schema.inboxMessages.id, id))
  return row
}

describe('processInboundEmail html handling', () => {
  it('stores null html for a text-only email', async () => {
    s3.raw = [
      'From: Sender <sender@example.org>',
      'To: support@mail.example.com',
      'Subject: Plain text only',
      'Message-ID: <plain-1@example.org>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Just text, no HTML part.',
      '',
    ].join('\r\n')

    const result = await processInboundEmail(db, config, notification('ses-plain-1'))
    const row = await storedMessage(result!.messageId)

    expect(row.html).toBeNull()
    expect(row.extractedHtml).toBeNull()
    expect(row.text).toContain('Just text, no HTML part.')
  })

  it('stores the html part when present', async () => {
    s3.raw = [
      'From: Sender <sender@example.org>',
      'To: support@mail.example.com',
      'Subject: With HTML',
      'Message-ID: <html-1@example.org>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hello in text',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hello in <b>html</b></p>',
      '--b1--',
      '',
    ].join('\r\n')

    const result = await processInboundEmail(db, config, notification('ses-html-1'))
    const row = await storedMessage(result!.messageId)

    expect(row.html).toContain('<p>Hello in <b>html</b></p>')
    expect(row.text).toContain('Hello in text')
  })
})
