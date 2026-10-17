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

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  sampleData: text('sample_data', { mode: 'json' }).$type<Record<string, unknown>>(),
  version: integer('version').notNull().default(1),
  ...timestamps(),
})

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
  properties: text('properties', { mode: 'json' }).$type<Record<string, unknown>>(),
  unsubscribed: integer('unsubscribed', { mode: 'boolean' }).notNull().default(false),
  unsubscribedAt: text('unsubscribed_at'),
  unsubscribedTopics: text('unsubscribed_topics', { mode: 'json' }).$type<string[]>(),
  bounced: integer('bounced', { mode: 'boolean' }).notNull().default(false),
  bouncedAt: text('bounced_at'),
  complained: integer('complained', { mode: 'boolean' }).notNull().default(false),
  complainedAt: text('complained_at'),
  ...timestamps(),
})

export const inboxes = sqliteTable('inboxes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emailAddress: text('email_address').notNull().unique(),
  description: text('description'),
  webhookUrl: text('webhook_url'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  autoReplyEnabled: integer('auto_reply_enabled', { mode: 'boolean' }).notNull().default(false),
  status: text('status', {
    enum: ['active', 'paused', 'archived'],
  })
    .notNull()
    .default('active'),
  labels: text('labels', { mode: 'json' }).$type<string[]>(),
  catchAll: integer('catch_all', { mode: 'boolean' }).notNull().default(false),
  apiKeyId: text('api_key_id'),
  ...timestamps(),
})

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull(),
  subject: text('subject'),
  lastMessageAt: text('last_message_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  messageCount: integer('message_count').notNull().default(0),
  participants: text('participants', { mode: 'json' }).$type<
    Array<{ email: string; name?: string }>
  >(),
  status: text('status', {
    enum: ['open', 'closed', 'snoozed'],
  })
    .notNull()
    .default('open'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  ...timestamps(),
})

export const inboxMessages = sqliteTable('inbox_messages', {
  id: text('id').primaryKey(),
  inboxId: text('inbox_id').notNull(),
  direction: text('direction', {
    enum: ['inbound', 'outbound'],
  }).notNull(),
  from: text('from').notNull(),
  to: text('to', { mode: 'json' }).notNull().$type<string[]>(),
  cc: text('cc', { mode: 'json' }).$type<string[]>(),
  subject: text('subject'),
  html: text('html'),
  text: text('text'),
  extractedHtml: text('extracted_html'),
  extractedText: text('extracted_text'),
  threadId: text('thread_id'),
  messageId: text('message_id'),
  inReplyTo: text('in_reply_to'),
  references: text('references', { mode: 'json' }).$type<string[]>(),
  sesMessageId: text('ses_message_id'),
  attachments: text('attachments', { mode: 'json' }).$type<
    Array<{
      filename: string
      contentType: string
      size: number
      s3Key: string
    }>
  >(),
  rawMimePath: text('raw_mime_path'),
  labels: text('labels', { mode: 'json' }).$type<string[]>(),
  headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
  ...timestamps(),
})

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  events: text('events', { mode: 'json' }).notNull().$type<string[]>(),
  secret: text('secret').notNull(),
  status: text('status', {
    enum: ['active', 'disabled'],
  })
    .notNull()
    .default('active'),
  failureCount: integer('failure_count').notNull().default(0),
  lastTriggeredAt: text('last_triggered_at'),
  ...timestamps(),
})

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  attempts: integer('attempts').notNull().default(0),
  nextRetryAt: text('next_retry_at'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
})

export const subscriptionTopics = sqliteTable('subscription_topics', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  ...timestamps(),
})

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  subject: text('subject'),
  topicId: text('topic_id'),
  templateId: text('template_id'),
  templateData: text('template_data', { mode: 'json' }).$type<Record<string, unknown>>(),
  fromName: text('from_name'),
  fromEmail: text('from_email'),
  audienceFilter: text('audience_filter', { mode: 'json' }).$type<Record<string, unknown>>(),
  status: text('status', {
    enum: ['draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled'],
  })
    .notNull()
    .default('draft'),
  scheduledAt: text('scheduled_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  stats: text('stats', { mode: 'json' })
    .notNull()
    .$type<{ total: number; sent: number; delivered: number; bounced: number; complained: number; failed: number }>()
    .$defaultFn(() => ({ total: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0 })),
  ...timestamps(),
})

export const sequences = sqliteTable('sequences', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  trigger: text('trigger', { mode: 'json' }).$type<{ event: string; filter?: Record<string, unknown> }>(),
  status: text('status', {
    enum: ['draft', 'active', 'paused', 'archived'],
  })
    .notNull()
    .default('draft'),
  stats: text('stats', { mode: 'json' })
    .notNull()
    .$type<{ enrolled: number; completed: number; exited: number; active: number }>()
    .$defaultFn(() => ({ enrolled: 0, completed: 0, exited: 0, active: 0 })),
  ...timestamps(),
})

export const sequenceSteps = sqliteTable('sequence_steps', {
  id: text('id').primaryKey(),
  sequenceId: text('sequence_id').notNull(),
  position: integer('position').notNull(),
  type: text('type', {
    enum: ['email', 'delay', 'condition'],
  }).notNull(),
  topicId: text('topic_id'),
  templateId: text('template_id'),
  templateData: text('template_data', { mode: 'json' }).$type<Record<string, unknown>>(),
  subject: text('subject'),
  delayDuration: text('delay_duration'),
  condition: text('condition', { mode: 'json' }).$type<Record<string, unknown>>(),
  stats: text('stats', { mode: 'json' })
    .notNull()
    .$type<{ sent: number; delivered: number; bounced: number; complained: number }>()
    .$defaultFn(() => ({ sent: 0, delivered: 0, bounced: 0, complained: 0 })),
  ...timestamps(),
})

export const sequenceEnrollments = sqliteTable('sequence_enrollments', {
  id: text('id').primaryKey(),
  sequenceId: text('sequence_id').notNull(),
  contactId: text('contact_id').notNull(),
  currentStepId: text('current_step_id'),
  status: text('status', {
    enum: ['active', 'completed', 'exited', 'failed'],
  })
    .notNull()
    .default('active'),
  enrolledAt: text('enrolled_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
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
