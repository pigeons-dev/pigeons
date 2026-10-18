import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const campaignsCommand = new Command('campaigns').description('Manage campaigns')

campaignsCommand
  .command('list')
  .description('List campaigns')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      let path = `/v1/campaigns?limit=${opts.limit}`
      if (opts.status) path += `&status=${opts.status}`

      const result = await client.get(path)
      if (result.data.length === 0) {
        console.log('No campaigns found')
        return
      }
      for (const c of result.data) {
        const stats = c.stats ? ` (${c.stats.sent}/${c.stats.total} sent)` : ''
        console.log(`  ${c.id}  ${c.name.padEnd(30)} ${c.status}${stats}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

campaignsCommand
  .command('get <id>')
  .description('Get campaign details')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const c = await client.get(`/v1/campaigns/${id}`)
      console.log(`ID:       ${c.id}`)
      console.log(`Name:     ${c.name}`)
      console.log(`Subject:  ${c.subject ?? ' -'}`)
      console.log(`Status:   ${c.status}`)
      console.log(`Template: ${c.templateId ?? ' -'}`)
      if (c.audienceFilter) console.log(`Filter:   ${JSON.stringify(c.audienceFilter)}`)
      if (c.stats) {
        console.log(`Stats:    total=${c.stats.total} sent=${c.stats.sent} delivered=${c.stats.delivered} bounced=${c.stats.bounced} failed=${c.stats.failed}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

campaignsCommand
  .command('create')
  .description('Create a draft campaign')
  .requiredOption('--name <name>', 'Campaign name')
  .option('--subject <subject>', 'Email subject')
  .option('--template <id>', 'Template ID')
  .option('--from-email <email>', 'From email address')
  .option('--from-name <name>', 'From name')
  .option('--filter <json>', 'Audience filter JSON')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const body: Record<string, unknown> = { name: opts.name }
      if (opts.subject) body.subject = opts.subject
      if (opts.template) body.templateId = opts.template
      if (opts.fromEmail) body.fromEmail = opts.fromEmail
      if (opts.fromName) body.fromName = opts.fromName
      if (opts.filter) body.audienceFilter = JSON.parse(opts.filter)

      const campaign = await client.post('/v1/campaigns', body)
      console.log(`Created campaign: ${campaign.name} (${campaign.id})`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

campaignsCommand
  .command('send <id>')
  .description('Send or schedule a campaign')
  .option('--at <datetime>', 'Schedule for later (ISO 8601)')
  .action(async (id, opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const body: Record<string, unknown> = {}
      if (opts.at) body.scheduledAt = opts.at

      const campaign = await client.post(`/v1/campaigns/${id}/send`, body)
      if (campaign.status === 'scheduled') {
        console.log(`Scheduled campaign: ${campaign.name} for ${campaign.scheduledAt}`)
      } else {
        console.log(`Sending campaign: ${campaign.name} to ${campaign.stats?.total ?? 0} contacts`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

campaignsCommand
  .command('cancel <id>')
  .description('Cancel a sending or scheduled campaign')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      await client.post(`/v1/campaigns/${id}/cancel`, {})
      console.log(`Cancelled campaign: ${id}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

campaignsCommand
  .command('stats <id>')
  .description('Show campaign statistics')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const c = await client.get(`/v1/campaigns/${id}`)
      console.log(`Campaign: ${c.name}`)
      console.log(`Status:   ${c.status}`)
      if (c.stats) {
        console.log(`\nStatistics:`)
        console.log(`  Total:      ${c.stats.total}`)
        console.log(`  Sent:       ${c.stats.sent}`)
        console.log(`  Delivered:  ${c.stats.delivered}`)
        console.log(`  Bounced:    ${c.stats.bounced}`)
        console.log(`  Complained: ${c.stats.complained}`)
        console.log(`  Failed:     ${c.stats.failed}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
