import dns from 'node:dns'
import { ValidationError } from './errors.js'

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/**
 * Check whether an IPv4 or IPv6 address falls within a private/reserved range.
 * Blocks: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *         169.254.0.0/16, 0.0.0.0, ::1, fc00::/7 (+ mapped forms)
 */
function isPrivateIP(ip: string): boolean {
  // Handle IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1)
  const mapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(mapped)) {
    const parts = mapped.split('.').map(Number)
    const [a, b] = parts

    if (a === 127) return true                         // 127.0.0.0/8
    if (a === 10) return true                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
    if (a === 192 && b === 168) return true            // 192.168.0.0/16
    if (a === 169 && b === 254) return true            // 169.254.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true  // 100.64.0.0/10 (CGNAT)
    if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 (benchmark)
    if (a >= 240) return true                          // 240.0.0.0/4 (reserved)
    if (a === 0) return true                           // 0.0.0.0/8
    if (a === 255 && b === 255) return true            // 255.255.255.255 (broadcast)

    return false
  }

  // IPv6
  const normalized = ip.toLowerCase()
  if (normalized === '::1') return true
  if (normalized === '::') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true // fc00::/7
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb')) return true // fe80::/10

  return false
}

/**
 * Validate a webhook URL is safe to fetch.
 * Parses the URL, checks the scheme, resolves the hostname, and rejects
 * private/reserved IP ranges to prevent SSRF attacks.
 *
 * Must be called both at webhook creation/update time and before each delivery
 * (to prevent DNS rebinding attacks).
 */
export async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationError('Invalid webhook URL')
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new ValidationError(
      `Webhook URL scheme must be http or https, got '${parsed.protocol.replace(':', '')}'`,
    )
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets

  let address: string
  try {
    const result = await dns.promises.lookup(hostname)
    address = result.address
  } catch {
    throw new ValidationError(`Cannot resolve webhook hostname '${parsed.hostname}'`)
  }

  if (isPrivateIP(address)) {
    throw new ValidationError(
      'Webhook URL must not resolve to a private or reserved IP address',
    )
  }
}
