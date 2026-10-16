import { Command } from 'commander'
import { resolveConfig } from '../config.js'
import { createClient } from '../client.js'

export const sendCommand = new Command('send')
  .description('Send an email')
  .requiredOption('--to <email>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .option('--from <email>', 'Sender email address')
  .option('--html <html>', 'HTML body')
  .option('--text <text>', 'Plain text body')
  .action(async (opts) => {
    if (!opts.html && !opts.text) {
      console.error('Error: Either --html or --text is required')
      process.exit(1)
    }

    const config = resolveConfig()
    const client = createClient(config)

    try {
      const result = await client.post('/v1/emails', {
        to: opts.to,
        from: opts.from,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      })
      console.log(`Email queued: ${result.id}`)
    } catch (err) {
      console.error('Failed to send:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
