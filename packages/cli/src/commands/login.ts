import { Command } from 'commander'
import { saveConfig } from '../config.js'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export const loginCommand = new Command('login')
  .description('Configure connection to a Pigeons instance')
  .option('--url <url>', 'Instance URL')
  .option('--api-key <key>', 'API key')
  .action(async (opts) => {
    let url = opts.url
    let apiKey = opts.apiKey

    if (!url || !apiKey) {
      const rl = createInterface({ input: stdin, output: stdout })
      try {
        if (!url) url = await rl.question('Pigeons instance URL: ')
        if (!apiKey) apiKey = await rl.question('API key: ')
      } finally {
        rl.close()
      }
    }

    url = url.replace(/\/+$/, '')

    // Verify connection
    try {
      const res = await fetch(`${url}/health`)
      if (!res.ok) {
        console.error(`Could not reach ${url}/health (status ${res.status})`)
        process.exit(1)
      }
    } catch (err) {
      console.error(`Could not connect to ${url}: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }

    saveConfig({ url, apiKey })
    console.log(`Logged in to ${url}`)
  })
