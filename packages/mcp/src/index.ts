#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const args = process.argv.slice(2)

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
  return undefined
}

const baseUrl = (getFlag('url') ?? process.env.PIGEONS_URL ?? '').replace(/\/+$/, '')
const apiKey = getFlag('api-key') ?? process.env.PIGEONS_API_KEY ?? ''

if (!baseUrl) {
  process.stderr.write(
    'Missing Pigeons URL. Set PIGEONS_URL or pass --url <url>\n',
  )
  process.exit(1)
}

if (!apiKey) {
  process.stderr.write(
    'Missing API key. Set PIGEONS_API_KEY or pass --api-key <key>\n',
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

type RequestOptions = {
  method?: string
  body?: unknown
  params?: Record<string, string | undefined>
}

async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = new URL(`${baseUrl}/v1${path}`)
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  const json = await res.json()
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } }).error?.message ??
      `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

function textResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'pigeons',
  version: '0.1.0',
})

// ---------------------------------------------------------------------------
// Email tools
// ---------------------------------------------------------------------------

server.tool(
  'send_email',
  'Send a transactional email. Provide html/text directly or use a template slug with variables.',
  {
    from: z.string().optional().describe('Sender address (uses server default if omitted)'),
    to: z.union([z.string(), z.array(z.string())]).describe('Recipient address(es)'),
    subject: z.string().optional().describe('Email subject line'),
    html: z.string().optional().describe('HTML body'),
    text: z.string().optional().describe('Plain-text body'),
    template: z.string().optional().describe('Template slug to render'),
    data: z.record(z.unknown()).optional().describe('Template variables'),
    tags: z.array(z.string()).optional().describe('Tags for filtering'),
    scheduledAt: z.string().optional().describe('ISO 8601 timestamp for scheduled send'),
  },
  async (params) => {
    const body: Record<string, unknown> = { to: params.to }
    if (params.from) body.from = params.from
    if (params.subject) body.subject = params.subject
    if (params.html) body.html = params.html
    if (params.text) body.text = params.text
    if (params.template) {
      body.template = { id: params.template, variables: params.data ?? {} }
    }
    if (params.tags) body.tags = params.tags
    if (params.scheduledAt) body.scheduledAt = params.scheduledAt

    const result = await api('/emails', { body })
    return textResult(result)
  },
)

server.tool(
  'get_email',
  'Get email details and delivery status by ID.',
  {
    emailId: z.string().describe('Email ID (e.g. msg_abc123)'),
  },
  async ({ emailId }) => {
    const result = await api(`/emails/${emailId}`)
    return textResult(result)
  },
)

server.tool(
  'list_emails',
  'List sent emails with optional filtering.',
  {
    status: z
      .enum(['queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed'])
      .optional()
      .describe('Filter by status'),
    tags: z.string().optional().describe('Comma-separated tags to filter by'),
    limit: z.number().optional().describe('Max results (default 25)'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/emails', {
      params: {
        status: params.status,
        tags: params.tags,
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Inbox tools
// ---------------------------------------------------------------------------

server.tool(
  'create_inbox',
  'Create a new agent inbox with a real email address.',
  {
    name: z.string().describe('Inbox name (used to derive the email address)'),
    emailAddress: z.string().optional().describe('Explicit email address (optional)'),
    description: z.string().optional().describe('Description of the inbox purpose'),
    webhookUrl: z.string().optional().describe('URL to receive inbound message webhooks'),
    metadata: z.record(z.unknown()).optional().describe('Arbitrary key-value metadata'),
  },
  async (params) => {
    const result = await api('/inboxes', { body: params })
    return textResult(result)
  },
)

server.tool(
  'list_inboxes',
  'List all agent inboxes.',
  {
    status: z.enum(['active', 'paused', 'archived']).optional().describe('Filter by status'),
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/inboxes', {
      params: {
        status: params.status,
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'get_inbox_messages',
  'Get messages for an agent inbox. Optionally filter by thread or direction.',
  {
    inboxId: z.string().describe('Inbox ID'),
    threadId: z.string().optional().describe('Filter to a specific thread'),
    direction: z.enum(['inbound', 'outbound']).optional().describe('Filter by direction'),
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api(`/inboxes/${params.inboxId}/messages`, {
      params: {
        thread_id: params.threadId,
        direction: params.direction,
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'get_thread',
  'Get a full conversation thread with all messages.',
  {
    inboxId: z.string().describe('Inbox ID'),
    threadId: z.string().describe('Thread ID'),
  },
  async ({ inboxId, threadId }) => {
    const result = await api(`/inboxes/${inboxId}/threads/${threadId}`)
    return textResult(result)
  },
)

server.tool(
  'reply_to_message',
  'Send a reply from an agent inbox, maintaining the conversation thread.',
  {
    inboxId: z.string().describe('Inbox ID to send from'),
    to: z.union([z.string(), z.array(z.string())]).describe('Recipient address(es)'),
    subject: z.string().describe('Email subject'),
    text: z.string().optional().describe('Plain-text body'),
    html: z.string().optional().describe('HTML body'),
    inReplyTo: z.string().optional().describe('Message ID to reply to (for threading)'),
  },
  async (params) => {
    const result = await api(`/inboxes/${params.inboxId}/messages`, {
      body: {
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        inReplyTo: params.inReplyTo,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'update_thread_status',
  'Update the status of a conversation thread (open, closed, snoozed).',
  {
    inboxId: z.string().describe('Inbox ID'),
    threadId: z.string().describe('Thread ID'),
    status: z.enum(['open', 'closed', 'snoozed']).describe('New thread status'),
    metadata: z.record(z.unknown()).optional().describe('Optional metadata to set'),
  },
  async (params) => {
    const body: Record<string, unknown> = { status: params.status }
    if (params.metadata) body.metadata = params.metadata

    const result = await api(`/inboxes/${params.inboxId}/threads/${params.threadId}`, {
      method: 'PATCH',
      body,
    })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Contact tools
// ---------------------------------------------------------------------------

server.tool(
  'create_contact',
  'Create or update a contact (upserts on email address).',
  {
    email: z.string().describe('Contact email address'),
    firstName: z.string().optional().describe('First name'),
    lastName: z.string().optional().describe('Last name'),
    properties: z.record(z.unknown()).optional().describe('Custom properties'),
    tags: z.array(z.string()).optional().describe('Tags for segmentation'),
  },
  async (params) => {
    const result = await api('/contacts', { body: params })
    return textResult(result)
  },
)

server.tool(
  'search_contacts',
  'List contacts with optional tag or property filtering.',
  {
    tag: z.string().optional().describe('Filter by tag'),
    email: z.string().optional().describe('Search by email'),
    subscribed: z.boolean().optional().describe('Filter by subscription status'),
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/contacts', {
      params: {
        tag: params.tag,
        email: params.email,
        subscribed: params.subscribed?.toString(),
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'update_contact',
  'Update an existing contact\'s properties, tags, or name.',
  {
    contactId: z.string().describe('Contact ID or email address'),
    firstName: z.string().optional().describe('First name'),
    lastName: z.string().optional().describe('Last name'),
    properties: z.record(z.unknown()).optional().describe('Custom properties to merge'),
    tags: z.array(z.string()).optional().describe('Tags (replaces existing)'),
  },
  async ({ contactId, ...body }) => {
    const result = await api(`/contacts/${contactId}`, {
      method: 'PATCH',
      body,
    })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Template tools
// ---------------------------------------------------------------------------

server.tool(
  'list_templates',
  'List available email templates.',
  {
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/templates', {
      params: {
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'preview_template',
  'Render an email template with sample data and return the HTML output.',
  {
    templateId: z.string().describe('Template ID or slug'),
    data: z.record(z.unknown()).optional().describe('Template variables'),
  },
  async ({ templateId, data }) => {
    const result = await api(`/templates/${templateId}/preview`, {
      body: { data: data ?? {} },
    })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Campaign tools
// ---------------------------------------------------------------------------

server.tool(
  'create_campaign',
  'Create a draft email campaign.',
  {
    name: z.string().describe('Campaign name'),
    subject: z.string().optional().describe('Email subject'),
    templateId: z.string().optional().describe('Template ID to use'),
    templateData: z.record(z.unknown()).optional().describe('Template variables'),
    fromEmail: z.string().optional().describe('From email address'),
    fromName: z.string().optional().describe('From display name'),
    audienceFilter: z.record(z.unknown()).optional().describe('JSON filter for audience targeting'),
  },
  async (params) => {
    const result = await api('/campaigns', { body: params })
    return textResult(result)
  },
)

server.tool(
  'list_campaigns',
  'List email campaigns with optional status filter.',
  {
    status: z.enum(['draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled']).optional().describe('Filter by status'),
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/campaigns', {
      params: {
        status: params.status,
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'get_campaign',
  'Get campaign details and statistics.',
  {
    campaignId: z.string().describe('Campaign ID'),
  },
  async ({ campaignId }) => {
    const result = await api(`/campaigns/${campaignId}`)
    return textResult(result)
  },
)

server.tool(
  'send_campaign',
  'Send or schedule a campaign. Must have a subject or template and matching contacts.',
  {
    campaignId: z.string().describe('Campaign ID to send'),
    scheduledAt: z.string().optional().describe('ISO 8601 timestamp for scheduled send'),
  },
  async ({ campaignId, scheduledAt }) => {
    const body: Record<string, unknown> = {}
    if (scheduledAt) body.scheduledAt = scheduledAt
    const result = await api(`/campaigns/${campaignId}/send`, { body })
    return textResult(result)
  },
)

server.tool(
  'cancel_campaign',
  'Cancel a sending or scheduled campaign.',
  {
    campaignId: z.string().describe('Campaign ID to cancel'),
  },
  async ({ campaignId }) => {
    const result = await api(`/campaigns/${campaignId}/cancel`, { body: {} })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Sequence tools
// ---------------------------------------------------------------------------

server.tool(
  'create_sequence',
  'Create a multi-step email sequence.',
  {
    name: z.string().describe('Sequence name'),
    trigger: z.object({
      event: z.string(),
      filter: z.record(z.unknown()).optional(),
    }).optional().describe('Trigger configuration'),
    steps: z.array(z.object({
      type: z.enum(['email', 'delay', 'condition']),
      templateId: z.string().optional(),
      subject: z.string().optional(),
      delayDuration: z.string().optional(),
      condition: z.record(z.unknown()).optional(),
    })).optional().describe('Sequence steps'),
  },
  async (params) => {
    const result = await api('/sequences', { body: params })
    return textResult(result)
  },
)

server.tool(
  'list_sequences',
  'List email sequences.',
  {
    status: z.enum(['draft', 'active', 'paused', 'archived']).optional().describe('Filter by status'),
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/sequences', {
      params: {
        status: params.status,
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'get_sequence',
  'Get sequence details with steps and stats.',
  {
    sequenceId: z.string().describe('Sequence ID'),
  },
  async ({ sequenceId }) => {
    const result = await api(`/sequences/${sequenceId}`)
    return textResult(result)
  },
)

server.tool(
  'activate_sequence',
  'Activate a draft or paused sequence so it starts processing enrollments.',
  {
    sequenceId: z.string().describe('Sequence ID to activate'),
  },
  async ({ sequenceId }) => {
    const result = await api(`/sequences/${sequenceId}/activate`, { body: {} })
    return textResult(result)
  },
)

server.tool(
  'pause_sequence',
  'Pause an active sequence.',
  {
    sequenceId: z.string().describe('Sequence ID to pause'),
  },
  async ({ sequenceId }) => {
    const result = await api(`/sequences/${sequenceId}/pause`, { body: {} })
    return textResult(result)
  },
)

server.tool(
  'enroll_in_sequence',
  'Enroll a contact in an active sequence.',
  {
    sequenceId: z.string().describe('Sequence ID'),
    contactId: z.string().describe('Contact ID to enroll'),
  },
  async ({ sequenceId, contactId }) => {
    const result = await api(`/sequences/${sequenceId}/enroll`, { body: { contactId } })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Topic tools
// ---------------------------------------------------------------------------

server.tool(
  'create_topic',
  'Create a subscription topic for per-topic unsubscribe management.',
  {
    name: z.string().describe('Topic name (e.g. "marketing", "product-updates")'),
    description: z.string().optional().describe('Topic description'),
  },
  async (params) => {
    const result = await api('/topics', { body: params })
    return textResult(result)
  },
)

server.tool(
  'list_topics',
  'List subscription topics.',
  {
    limit: z.number().optional().describe('Max results'),
    cursor: z.string().optional().describe('Pagination cursor'),
  },
  async (params) => {
    const result = await api('/topics', {
      params: {
        limit: params.limit?.toString(),
        cursor: params.cursor,
      },
    })
    return textResult(result)
  },
)

server.tool(
  'get_topic',
  'Get subscription topic details.',
  {
    topicId: z.string().describe('Topic ID'),
  },
  async ({ topicId }) => {
    const result = await api(`/topics/${topicId}`)
    return textResult(result)
  },
)

server.tool(
  'delete_topic',
  'Delete a subscription topic.',
  {
    topicId: z.string().describe('Topic ID to delete'),
  },
  async ({ topicId }) => {
    const result = await api(`/topics/${topicId}`, { method: 'DELETE' })
    return textResult(result)
  },
)

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.resource(
  'inboxes',
  'pigeons://inboxes',
  { description: 'List of all agent inboxes and their email addresses' },
  async () => {
    const data = await api('/inboxes')
    return {
      contents: [
        {
          uri: 'pigeons://inboxes',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    }
  },
)

server.resource(
  'templates',
  'pigeons://templates',
  { description: 'Available email templates with slugs and variable schemas' },
  async () => {
    const data = await api('/templates')
    return {
      contents: [
        {
          uri: 'pigeons://templates',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    }
  },
)

server.resource(
  'domains',
  'pigeons://domains',
  { description: 'Verified sending domains and their status' },
  async () => {
    const data = await api('/domains')
    return {
      contents: [
        {
          uri: 'pigeons://domains',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    }
  },
)

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)
