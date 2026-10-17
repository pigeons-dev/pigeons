import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(import.meta.dirname, '../.env') })

import ngrok from '@ngrok/ngrok'
import {
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
  ListSubscriptionsByTopicCommand,
} from '@aws-sdk/client-sns'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as schema from '#core/db/schema.js'
import { createApp } from '#core/app.js'
import { ensureApiKey } from '#core/services/api-key-service.js'
import { createWorker } from '#core/workers/queue.js'
import type { Config } from '#core/config.js'
import type { Server } from 'http'

const INBOUND_TOPIC_ARN = process.env.E2E_SNS_INBOUND_TOPIC_ARN!
const EVENTS_TOPIC_ARN = process.env.E2E_SNS_EVENTS_TOPIC_ARN!
const port = parseInt(process.env.PIGEONS_PORT ?? '3891', 10)

export const ctx = {
  apiKey: '',
  baseUrl: '',
  publicUrl: '',
}

let server: Server
let worker: ReturnType<typeof createWorker>
let tunnel: ngrok.Listener
let inboundSubArn: string | undefined
let eventsSubArn: string | undefined

const e2eConfig: Config = {
  port,
  aws: {
    accessKeyId: process.env.PIGEONS_AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.PIGEONS_AWS_SECRET_ACCESS_KEY!,
    region: process.env.PIGEONS_AWS_REGION!,
  },
  fromEmail: process.env.PIGEONS_FROM_EMAIL!,
  workerPollInterval: 500,
  openTracking: true,
  baseUrl: `http://localhost:${port}`,
  configurationSet: 'pigeons-tracking',
  inboundS3Bucket: 'pigeons-inbound-fibre-dev',
  inboundS3KeyPrefix: 'inbound/',
}

export async function startAll() {
  if (!process.env.PIGEONS_AWS_ACCESS_KEY_ID) {
    throw new Error('E2E requires AWS credentials. Copy .env.example to .env and fill in values.')
  }
  if (!process.env.NGROK_AUTHTOKEN) {
    throw new Error('NGROK_AUTHTOKEN is required for E2E tests.')
  }

  // 1. Boot Pigeons server with in-memory SQLite
  console.log('[e2e] Booting server...')
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: resolve(import.meta.dirname, '../../packages/core/drizzle'),
  })

  const keyInfo = await ensureApiKey(db)
  ctx.apiKey = keyInfo.key

  const app = createApp(db, e2eConfig)
  worker = createWorker(db, e2eConfig)
  worker.start()

  await new Promise<void>((resolve) => {
    server = app.listen(port, () => {
      console.log(`[e2e] Server on port ${port}`)
      resolve()
    })
  })
  ctx.baseUrl = `http://localhost:${port}`

  // 2. Start ngrok tunnel
  console.log('[e2e] Starting ngrok...')
  tunnel = await ngrok.forward({ addr: port, authtoken: process.env.NGROK_AUTHTOKEN! })
  ctx.publicUrl = tunnel.url()!
  console.log(`[e2e] Tunnel: ${ctx.publicUrl}`)

  // 3. Subscribe SNS topics
  const sns = makeSnsClient()
  await cleanStaleSubscriptions(sns, INBOUND_TOPIC_ARN)
  await cleanStaleSubscriptions(sns, EVENTS_TOPIC_ARN)

  console.log('[e2e] Subscribing SNS topics...')
  const inboundSub = await sns.send(
    new SubscribeCommand({
      TopicArn: INBOUND_TOPIC_ARN,
      Protocol: 'https',
      Endpoint: `${ctx.publicUrl}/v1/internal/ses/inbound`,
    }),
  )
  inboundSubArn = inboundSub.SubscriptionArn

  const eventsSub = await sns.send(
    new SubscribeCommand({
      TopicArn: EVENTS_TOPIC_ARN,
      Protocol: 'https',
      Endpoint: `${ctx.publicUrl}/v1/internal/ses/events`,
    }),
  )
  eventsSubArn = eventsSub.SubscriptionArn

  // 4. Wait for SNS to confirm subscriptions
  console.log('[e2e] Waiting for SNS confirmation...')
  await waitForConfirmation(sns, INBOUND_TOPIC_ARN, `${ctx.publicUrl}/v1/internal/ses/inbound`)
  await waitForConfirmation(sns, EVENTS_TOPIC_ARN, `${ctx.publicUrl}/v1/internal/ses/events`)
  console.log('[e2e] Ready.')
}

export async function stopAll() {
  const sns = makeSnsClient()

  if (inboundSubArn && inboundSubArn !== 'PendingConfirmation') {
    await sns.send(new UnsubscribeCommand({ SubscriptionArn: inboundSubArn })).catch(() => {})
  }
  if (eventsSubArn && eventsSubArn !== 'PendingConfirmation') {
    await sns.send(new UnsubscribeCommand({ SubscriptionArn: eventsSubArn })).catch(() => {})
  }
  if (tunnel) await tunnel.close().catch(() => {})
  worker?.stop()
  if (server) await new Promise<void>((r) => server.close(() => r()))
  console.log('[e2e] Stopped.')
}

function makeSnsClient() {
  return new SNSClient({
    region: process.env.PIGEONS_AWS_REGION!,
    credentials: {
      accessKeyId: process.env.PIGEONS_AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.PIGEONS_AWS_SECRET_ACCESS_KEY!,
    },
  })
}

async function cleanStaleSubscriptions(sns: SNSClient, topicArn: string) {
  try {
    const list = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }))
    for (const sub of list.Subscriptions ?? []) {
      if (
        sub.Endpoint?.includes('ngrok') &&
        sub.SubscriptionArn &&
        sub.SubscriptionArn !== 'PendingConfirmation'
      ) {
        await sns.send(new UnsubscribeCommand({ SubscriptionArn: sub.SubscriptionArn }))
      }
    }
  } catch {
    // ignore
  }
}

async function waitForConfirmation(
  sns: SNSClient,
  topicArn: string,
  endpoint: string,
  timeoutMs = 30_000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const list = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }))
    const sub = list.Subscriptions?.find((s) => s.Endpoint === endpoint)
    if (sub?.SubscriptionArn && sub.SubscriptionArn !== 'PendingConfirmation') return
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`SNS confirmation timed out for ${endpoint}`)
}
