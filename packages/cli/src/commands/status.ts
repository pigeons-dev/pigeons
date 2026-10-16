import { Command } from 'commander'
import { resolveConfig } from '../config.js'

export const statusCommand = new Command('status')
  .description('Check instance health')
  .action(async () => {
    const config = resolveConfig()

    try {
      const res = await fetch(`${config.url}/health`)
      if (!res.ok) {
        console.error(`Instance returned status ${res.status}`)
        process.exit(1)
      }
      const data = (await res.json()) as any
      console.log(`Instance: ${config.url}`)
      console.log(`Status:   ${data.status}`)
      console.log(`Version:  ${data.version}`)
    } catch (err) {
      console.error(`Cannot reach ${config.url}: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })
