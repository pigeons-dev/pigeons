/**
 * Webhook Event Handler
 *
 * An Express server that registers a webhook with Pigeons, receives delivery
 * lifecycle events, and routes them to typed handlers. Demonstrates:
 *
 *   1. Programmatic webhook registration via the SDK
 *   2. Signature verification using HMAC-SHA256
 *   3. Event routing with per-type handlers for delivery, bounce,
 *      complaint, open tracking, and failure events
 *   4. Idempotent event processing using delivery IDs
 *   5. In-memory event log with a GET endpoint for inspection
 *   6. Sending a test email to trigger the full event flow
 *
 * Event lifecycle for a typical email:
 *
 *   pigeons.emails.send()
 *     -> Pigeons queues the email and fires "email.sent"
 *     -> SES accepts the email and Pigeons fires "email.delivered"
 *     -> If the recipient opens (and tracking is on), "email.opened"
 *     -> If the recipient's server rejects, "email.bounced"
 *     -> If the recipient marks it as spam, "email.complained"
 *     -> If sending fails entirely, "email.failed"
 *
 * Run: npx tsx src/index.ts
 */

import { createHmac } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { Pigeons, PigeonsError } from '@pigeons/pigeons-ts'

// ── Configuration ──────────────────────────────────────────────────────────
// The Pigeons client reads PIGEONS_URL and PIGEONS_API_KEY from the
// environment. In production, set these via your deployment's secret management.

const pigeons = new Pigeons()

const PORT = Number(process.env.WEBHOOK_PORT) || 4000

// The public URL where Pigeons can reach this server. For local development,
// use a tunnel like ngrok: `ngrok http 4000` and paste the HTTPS URL here.
// In production, this is your server's public URL.
const WEBHOOK_URL = process.env.WEBHOOK_URL || `http://localhost:${PORT}/webhooks/pigeons`

// ── Types ──────────────────────────────────────────────────────────────────
// Pigeons webhook payloads follow a consistent envelope: { event, data }.
// The `data` object varies by event type. These interfaces model the shapes
// your handlers will receive.

interface WebhookPayload {
  event: string
  data: Record<string, unknown>
}

interface EmailSentData {
  email_id: string
}

interface EmailDeliveredData {
  email_id: string
}

interface EmailBouncedData {
  email_id: string
  bounce_type?: string    // "Permanent" (hard) or "Transient" (soft)
  bounced_recipients?: Array<{ emailAddress: string; diagnosticCode?: string }>
}

interface EmailComplainedData {
  email_id: string
  complained_recipients?: Array<{ emailAddress: string }>
}

interface EmailOpenedData {
  email_id: string
  opened_at: string       // ISO 8601 timestamp of the first open
}

interface EmailFailedData {
  email_id: string
  error?: string
}

// ── In-memory event store ──────────────────────────────────────────────────
// For this demo, we store received events in memory so you can inspect them
// via GET /events. In production, persist events to your database.

interface StoredEvent {
  deliveryId: string       // X-Pigeons-Delivery header — unique per delivery attempt
  event: string
  data: Record<string, unknown>
  receivedAt: string
  action: string           // what the handler did with this event
}

const eventStore: StoredEvent[] = []
const MAX_STORED_EVENTS = 200

// Track processed delivery IDs for idempotency. Pigeons retries failed
// deliveries, so the same event can arrive more than once. Always deduplicate
// by the X-Pigeons-Delivery header value.
const processedDeliveries = new Set<string>()

function storeEvent(deliveryId: string, event: string, data: Record<string, unknown>, action: string): void {
  eventStore.unshift({
    deliveryId,
    event,
    data,
    receivedAt: new Date().toISOString(),
    action,
  })

  // Cap the store so memory doesn't grow unbounded in long-running demos.
  if (eventStore.length > MAX_STORED_EVENTS) {
    eventStore.length = MAX_STORED_EVENTS
  }
}

