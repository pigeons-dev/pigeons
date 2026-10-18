import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const topicsCommand = new Command('topics').description('Manage subscription topics')

topicsCommand
  .command('list')
  .description('List subscription topics')
  .option('--limit <n>', 'Max results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.get(`/v1/topics?limit=${opts.limit}`)
      if (result.data.length === 0) {
        console.log('No topics found')
        return
      }
      for (const t of result.data) {
        console.log(`  ${t.id}  ${t.name.padEnd(25)} ${t.description ?? ''}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

topicsCommand
  .command('get <id>')
  .description('Get topic details')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const t = await client.get(`/v1/topics/${id}`)
      console.log(`ID:          ${t.id}`)
      console.log(`Name:        ${t.name}`)
      console.log(`Description: ${t.description ?? ' -'}`)
      console.log(`Created:     ${t.createdAt}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

topicsCommand
  .command('create')
  .description('Create a subscription topic')
  .requiredOption('--name <name>', 'Topic name (e.g. "marketing", "product-updates")')
  .option('--description <desc>', 'Topic description')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const body: Record<string, unknown> = { name: opts.name }
      if (opts.description) body.description = opts.description

      const topic = await client.post('/v1/topics', body)
      console.log(`Created topic: ${topic.name} (${topic.id})`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

topicsCommand
  .command('delete <id>')
  .description('Delete a subscription topic')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.delete(`/v1/topics/${id}`)
      console.log(`Deleted topic: ${id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
