import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const domainsCommand = new Command('domains').description('Manage domains')

domainsCommand
  .command('add <domain>')
  .description('Add a domain for verification')
  .action(async (domain) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.post('/api/v1/domains', { domain })
      console.log(`Domain registered: ${result.domain}\n`)
      console.log('Add these DNS records to your domain:\n')
      for (const record of result.records) {
        console.log(`  ${record.type.padEnd(6)} ${record.name.padEnd(45)} ${record.value}`)
      }
      console.log(`\nRun \`pigeons domains verify ${result.id}\` to check propagation.`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

domainsCommand
  .command('list')
  .description('List domains')
  .action(async () => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.get('/api/v1/domains')
      if (result.data.length === 0) {
        console.log('No domains configured')
        return
      }
      for (const dom of result.data) {
        const status = dom.verificationStatus === 'verified' ? '✓' : '…'
        console.log(`${status} ${dom.domain}  (${dom.verificationStatus})`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

domainsCommand
  .command('verify <id>')
  .description('Check domain verification status')
  .action(async (id) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.get(`/api/v1/domains/${id}/verify`)
      console.log(`Domain: ${result.domain}`)
      console.log(`Status: ${result.verificationStatus}\n`)
      if (result.records) {
        for (const record of result.records) {
          const icon = record.status === 'verified' ? '✓' : '…'
          console.log(`  ${icon} ${record.purpose.padEnd(12)} ${record.status}`)
        }
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