// ── Suppression list ───────────────────────────────────────────────────────
// Contacts that have bounced (hard) or complained get added here. Before
// sending any email in a real app, check this set to avoid sending to
// addresses that will hurt your sender reputation.

const suppressedContacts = new Set<string>()

// ── Express app ────────────────────────────────────────────────────────────

const app = express()

// Pigeons delivers webhooks as JSON with Content-Type: application/json.
// We also capture the raw body for signature verification — the HMAC is
// computed over the raw bytes, not the parsed object.
app.use(
  express.json({
    type: ['application/json', 'text/plain'],
    verify: (req: Request, _res, buf) => {
      // Stash the raw body for HMAC verification in the webhook handler.
      // This is essential: JSON.stringify(parsed) may differ from the
      // original bytes due to key ordering or whitespace, breaking the
      // signature check.
      (req as any).rawBody = buf.toString('utf-8')
    },
  }),
)

// ── Webhook secret ─────────────────────────────────────────────────────────
// Stored after registering the webhook. Used to verify X-Pigeons-Signature.
let webhookSecret: string | null = null

// ── Signature verification ─────────────────────────────────────────────────
// Pigeons signs every webhook delivery with HMAC-SHA256 using the secret
// returned at registration time. Always verify in production to ensure the
// request genuinely originated from your Pigeons instance.
//
// The signature is a hex-encoded HMAC-SHA256 digest of the raw JSON body.

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')

  // Use timing-safe comparison to prevent timing attacks. For simplicity
  // this demo uses a direct comparison, but in production use
  // crypto.timingSafeEqual() with equal-length buffers.
  if (expected.length !== signature.length) return false

  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

// ── Event handlers ─────────────────────────────────────────────────────────
// Each handler receives the typed data payload and performs the appropriate
// action. In a real application these would update your database, notify
// users, trigger workflows, etc.

function handleEmailSent(data: EmailSentData): string {
  // email.sent fires when Pigeons accepts the email and enqueues it for
  // delivery via SES. The email is not yet delivered at this point — it's
  // in the sending pipeline.
  console.log(`  [sent] Email ${data.email_id} accepted and queued for delivery`)

  return 'logged: email queued for SES delivery'
}

function handleEmailDelivered(data: EmailDeliveredData): string {
  // email.delivered fires when SES confirms the recipient's mail server
  // accepted the email. This is the "happy path" terminal state — the
  // email has been successfully handed off.
  //
  // Best practice: update the email's status in your database to "delivered"
  // so you can show delivery confirmations in your UI.
  console.log(`  [delivered] Email ${data.email_id} successfully delivered`)

  return 'logged: delivery confirmed, status updated'
}

function handleEmailBounced(data: EmailBouncedData): string {
  // email.bounced fires when the recipient's mail server rejects the email.
  // There are two bounce types:
  //
  //   Permanent (hard bounce): The address doesn't exist, the domain is
  //   invalid, or the server permanently refuses delivery. You must stop
  //   sending to this address immediately. Continued sends to hard-bounced
  //   addresses damage your sender reputation and can get you suspended.
  //
  //   Transient (soft bounce): Temporary failure — mailbox full, server
  //   temporarily unavailable, message too large. SES may retry
  //   automatically. You can try again later, but track repeated soft
  //   bounces and suppress after a threshold (e.g., 3 soft bounces in 7 days).
  const bounceType = data.bounce_type ?? 'unknown'
  const isHardBounce = bounceType === 'Permanent'

  console.log(`  [bounced] Email ${data.email_id} bounced (${bounceType})`)

  if (data.bounced_recipients) {
    for (const recipient of data.bounced_recipients) {
      console.log(`    Recipient: ${recipient.emailAddress}`)
      if (recipient.diagnosticCode) {
        console.log(`    Diagnostic: ${recipient.diagnosticCode}`)
      }

      // Hard bounces: immediately suppress the contact. This is critical
      // for maintaining sender reputation with SES.
      if (isHardBounce) {
        suppressedContacts.add(recipient.emailAddress)
        console.log(`    -> SUPPRESSED: added to suppression list (hard bounce)`)
      }
    }
  }

  return isHardBounce
    ? 'contact suppressed: hard bounce, no further sends'
    : 'logged: soft bounce, will monitor for repeated failures'
}

