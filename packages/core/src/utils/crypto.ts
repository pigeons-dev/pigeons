import { randomBytes, createHash } from 'node:crypto'

export function generateApiKey(): { full: string; prefix: string; hash: string } {
  const bytes = randomBytes(32)
  const key = bytes.toString('base64url')
  const full = `pgn_${key}`
  const prefix = full.slice(0, 12)
  const hash = hashApiKey(full)
  return { full, prefix, hash }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
