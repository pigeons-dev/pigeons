import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { ctx } from './setup.js'

const ses = new SESv2Client({
  region: process.env.PIGEONS_AWS_REGION!,
  credentials: {
    accessKeyId: process.env.PIGEONS_AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.PIGEONS_AWS_SECRET_ACCESS_KEY!,
  },
})

export async function request(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ctx.apiKey,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

export const get = (path: string) => request('GET', path)
export const post = (path: string, body: unknown) => request('POST', path, body)
export const patch = (path: string, body: unknown) => request('PATCH', path, body)
export const del = (path: string) => request('DELETE', path)

/**
 * Send an email directly via SES API (bypassing Pigeons).
 * Simulates inbound emails arriving at agent inboxes.
 */
export async function sendInboundTestEmail(opts: {
  from: string
  to: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string[]
}) {
  const result = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: opts.from,
      Destination: { ToAddresses: [opts.to] },
      Content: {
        Simple: {
          Subject: { Data: opts.subject },
          Body: {
            Text: { Data: opts.body },
            Html: { Data: `<p>${opts.body}</p>` },
          },
          Headers: [
            ...(opts.inReplyTo ? [{ Name: 'In-Reply-To', Value: opts.inReplyTo }] : []),
            ...(opts.references ? [{ Name: 'References', Value: opts.references.join(' ') }] : []),
          ],
        },
      },
      ConfigurationSetName: 'pigeons-tracking',
    }),
  )
  return result.MessageId!
}

export async function poll<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 60_000, intervalMs = 2000, label = 'condition' } = opts
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await fn()
    if (result) return result
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`)
}

export async function waitForEmailStatus(
  emailId: string,
  targetStatus: string | string[],
  timeoutMs = 60_000,
) {
  const targets = Array.isArray(targetStatus) ? targetStatus : [targetStatus]
  return poll(
    async () => {
      const { data } = await get(`/v1/emails/${emailId}`)
      return targets.includes(data?.status) ? data : null
    },
    { timeoutMs, label: `email ${emailId} → ${targets.join('|')}` },
  )
}

export async function waitForInboxMessage(
  inboxId: string,
  predicate: (msg: any) => boolean,
  timeoutMs = 90_000,
) {
  return poll(
    async () => {
      const { data } = await get(`/v1/inboxes/${inboxId}/messages`)
      const messages = data?.data ?? data ?? []
      return Array.isArray(messages) ? messages.find(predicate) ?? null : null
    },
    { timeoutMs, label: `inbox message in ${inboxId}` },
  )
}

export function uid() {
  return Math.random().toString(36).slice(2, 10)
}
