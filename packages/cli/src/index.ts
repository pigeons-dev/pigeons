#!/usr/bin/env node

import { Command } from 'commander'
import { resolveConfig, type ResolvedConfig } from './config.js'
import { loginCommand } from './commands/login.js'
import { whoamiCommand } from './commands/whoami.js'
import { sendCommand } from './commands/send.js'
import { emailsCommand } from './commands/emails.js'
import { domainsCommand } from './commands/domains.js'
import { statusCommand } from './commands/status.js'

const program = new Command()

program
  .name('pigeons')
  .description('CLI for managing a Pigeons email infrastructure instance')
  .version('0.1.0')
  .option('--url <url>', 'Pigeons instance URL')
  .option('--api-key <key>', 'API key')

program.addCommand(loginCommand)
program.addCommand(whoamiCommand)
program.addCommand(sendCommand)
program.addCommand(emailsCommand)
program.addCommand(domainsCommand)
program.addCommand(statusCommand)

program.parse()
