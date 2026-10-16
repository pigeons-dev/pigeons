import { Command } from 'commander'
import { resolveConfig, getConfigPath } from '../config.js'

export const whoamiCommand = new Command('whoami')
  .description('Show current connection info')
  .action(() => {
    const config = resolveConfig()
    console.log(`URL:     ${config.url}`)
    console.log(`API key: ${config.apiKey.slice(0, 12)}...`)
    console.log(`Config:  ${getConfigPath()}`)
  })
