import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const webhooksCommand = new Command('webhooks').description('Manage webhooks')

webhooksCommand
  .command('create')
  .description('Create a webhook')
  .requiredOption('--url <url>', 'Webhook endpoint URL')
  .requiredOption('--events <events>', 'Comma-separated event types')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const events = opts.events.split(',').map((e: string) => e.trim())
      const webhook = await client.post('/v1/webhooks', {
        url: opts.url,
        events,
      })
      console.log(`✓ Created webhook: ${webhook.id}`)
      console.log(`  URL:    ${webhook.url}`)
      console.log(`  Events: ${webhook.events.join(', ')}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

webhooksCommand
  .command('list')
  .description('List webhooks')
  .option('--limit <n>', 'Max results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.get(`/v1/webhooks?limit=${opts.limit}`)
      if (result.data.length === 0) {
        console.log('No webhooks found')
        return
      }
      for (const wh of result.data) {
        const status = wh.status === 'active' ? '✓' : '✗'
        console.log(`${status} ${wh.id}  ${wh.url.padEnd(45)} ${wh.events.join(', ')}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

webhooksCommand
  .command('get <id>')
  .description('Get webhook details')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const wh = await client.get(`/v1/webhooks/${id}`)
      console.log(`ID:       ${wh.id}`)
      console.log(`URL:      ${wh.url}`)
      console.log(`Status:   ${wh.status}`)
      console.log(`Events:   ${wh.events.join(', ')}`)
      console.log(`Failures: ${wh.failureCount ?? 0}`)
      if (wh.lastTriggeredAt) {
        console.log(`Last triggered: ${wh.lastTriggeredAt}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

webhooksCommand
  .command('delete <id>')
  .description('Delete a webhook')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.delete(`/v1/webhooks/${id}`)
      console.log(`✓ Deleted webhook: ${id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
