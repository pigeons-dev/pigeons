import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface ResolvedConfig {
  url: string
  apiKey: string
}

const CONFIG_DIR = join(homedir(), '.config', 'pigeons')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

interface StoredConfig {
  url?: string
  apiKey?: string
}

function loadStoredConfig(): StoredConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {}
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveConfig(config: StoredConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

export function resolveConfig(opts?: { url?: string; apiKey?: string }): ResolvedConfig {
  const stored = loadStoredConfig()

  const url = opts?.url ?? process.env.PIGEONS_URL ?? stored.url
  const apiKey = opts?.apiKey ?? process.env.PIGEONS_API_KEY ?? stored.apiKey

  if (!url) {
    console.error(
      'Error: No Pigeons URL configured.\n' +
        'Set it with: pigeons login --url <url>\n' +
        'Or set PIGEONS_URL environment variable.',
    )
    process.exit(1)
  }

  if (!apiKey) {
    console.error(
      'Error: No API key configured.\n' +
        'Set it with: pigeons login\n' +
        'Or set PIGEONS_API_KEY environment variable.',
    )
    process.exit(1)
  }

  return { url: url.replace(/\/+$/, ''), apiKey }
}

export function getConfigPath(): string {
  return CONFIG_FILE
}
