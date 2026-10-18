import { NextRequest, NextResponse } from 'next/server'

// POST /api/webhooks/pigeons
//
// Receives webhook events from your Pigeons instance. Pigeons fires
// webhooks for email lifecycle events so your app can react in real time
// without polling.
//
// Supported events:
//   - email.delivered   - email accepted by the recipient's mail server
//   - email.bounced     - email bounced (hard or soft)
//   - email.complained  - recipient marked the email as spam
//   - email.opened      - recipient opened the email (requires open tracking)
//
// Setup:
//   1. Register a webhook in Pigeons pointing to this URL:
//        POST /v1/webhooks
//        { "url": "https://yourapp.com/api/webhooks/pigeons",
//          "events": ["email.delivered", "email.bounced", "email.complained", "email.opened"],
//          "secret": "whsec_..." }
//   2. Set WEBHOOK_SECRET in your .env to the same secret.
//   3. In production, verify the webhook signature to prevent spoofing.
//
// Security: In production, you should verify the webhook signature
// using HMAC-SHA256. Pigeons signs each payload with your webhook secret
// and includes the signature in the X-Pigeons-Signature header.
// This example logs the events for simplicity  - add signature
// verification before deploying.

// In-memory event log for demonstration purposes.
// In production, write events to your database.
const recentEvents: Array<{
  event: string
  emailId: string
  receivedAt: string
  data: Record<string, unknown>
}> = []

// Cap the in-memory log so it doesn't grow unbounded
const MAX_EVENTS = 1000

interface WebhookPayload {
  event: string
  data: {
    email_id: string
    to?: string
    subject?: string
    bounce_type?: string
    timestamp?: string
    [key: string]: unknown
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as WebhookPayload
    const { event, data } = payload

    if (!event || !data) {
      return NextResponse.json(
        { error: 'invalid webhook payload' },
        { status: 400 },
      )
    }

    // Production: verify the webhook signature before processing.
    // const signature = request.headers.get('x-pigeons-signature')
    // const secret = process.env.WEBHOOK_SECRET
    // if (!verifySignature(payload, signature, secret)) {
    //   return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
    // }

    // Route the event to the appropriate handler.
    // Each handler updates your internal state  - in a real app,
    // these would write to your database, update user records,
    // trigger alerts, etc.
    switch (event) {
      case 'email.delivered':
        handleDelivered(data)
        break

      case 'email.bounced':
        handleBounced(data)
        break

      case 'email.complained':
        handleComplained(data)
        break

      case 'email.opened':
        handleOpened(data)
        break

      default:
        // Log unknown events but don't reject them  - Pigeons may add
        // new event types in the future, and returning a non-2xx would
        // trigger retries.
        console.log(`[webhook] unknown event: ${event}`)
    }

    // Store the event for the dashboard stats endpoint
    recentEvents.unshift({
      event,
      emailId: data.email_id,
      receivedAt: new Date().toISOString(),
      data,
    })

    // Trim the log
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.length = MAX_EVENTS
    }

    // Always return 200 quickly. Pigeons will retry on non-2xx responses,
    // so do your heavy processing asynchronously if needed.
    return NextResponse.json({ received: true })
  } catch (err) {
    // Even on parse errors, return 200 to prevent infinite retries.
    // Log the error for investigation.
    console.error('[webhook] failed to process event:', err)
    return NextResponse.json({ received: true })
  }
}

// ── Event handlers ──────────────────────────────────────────────────────

function handleDelivered(data: WebhookPayload['data']) {
  // Email was accepted by the recipient's mail server.
  // This is the happy path  - update your UI to show "delivered".
  console.log(
    `[webhook] delivered: ${data.email_id} to ${data.to}`,
  )
}

function handleBounced(data: WebhookPayload['data']) {
  // Email bounced. bounce_type is "Permanent" (hard) or "Transient" (soft).
  // Hard bounces: mark the contact as bounced, stop sending to them.
  // Soft bounces: Pigeons retries automatically, but repeated soft bounces
  // may indicate a problem.
  console.log(
    `[webhook] bounced: ${data.email_id} (${data.bounce_type || 'unknown type'})`,
  )

  // In production:
  // if (data.bounce_type === 'Permanent') {
  //   await db.update(contacts).set({ bounced: true }).where(eq(contacts.email, data.to))
  // }
}

function handleComplained(data: WebhookPayload['data']) {
  // Recipient marked the email as spam. This is serious  - continued
  // sends to complainers will damage your sender reputation.
  // Immediately suppress this contact from all future sends.
  console.log(
    `[webhook] complained: ${data.email_id} from ${data.to}`,
  )

  // In production:
  // await pigeons.contacts.unsubscribe(data.to)
  // await db.update(contacts).set({ complained: true }).where(eq(contacts.email, data.to))
}

function handleOpened(data: WebhookPayload['data']) {
  // Recipient opened the email (tracking pixel was loaded).
  // Open tracking must be enabled on your Pigeons instance
  // (PIGEONS_OPEN_TRACKING=true) and per-email via trackOpens: true.
  // Note: open tracking is not 100% reliable due to email client
  // privacy features (e.g. Apple Mail Privacy Protection).
  console.log(
    `[webhook] opened: ${data.email_id}`,
  )
}
