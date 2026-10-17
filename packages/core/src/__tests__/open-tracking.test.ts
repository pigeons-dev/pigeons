import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { createApp } from '../app.js'
import { generateApiKey } from '../utils/crypto.js'
import { generateId } from '../utils/id.js'
import { injectTrackingPixel, shouldTrackOpens } from '../services/open-tracking.js'
import type { Config } from '../config.js'
import type { Server } from 'node:http'

vi.mock('sns-validator', () => {
  return {
    default: class {
      validate(_msg: unknown, cb: (err: Error | null) => void) {
        cb(null)
      }
    },
  }
})

let server: Server
let baseUrl: string
let db: ReturnType<typeof drizzle<typeof schema>>

const config: Config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 1000,
  openTracking: true,
  baseUrl: 'https://mail.example.com',
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })

  const { full, prefix, hash } = generateApiKey()
  await db.insert(schema.apiKeys).values({
    id: generateId('apiKey'),
    name: 'Test Key',
    prefix,
    hash,
    scopes: null,
  })

  const app = createApp(db, config)
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address()
      baseUrl = `http://127.0.0.1:${(addr as any).port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

describe('open tracking pixel injection', () => {
  it('injects pixel before </body>', () => {
    const html = '<html><body><h1>Hello</h1></body></html>'
    const result = injectTrackingPixel(html, 'msg_123', config)
    expect(result).toContain('src="https://mail.example.com/v1/t/msg_123"')
    expect(result).toContain('</body>')
    expect(result.indexOf('img')).toBeLessThan(result.indexOf('</body>'))
  })

  it('appends pixel when no </body> tag', () => {
    const html = '<h1>Hello</h1>'
    const result = injectTrackingPixel(html, 'msg_456', config)
    expect(result).toContain('src="https://mail.example.com/v1/t/msg_456"')
    expect(result).toContain('<h1>Hello</h1>')
  })

  it('does not inject when openTracking is false', () => {
    const offConfig = { ...config, openTracking: false }
    const html = '<html><body><h1>Hello</h1></body></html>'
    const result = injectTrackingPixel(html, 'msg_789', offConfig)
    expect(result).toBe(html)
  })

  it('does not inject when baseUrl is missing', () => {
    const noBaseUrl = { ...config, baseUrl: undefined }
    const html = '<html><body><h1>Hello</h1></body></html>'
    const result = injectTrackingPixel(html, 'msg_000', noBaseUrl)
    expect(result).toBe(html)
  })

  it('strips trailing slashes from baseUrl', () => {
    const trailingSlash = { ...config, baseUrl: 'https://mail.example.com/' }
    const html = '<body>hi</body>'
    const result = injectTrackingPixel(html, 'msg_111', trailingSlash)
    expect(result).toContain('src="https://mail.example.com/v1/t/msg_111"')
    expect(result).not.toContain('//v1')
  })

  it('pixel has privacy-respecting attributes', () => {
    const html = '<body></body>'
    const result = injectTrackingPixel(html, 'msg_222', config)
    expect(result).toContain('width="1"')
    expect(result).toContain('height="1"')
    expect(result).toContain('display:none')
  })
})

describe('shouldTrackOpens', () => {
  it('returns config value when per-email is undefined', () => {
    expect(shouldTrackOpens(undefined, config)).toBe(true)
    expect(shouldTrackOpens(undefined, { ...config, openTracking: false })).toBe(false)
  })

  it('per-email overrides config', () => {
    expect(shouldTrackOpens(true, { ...config, openTracking: false })).toBe(true)
    expect(shouldTrackOpens(false, config)).toBe(false)
  })
})

describe('tracking pixel endpoint', () => {
  it('returns 1x1 transparent GIF', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Test',
      html: '<p>Hello</p>',
      status: 'sent',
      trackOpens: true,
    })

    const res = await fetch(`${baseUrl}/v1/t/${emailId}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('records first open with timestamp', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Test',
      html: '<p>Hello</p>',
      status: 'sent',
      trackOpens: true,
    })

    await fetch(`${baseUrl}/v1/t/${emailId}`)
    await new Promise((r) => setTimeout(r, 100))

    const [updated] = await db.select().from(schema.emails).where(eq(schema.emails.id, emailId)).limit(1)
    expect(updated!.openCount).toBe(1)
    expect(updated!.firstOpenedAt).toBeTruthy()
    expect(updated!.lastOpenedAt).toBeTruthy()
  })

  it('increments open count on subsequent opens', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Test',
      html: '<p>Hello</p>',
      status: 'sent',
      trackOpens: true,
    })

    await fetch(`${baseUrl}/v1/t/${emailId}`)
    await new Promise((r) => setTimeout(r, 100))
    await fetch(`${baseUrl}/v1/t/${emailId}`)
    await new Promise((r) => setTimeout(r, 100))

    const [updated] = await db.select().from(schema.emails).where(eq(schema.emails.id, emailId)).limit(1)
    expect(updated!.openCount).toBe(2)
  })

  it('does not record opens when trackOpens is false', async () => {
    const emailId = generateId('email')
    await db.insert(schema.emails).values({
      id: emailId,
      from: 'test@example.com',
      to: ['user@example.com'],
      subject: 'Test',
      html: '<p>Hello</p>',
      status: 'sent',
      trackOpens: false,
    })

    await fetch(`${baseUrl}/v1/t/${emailId}`)
    await new Promise((r) => setTimeout(r, 100))

    const [updated] = await db.select().from(schema.emails).where(eq(schema.emails.id, emailId)).limit(1)
    expect(updated!.openCount).toBe(0)
    expect(updated!.firstOpenedAt).toBeNull()
  })

  it('returns pixel even for unknown email IDs', async () => {
    const res = await fetch(`${baseUrl}/v1/t/msg_nonexistent`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
  })

  it('pixel has no-cache headers', async () => {
    const res = await fetch(`${baseUrl}/v1/t/msg_test`)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('cache-control')).toContain('no-cache')
    expect(res.headers.get('pragma')).toBe('no-cache')
  })
})
