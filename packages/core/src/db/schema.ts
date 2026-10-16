import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core'

function timestamps() {
  return {
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString())
      .$onUpdateFn(() => new Date().toISOString()),
  }
}

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>(),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  ...timestamps(),
})

export const emails = sqliteTable('emails', {
  id: text('id').primaryKey(),
  from: text('from').notNull(),
  to: text('to', { mode: 'json' }).notNull().$type<string[]>(),
  cc: text('cc', { mode: 'json' }).$type<string[]>(),
  bcc: text('bcc', { mode: 'json' }).$type<string[]>(),
  subject: text('subject').notNull(),
  html: text('html'),
  text: text('text'),
  templateId: text('template_id'),
  templateData: text('template_data', { mode: 'json' }).$type<Record<string, unknown>>(),
  status: text('status', {
    enum: ['queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed'],
  })
    .notNull()
    .default('queued'),
  sesMessageId: text('ses_message_id'),
  inboxId: text('inbox_id'),
  threadId: text('thread_id'),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
  idempotencyKey: text('idempotency_key'),
  scheduledAt: text('scheduled_at'),
  ...timestamps(),
})

export const domains = sqliteTable('domains', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull().unique(),
  verificationStatus: text('verification_status', {
    enum: ['pending', 'verified', 'failed'],
  })
    .notNull()
    .default('pending'),
  dkimTokens: text('dkim_tokens', { mode: 'json' }).$type<string[]>(),
  spfVerified: integer('spf_verified', { mode: 'boolean' }).notNull().default(false),
  dmarcVerified: integer('dmarc_verified', { mode: 'boolean' }).notNull().default(false),
  region: text('region').notNull(),
  capabilities: text('capabilities', { mode: 'json' })
    .notNull()
    .$type<{ sending: boolean; receiving: boolean }>()
    .$defaultFn(() => ({ sending: true, receiving: false })),
  records: text('records', { mode: 'json' }).$type<
    Array<{
      type: string
      name: string
      value: string
      ttl: number
      status: string
      purpose: string
    }>
  >(),
  ...timestamps(),
})

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'dead'],
  })
    .notNull()
    .default('pending'),
  runAt: text('run_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lastError: text('last_error'),
  ...timestamps(),
})

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  response: text('response', { mode: 'json' }).notNull().$type<unknown>(),
  statusCode: integer('status_code').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  expiresAt: text('expires_at').notNull(),
})