function handleEmailComplained(data: EmailComplainedData): string {
  // email.complained fires when a recipient marks your email as spam via
  // their email client's "Report Spam" button. This generates a complaint
  // feedback loop notification from the ISP.
  //
  // Complaints are the most damaging signal for sender reputation.
  // You MUST immediately and permanently stop sending to any address
  // that generates a complaint. There are no second chances — a complaint
  // means the recipient does not want your email.
  //
  // SES complaint rate threshold: keep below 0.1%. Exceeding this can
  // trigger account review or suspension.
  console.log(`  [complained] Email ${data.email_id} received a spam complaint`)

  if (data.complained_recipients) {
    for (const recipient of data.complained_recipients) {
      suppressedContacts.add(recipient.emailAddress)
      console.log(`    Recipient: ${recipient.emailAddress}`)
      console.log(`    -> SUPPRESSED: permanent suppression (complaint)`)
    }
  }

  return 'contact suppressed: complaint received, permanently blocked'
}

function handleEmailOpened(data: EmailOpenedData): string {
  // email.opened fires when the recipient's email client loads the tracking
  // pixel embedded in the HTML body. This only fires on the first open —
  // subsequent opens increment the count but don't re-fire the webhook.
  //
  // Important caveats about open tracking:
  //   - Only works for HTML emails (no pixel in plain text)
  //   - Many email clients block images by default, so opens are undercounted
  //   - Apple Mail Privacy Protection pre-fetches images, inflating open counts
  //   - Open tracking is opt-in: set trackOpens: true when sending
  //   - The server must have PIGEONS_OPEN_TRACKING=true enabled
  //
  // Despite these limitations, opens are useful for relative engagement
  // comparison (A/B subject line testing, segment comparison) even if the
  // absolute numbers aren't perfectly accurate.
  console.log(`  [opened] Email ${data.email_id} opened at ${data.opened_at}`)

  return `logged: first open recorded at ${data.opened_at}`
}

function handleEmailFailed(data: EmailFailedData): string {
  // email.failed fires when Pigeons cannot send the email at all — for
  // example, SES rejects the API call (invalid from address, sandbox
  // restrictions, account suspension) or all recipients are suppressed.
  //
  // Unlike bounces (which happen after SES accepts the email), failures
  // mean the email never entered the delivery pipeline.
  //
  // Best practice: log the error, alert your operations team, and
  // investigate the root cause. Common causes:
  //   - Sending from an unverified domain
  //   - SES sandbox mode and recipient not verified
  //   - AWS credentials expired or revoked
  //   - Rate limit exceeded
  const error = data.error ?? 'unknown error'
  console.log(`  [failed] Email ${data.email_id} failed to send: ${error}`)

  return `logged: send failure — ${error} — queued for investigation`
}

// ── POST /webhooks/pigeons ─────────────────────────────────────────────────
// Main webhook endpoint. Pigeons sends a POST request here for every
// matching event. The handler:
//   1. Verifies the HMAC signature (if we have a secret)
//   2. Deduplicates by delivery ID (idempotency)
//   3. Routes to the appropriate event handler
//   4. Stores the event for the GET /events endpoint
//
// Always respond with 2xx quickly. Pigeons has a 10-second timeout and
// will retry on non-2xx responses. If your processing is slow, accept
// the event, return 200, and process it asynchronously.

