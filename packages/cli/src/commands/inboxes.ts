import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const inboxesCommand = new Command('inboxes').description('Manage agent inboxes')

inboxesCommand
  .command('create')
  .description('Create an agent inbox')
  .requiredOption('--name <name>', 'Inbox name')
  .option('--email <address>', 'Email address for the inbox')
  .option('--description <desc>', 'Inbox description')
  .option('--webhook-url <url>', 'Webhook URL for incoming messages')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const body: Record<string, string> = { name: opts.name }
      if (opts.email) body.emailAddress = opts.email
      if (opts.description) body.description = opts.description
      if (opts.webhookUrl) body.webhookUrl = opts.webhookUrl

      const inbox = await client.post('/v1/inboxes', body)
      console.log(`✓ Created inbox: ${inbox.name} (${inbox.id})`)
      console.log(`  Email: ${inbox.emailAddress}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('list')
  .description('List inboxes')
  .option('--status <status>', 'Filter by status (active, paused, archived)')
  .option('--limit <n>', 'Max results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const params = new URLSearchParams()
      if (opts.status) params.set('status', opts.status)
      params.set('limit', opts.limit)

      const result = await client.get(`/v1/inboxes?${params}`)
      if (result.data.length === 0) {
        console.log('No inboxes found')
        return
      }
      for (const inbox of result.data) {
        const status = inbox.status === 'active' ? '✓' : '⏸'
        console.log(`${status} ${inbox.name.padEnd(25)} ${inbox.emailAddress}  (${inbox.status})`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('get <id>')
  .description('Get inbox details')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const inbox = await client.get(`/v1/inboxes/${id}`)
      console.log(`Name:        ${inbox.name}`)
      console.log(`ID:          ${inbox.id}`)
      console.log(`Email:       ${inbox.emailAddress}`)
      console.log(`Status:      ${inbox.status}`)
      console.log(`Description: ${inbox.description ?? '—'}`)
      console.log(`Webhook:     ${inbox.webhookUrl ?? '—'}`)
      if (inbox.metadata && Object.keys(inbox.metadata).length) {
        console.log(`Metadata:    ${JSON.stringify(inbox.metadata)}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('pause <id>')
  .description('Pause an inbox')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.post(`/v1/inboxes/${id}/pause`, {})
      console.log(`✓ Inbox paused: ${id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('resume <id>')
  .description('Resume an inbox')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.post(`/v1/inboxes/${id}/resume`, {})
      console.log(`✓ Inbox resumed: ${id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('messages-list <inboxId>')
  .description('List messages in an inbox')
  .option('--direction <dir>', 'Filter by direction (inbound, outbound)')
  .option('--thread-id <id>', 'Filter by thread')
  .option('--limit <n>', 'Max results', '25')
  .action(async (inboxId, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const params = new URLSearchParams()
      if (opts.direction) params.set('direction', opts.direction)
      if (opts.threadId) params.set('threadId', opts.threadId)
      params.set('limit', opts.limit)

      const result = await client.get(`/v1/inboxes/${inboxId}/messages?${params}`)
      if (result.data.length === 0) {
        console.log('No messages found')
        return
      }
      for (const msg of result.data) {
        const dir = msg.direction === 'inbound' ? '←' : '→'
        console.log(`${dir} ${msg.id}  ${msg.from.padEnd(30)} ${msg.subject}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('messages-get <inboxId> <messageId>')
  .description('Get a message from an inbox')
  .action(async (inboxId, messageId) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const msg = await client.get(`/v1/inboxes/${inboxId}/messages/${messageId}`)
      console.log(`ID:        ${msg.id}`)
      console.log(`Direction: ${msg.direction}`)
      console.log(`From:      ${msg.from}`)
      console.log(`To:        ${Array.isArray(msg.to) ? msg.to.join(', ') : msg.to}`)
      console.log(`Subject:   ${msg.subject}`)
      console.log(`Thread:    ${msg.threadId ?? '—'}`)
      console.log(`Date:      ${msg.createdAt}`)
      if (msg.extractedText) {
        console.log(`\n--- Reply ---`)
        console.log(msg.extractedText)
      } else if (msg.text) {
        console.log(`\n--- Body ---`)
        console.log(msg.text)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('messages-send <inboxId>')
  .description('Send a message from an inbox')
  .requiredOption('--to <email>', 'Recipient email')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--text <text>', 'Plain text body')
  .option('--html <html>', 'HTML body')
  .option('--in-reply-to <messageId>', 'Message ID to reply to')
  .action(async (inboxId, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const body: Record<string, string> = {
        to: opts.to,
        subject: opts.subject,
      }
      if (opts.text) body.text = opts.text
      if (opts.html) body.html = opts.html
      if (opts.inReplyTo) body.inReplyTo = opts.inReplyTo

      const msg = await client.post(`/v1/inboxes/${inboxId}/messages`, body)
      console.log(`✓ Sent message: ${msg.id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('threads-list <inboxId>')
  .description('List threads in an inbox')
  .option('--status <status>', 'Filter by status (open, closed, snoozed)')
  .option('--limit <n>', 'Max results', '25')
  .action(async (inboxId, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const params = new URLSearchParams()
      if (opts.status) params.set('status', opts.status)
      params.set('limit', opts.limit)

      const result = await client.get(`/v1/inboxes/${inboxId}/threads?${params}`)
      if (result.data.length === 0) {
        console.log('No threads found')
        return
      }
      for (const thread of result.data) {
        const status = thread.status === 'open' ? '●' : '○'
        const count = `${thread.messageCount} msg${thread.messageCount === 1 ? '' : 's'}`
        console.log(`${status} ${thread.id}  ${thread.subject.padEnd(40)} ${count}  (${thread.status})`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

inboxesCommand
  .command('threads-get <inboxId> <threadId>')
  .description('Get a thread with messages')
  .action(async (inboxId, threadId) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const thread = await client.get(`/v1/inboxes/${inboxId}/threads/${threadId}`)
      console.log(`Thread:       ${thread.id}`)
      console.log(`Subject:      ${thread.subject}`)
      console.log(`Status:       ${thread.status}`)
      console.log(`Messages:     ${thread.messageCount}`)
      console.log(`Participants: ${thread.participants?.join(', ') ?? '—'}`)

      if (thread.messages?.length) {
        console.log('')
        for (const msg of thread.messages) {
          const dir = msg.direction === 'inbound' ? '←' : '→'
          console.log(`  ${dir} ${msg.from}  (${msg.createdAt})`)
          const body = msg.extractedText ?? msg.text
          if (body) {
            const lines = body.split('\n').slice(0, 5)
            for (const line of lines) console.log(`    ${line}`)
            if (body.split('\n').length > 5) console.log('    ...')
          }
          console.log('')
        }
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
