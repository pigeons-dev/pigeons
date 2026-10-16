import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const emailsCommand = new Command('emails').description('Manage emails')

emailsCommand
  .command('list')
  .description('List emails')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    const params = new URLSearchParams()
    if (opts.status) params.set('status', opts.status)
    params.set('limit', opts.limit)

    try {
      const result = await client.get(`/api/v1/emails?${params}`)
      if (result.data.length === 0) {
        console.log('No emails found')
        return
      }
      for (const email of result.data) {
        console.log(`${email.id}  ${email.status.padEnd(10)}  ${email.to.join(', ')}  ${email.subject}`)
      }
      if (result.has_more) {
        console.log(`\n... more results available (cursor: ${result.next_cursor})`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

emailsCommand
  .command('get <id>')
  .description('Get email details')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const email = await client.get(`/api/v1/emails/${id}`)
      console.log(JSON.stringify(email, null, 2))
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