app.post('/webhooks/pigeons', (req: Request, res: Response) => {
  const signature = req.headers['x-pigeons-signature'] as string | undefined
  const eventType = req.headers['x-pigeons-event'] as string | undefined
  const deliveryId = req.headers['x-pigeons-delivery'] as string | undefined

  console.log(`\n--- Webhook received ---`)
  console.log(`  Event:    ${eventType ?? 'unknown'}`)
  console.log(`  Delivery: ${deliveryId ?? 'none'}`)

  // Step 1: Verify signature. In production, reject unsigned or
  // incorrectly signed requests immediately.
  if (webhookSecret && signature) {
    const rawBody = (req as any).rawBody as string
    if (!verifySignature(rawBody, signature, webhookSecret)) {
      console.log(`  REJECTED: invalid signature`)
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
    console.log(`  Signature: verified`)
  }

  // Step 2: Idempotency check. The same delivery can arrive multiple times
  // if Pigeons retries (e.g., your server was slow to respond). Use the
  // delivery ID to skip duplicates.
  if (deliveryId && processedDeliveries.has(deliveryId)) {
    console.log(`  SKIPPED: duplicate delivery ${deliveryId}`)
    res.json({ received: true, duplicate: true })
    return
  }

  // Step 3: Parse payload and route to handler.
  const payload = req.body as WebhookPayload
  let action = 'unhandled'

  switch (payload.event) {
    case 'email.sent':
      action = handleEmailSent(payload.data as unknown as EmailSentData)
      break
    case 'email.delivered':
      action = handleEmailDelivered(payload.data as unknown as EmailDeliveredData)
      break
    case 'email.bounced':
      action = handleEmailBounced(payload.data as unknown as EmailBouncedData)
      break
    case 'email.complained':
      action = handleEmailComplained(payload.data as unknown as EmailComplainedData)
      break
    case 'email.opened':
      action = handleEmailOpened(payload.data as unknown as EmailOpenedData)
      break
    case 'email.failed':
      action = handleEmailFailed(payload.data as unknown as EmailFailedData)
      break
    default:
      console.log(`  [unhandled] Unknown event type: ${payload.event}`)
      action = `ignored: unknown event type ${payload.event}`
  }

  // Step 4: Mark as processed and store.
  if (deliveryId) {
    processedDeliveries.add(deliveryId)
  }
  storeEvent(deliveryId ?? 'unknown', payload.event, payload.data, action)

  console.log(`  Action: ${action}`)
  console.log(`---\n`)

  // Always respond 200 quickly. Pigeons retries on non-2xx and has a
  // 10-second timeout. Even if your handler throws, catch it and respond
  // 200 to avoid retry storms. Process errors asynchronously.
  res.json({ received: true, event: payload.event, action })
})

// ── GET /events ────────────────────────────────────────────────────────────
// Returns recent webhook events from the in-memory store. Useful for
// inspecting what events have come through during development.
//
// Query parameters:
//   ?type=email.bounced — filter by event type
//   ?limit=10           — number of events to return (default: 50)

app.get('/events', (req: Request, res: Response) => {
  const typeFilter = req.query.type as string | undefined
  const limit = Math.min(Number(req.query.limit) || 50, MAX_STORED_EVENTS)

  let events = eventStore
  if (typeFilter) {
    events = events.filter((e) => e.event === typeFilter)
  }

  res.json({
    events: events.slice(0, limit),
    total: events.length,
    suppressed_contacts: Array.from(suppressedContacts),
  })
})

// ── GET /health ────────────────────────────────────────────────────────────
// Health check showing the handler's current state.

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    events_received: eventStore.length,
    suppressed_contacts: suppressedContacts.size,
    webhook_registered: webhookSecret !== null,
  })
})

// ── Startup ────────────────────────────────────────────────────────────────
// On boot we:
//   1. Start the Express server
//   2. Register a webhook with Pigeons for all email lifecycle events
//   3. Send a test email to trigger the event flow

