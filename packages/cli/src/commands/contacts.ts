import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const contactsCommand = new Command('contacts').description('Manage contacts')

contactsCommand
  .command('list')
  .description('List contacts')
  .option('--tag <tag>', 'Filter by tag')
  .option('--limit <n>', 'Max results', '25')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      let path = `/api/v1/contacts?limit=${opts.limit}`
      if (opts.tag) path += `&tag=${encodeURIComponent(opts.tag)}`

      const result = await client.get(path)
      if (result.data.length === 0) {
        console.log('No contacts found')
        return
      }
      for (const c of result.data) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
        const tags = c.tags?.length ? ` [${c.tags.join(', ')}]` : ''
        console.log(`  ${c.email.padEnd(35)} ${name}${tags}`)
      }
      if (result.hasMore) console.log(`\n  ... more results available`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

contactsCommand
  .command('get <emailOrId>')
  .description('Get contact details')
  .action(async (emailOrId) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const lookup = emailOrId.includes('@') ? encodeURIComponent(emailOrId) : emailOrId
      const c = await client.get(`/api/v1/contacts/${lookup}`)
      console.log(`Email:        ${c.email}`)
      console.log(`Name:         ${[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}`)
      console.log(`Tags:         ${c.tags?.join(', ') || '—'}`)
      console.log(`Unsubscribed: ${c.unsubscribed ? 'yes' : 'no'}`)
      console.log(`Bounced:      ${c.bounced ? 'yes' : 'no'}`)
      if (c.properties && Object.keys(c.properties).length) {
        console.log(`Properties:   ${JSON.stringify(c.properties)}`)
      }
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

contactsCommand
  .command('create')
  .description('Create a contact')
  .requiredOption('--email <email>', 'Email address')
  .option('--name <name>', 'Full name (first last)')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (opts) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const [firstName, ...rest] = (opts.name ?? '').split(' ')
      const lastName = rest.join(' ') || undefined
      const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : undefined

      const contact = await client.post('/api/v1/contacts', {
        email: opts.email,
        firstName: firstName || undefined,
        lastName,
        tags,
      })
      console.log(`✓ Created contact: ${contact.email} (${contact.id})`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

contactsCommand
  .command('delete <emailOrId>')
  .description('Delete a contact')
  .action(async (emailOrId) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const lookup = emailOrId.includes('@') ? encodeURIComponent(emailOrId) : emailOrId
      await client.delete(`/api/v1/contacts/${lookup}`)
      console.log(`✓ Deleted contact: ${emailOrId}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

contactsCommand
  .command('unsubscribe <emailOrId>')
  .description('Unsubscribe a contact')
  .action(async (emailOrId) => {
    const config = resolveConfig()
    const client = createClient(config)

    try {
      const lookup = emailOrId.includes('@') ? encodeURIComponent(emailOrId) : emailOrId
      await client.post(`/api/v1/contacts/${lookup}/unsubscribe`, {})
      console.log(`✓ Unsubscribed: ${emailOrId}`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

contactsCommand
  .command('import <csvPath>')
  .description('Import contacts from CSV')
  .action(async (csvPath) => {
    const config = resolveConfig()
    const client = createClient(config)
    const { readFileSync } = await import('node:fs')

    try {
      const raw = readFileSync(csvPath, 'utf-8')
      const lines = raw.trim().split('\n')
      if (lines.length < 2) {
        console.error('CSV must have a header row and at least one data row')
        process.exit(1)
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
      const emailIdx = headers.indexOf('email')
      if (emailIdx === -1) {
        console.error('CSV must have an "email" column')
        process.exit(1)
      }

      const contacts: Record<string, unknown>[] = []
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i])
        if (!cols[emailIdx]) continue

        const contact: Record<string, unknown> = { email: cols[emailIdx] }
        const properties: Record<string, string> = {}

        for (let j = 0; j < headers.length; j++) {
          const key = headers[j]
          const val = cols[j]?.trim()
          if (!val || j === emailIdx) continue

          if (key === 'first_name' || key === 'firstname') contact.firstName = val
          else if (key === 'last_name' || key === 'lastname') contact.lastName = val
          else if (key === 'tags') contact.tags = val.split(',').map((t: string) => t.trim())
          else properties[key] = val
        }

        if (Object.keys(properties).length) contact.properties = properties
        contacts.push(contact)
      }

      const batchSize = 1000
      let created = 0
      let skipped = 0

      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize)
        const result = await client.post('/api/v1/contacts/batch', { contacts: batch })
        created += result.created
        skipped += result.skipped
      }

      console.log(`✓ Imported ${created} contacts (${skipped} duplicates skipped)`)
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}