async function start(): Promise<void> {
  // Start listening first so the webhook URL is reachable when Pigeons
  // begins delivering events.
  await new Promise<void>((resolve) => {
    app.listen(PORT, () => resolve())
  })

  console.log(`Webhook event handler listening on http://localhost:${PORT}`)
  console.log()
  console.log(`Endpoints:`)
  console.log(`  POST http://localhost:${PORT}/webhooks/pigeons  — receives webhook events`)
  console.log(`  GET  http://localhost:${PORT}/events             — view received events`)
  console.log(`  GET  http://localhost:${PORT}/health             — health check`)
  console.log()

  // ── Register webhook ───────────────────────────────────────────────────
  // Subscribe to all email lifecycle events. Pigeons will POST to our
  // /webhooks/pigeons endpoint whenever any of these events occur.
  //
  // The create() response includes a `secret` field — this is the only time
  // the secret is returned. Store it securely. Subsequent get() and list()
  // calls strip the secret from the response.
  try {
    const webhook = await pigeons.webhooks.create({
      url: WEBHOOK_URL,
      events: [
        'email.sent',
        'email.delivered',
        'email.bounced',
        'email.complained',
        'email.opened',
        'email.failed',
      ],
    })

    webhookSecret = webhook.secret ?? null

    console.log(`Webhook registered:`)
    console.log(`  ID:     ${webhook.id}`)
    console.log(`  URL:    ${webhook.url}`)
    console.log(`  Events: ${webhook.events.join(', ')}`)
    console.log(`  Secret: ${webhookSecret ? webhookSecret.slice(0, 12) + '...' : '(none)'}`)
    console.log()
  } catch (err) {
    if (err instanceof PigeonsError) {
      console.error(`Failed to register webhook: ${err.message} (${err.statusCode})`)
      console.error(`Make sure PIGEONS_URL and PIGEONS_API_KEY are set correctly.`)
    } else {
      console.error('Failed to register webhook:', err)
    }
    console.error()
    console.error(`You can still register manually:`)
    console.error(`  curl -X POST $PIGEONS_URL/v1/webhooks \\`)
    console.error(`    -H "x-api-key: $PIGEONS_API_KEY" \\`)
    console.error(`    -H "Content-Type: application/json" \\`)
    console.error(`    -d '{"url": "${WEBHOOK_URL}", "events": ["email.sent","email.delivered","email.bounced","email.complained","email.opened","email.failed"]}'`)
    console.error()
  }

  // ── Send test email ────────────────────────────────────────────────────
  // Send a test email to trigger the event pipeline. You should see
  // email.sent followed by email.delivered (or email.bounced/failed)
  // arrive at the webhook endpoint.
  //
  // In SES sandbox mode, you can only send to verified addresses.
  // Use the SES simulator addresses for testing:
  //   success@simulator.amazonses.com  — triggers Delivery
  //   bounce@simulator.amazonses.com   — triggers Bounce (Permanent)
  //   complaint@simulator.amazonses.com — triggers Complaint
  try {
    console.log(`Sending test email to trigger events...`)

    const email = await pigeons.emails.send({
      to: 'success@simulator.amazonses.com',
      subject: 'Webhook event handler test',
      html: '<p>This email tests the webhook event pipeline.</p>',
      text: 'This email tests the webhook event pipeline.',
      trackOpens: true,
    })

    console.log(`  Test email sent: ${email.id}`)
    console.log(`  Status: ${email.status}`)
    console.log()
    console.log(`Watch the console for incoming webhook events...`)
    console.log(`Or check http://localhost:${PORT}/events to see them.`)
    console.log()

    // To also test bounce and complaint events, uncomment these:
    //
    // const bounceTest = await pigeons.emails.send({
    //   to: 'bounce@simulator.amazonses.com',
    //   subject: 'Bounce test',
    //   text: 'Testing bounce handling.',
    // })
    // console.log(`  Bounce test sent: ${bounceTest.id}`)
    //
    // const complaintTest = await pigeons.emails.send({
    //   to: 'complaint@simulator.amazonses.com',
    //   subject: 'Complaint test',
    //   text: 'Testing complaint handling.',
    // })
    // console.log(`  Complaint test sent: ${complaintTest.id}`)
  } catch (err) {
    if (err instanceof PigeonsError) {
      console.error(`Failed to send test email: ${err.message} (${err.statusCode})`)
    } else {
      console.error('Failed to send test email:', err)
    }
    console.error(`The webhook handler is still running — send emails manually to trigger events.`)
    console.error()
  }
}

start()
