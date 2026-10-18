/**
 * Inbound Webhook Handler
 *
 * An Express server that receives inbound email webhook events from Pigeons
 * and sends auto-reply acknowledgements. Demonstrates:
 *
 *   1. Receiving webhook events when emails arrive at a Pigeons inbox
 *   2. Fetching the full message content from the inbox messages API
 *   3. Sending auto-replies with proper threading (inReplyTo)
 *   4. Listing recent messages and conversation threads
 *
 * How the inbound email pipeline works:
 *
 *   Sender's email client
 *     -> SES receipt rule (receives mail for your domain)
 *     -> S3 (stores the raw MIME message)
 *     -> SNS notification
 *     -> Pigeons /v1/internal/ses/inbound endpoint
 *     -> Pigeons processes the email: parses MIME, routes to inbox, resolves thread
 *     -> Pigeons fires webhooks to your registered URL (this server)
 *     -> Your handler fetches the full message and takes action
 *
 * Run: npx tsx src/index.ts
 */

import express, { type Request, type Response } from 'express'
import { Pigeons, PigeonsError } from '@pigeons/pigeons-ts'

// ── Configuration ──────────────────────────────────────────────────────────
// The Pigeons client reads PIGEONS_URL and PIGEONS_API_KEY from the
// environment. In production, set these via your deployment's secret management.

const pigeons = new Pigeons()

const INBOX_ID = process.env.INBOX_ID
if (!INBOX_ID) {
  console.error('Missing INBOX_ID environment variable')
  process.exit(1)
}

// ── Express app ────────────────────────────────────────────────────────────

const app = express()

// Pigeons delivers webhooks as JSON with Content-Type: application/json.
// However, if you're also handling raw SNS notifications upstream, those
// arrive as text/plain with a JSON body. Accept both content types to
// ensure compatibility across the full notification pipeline.
app.use(express.json({ type: ['application/json', 'text/plain'] }))

// ── Webhook payload types ──────────────────────────────────────────────────
// Pigeons fires a POST request to your registered webhook URL whenever a
// matching event occurs. The payload shape is:
//
//   {
//     "event": "inbox.message.received",
//     "data": {
//       "inbox_id": "inb_...",     // the inbox that received the email
//       "message_id": "inm_...",   // the stored message ID
//       "thread_id": "thr_..."     // the conversation thread ID
//     }
//   }
//
// The webhook payload contains only IDs, not the full message content.
// This keeps payloads small and avoids transmitting potentially large
// email bodies over the wire. Fetch the full message using the SDK
// when your handler needs the content.
//
// Pigeons also sends these headers with each webhook delivery:
//   X-Pigeons-Event:     the event type (e.g. "inbox.message.received")
//   X-Pigeons-Delivery:  unique delivery ID (whd_...) for deduplication
//   X-Pigeons-Signature: HMAC-SHA256 of the body, signed with your webhook secret

interface InboundWebhookPayload {
  event: 'inbox.message.received'
  data: {
    inbox_id: string
    message_id: string
    thread_id: string
  }
}

// ── POST /webhooks/inbound ─────────────────────────────────────────────────
// Receives inbound email webhook events from Pigeons.
//
// When a new email arrives at your inbox, Pigeons processes it and fires
// an "inbox.message.received" webhook. This handler:
//   1. Validates the event type
//   2. Fetches the full message content from the Pigeons API
//   3. Logs the sender, subject, and a preview of the body
//   4. If the email has attachments, logs their filenames and sizes
//   5. Sends an auto-reply that threads properly with the original email
//
// In production, you would also verify the X-Pigeons-Signature header
// using HMAC-SHA256 with your webhook secret to ensure the request
// genuinely originated from your Pigeons instance.

app.post('/webhooks/inbound', async (req: Request, res: Response) => {
  const payload = req.body as InboundWebhookPayload

  // Verify this is an inbound message event. Pigeons fires different
  // event types (email.delivered, email.bounced, etc.)  - ignore any
  // that aren't inbound messages.
  if (payload.event !== 'inbox.message.received') {
    console.log(`Ignoring event: ${payload.event}`)
    res.json({ received: true, handled: false })
    return
  }

  const { inbox_id, message_id, thread_id } = payload.data

  console.log('\n--- New inbound email ---')
  console.log(`  Inbox:   ${inbox_id}`)
  console.log(`  Message: ${message_id}`)
  console.log(`  Thread:  ${thread_id}`)

  try {
    // Fetch the full message content. The webhook payload only contains
    // IDs to keep the delivery payload small. Use the inbox messages API
    // to get the sender, subject, body, and attachments.
    const message = await pigeons.inboxes.messages.get(inbox_id, message_id)

    console.log(`  From:    ${message.from}`)
    console.log(`  To:      ${message.to.join(', ')}`)
    console.log(`  Subject: ${message.subject}`)

    // Show a preview of the email body. Prefer the extracted text (which
    // strips quoted reply content) over the full text, so you see only
    // the new content the sender wrote.
    const bodyPreview = (message.extractedText ?? message.text ?? '(no text body)')
      .slice(0, 200)
      .replace(/\n/g, ' ')
    console.log(`  Preview: ${bodyPreview}`)

    // Log attachments if present. Each attachment includes the filename,
    // MIME content type, and size in bytes. The actual file content is
    // stored in S3  - use the attachment URL to download it.
    if (message.attachments && message.attachments.length > 0) {
      console.log(`  Attachments:`)
      for (const att of message.attachments) {
        const sizeKB = (att.size / 1024).toFixed(1)
        console.log(`    - ${att.filename} (${att.contentType}, ${sizeKB} KB)`)
      }
    }

    // ── Send an auto-reply ───────────────────────────────────────────────
    // Use pigeons.inboxes.messages.create() to send a reply from the inbox.
    // The critical field is `inReplyTo`, which takes the original message ID.
    //
    // How threading works:
    //   When you set `inReplyTo` to the original message's ID, Pigeons:
    //   1. Links the reply to the same thread (thr_...) as the original
    //   2. Sets the email's In-Reply-To and References headers correctly
    //   3. The recipient's email client groups the reply in the same
    //      conversation thread as their original message
    //
    // Without `inReplyTo`, the reply would start a new thread instead of
    // continuing the existing conversation.

    const reply = await pigeons.inboxes.messages.create(inbox_id, {
      to: message.from,
      subject: `Re: ${message.subject}`,
      text: [
        `Thank you for your email. We received your message and will get back to you shortly.`,
        ``,
        `--- Original message ---`,
        `From: ${message.from}`,
        `Subject: ${message.subject}`,
        ``,
        bodyPreview,
      ].join('\n'),
      html: [
        `<p>Thank you for your email. We received your message and will get back to you shortly.</p>`,
        `<hr/>`,
        `<p style="color: #666; font-size: 0.9em;">`,
        `<strong>Original message from ${message.from}:</strong><br/>`,
        `Subject: ${message.subject}<br/><br/>`,
        `${(message.extractedHtml ?? message.html ?? bodyPreview).slice(0, 500)}`,
        `</p>`,
      ].join('\n'),
      inReplyTo: message_id,
    })

    console.log(`  Reply sent: ${reply.id}`)
    console.log('---\n')

    res.json({ received: true, handled: true, replyId: reply.id })
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── GET /messages ──────────────────────────────────────────────────────────
// Lists recent messages from the monitored inbox.
//
// Supports optional query parameters:
//   ?limit=10           - number of messages to return (default 25, max 100)
//   ?direction=inbound  - filter by direction: "inbound" or "outbound"
//   ?threadId=thr_...   - filter messages within a specific thread
//
// The response uses cursor-based pagination. When `has_more` is true,
// pass the `next_cursor` value as `?cursor=...` to fetch the next page.

app.get('/messages', async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined
  const direction = req.query.direction as 'inbound' | 'outbound' | undefined
  const threadId = req.query.threadId as string | undefined
  const cursor = req.query.cursor as string | undefined

  try {
    const result = await pigeons.inboxes.messages.list(INBOX_ID, {
      limit,
      direction,
      threadId,
      cursor,
    })

    console.log(`Listed ${result.data.length} messages (has_more: ${result.has_more})`)

    res.json(result)
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── GET /threads ───────────────────────────────────────────────────────────
// Lists conversation threads from the monitored inbox.
//
// Each thread groups related messages (original + replies) together.
// Threads are created automatically by Pigeons when inbound emails arrive.
// Reply detection uses the In-Reply-To and References email headers.
//
// Supports optional query parameters:
//   ?limit=10          - number of threads to return (default 25, max 100)
//   ?status=open       - filter by thread status: "open", "closed", "snoozed"
//
// The response includes each thread's subject, participant list, message
// count, and timestamps  - useful for building an inbox UI.

app.get('/threads', async (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined
  const status = req.query.status as 'open' | 'closed' | 'snoozed' | undefined
  const cursor = req.query.cursor as string | undefined

  try {
    const result = await pigeons.inboxes.threads.list(INBOX_ID, {
      limit,
      status,
      cursor,
    })

    console.log(`Listed ${result.data.length} threads (has_more: ${result.has_more})`)

    res.json(result)
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── Error handling helper ──────────────────────────────────────────────────
// The SDK throws typed PigeonsError for HTTP failures. Map them to
// appropriate status codes for the API consumer.

function handlePigeonsError(res: Response, err: unknown): void {
  if (err instanceof PigeonsError) {
    console.error(`Pigeons API error: ${err.message} (${err.statusCode})`)
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    })
    return
  }

  console.error('Unexpected error:', err)
  res.status(500).json({ error: 'Internal server error' })
}

// ── Start ──────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 4001

app.listen(port, () => {
  console.log(`Inbound webhook handler listening on http://localhost:${port}`)
  console.log(`Monitoring inbox: ${INBOX_ID}`)
  console.log()
  console.log(`Endpoints:`)
  console.log(`  POST http://localhost:${port}/webhooks/inbound   - receives webhook events`)
  console.log(`  GET  http://localhost:${port}/messages            - list inbox messages`)
  console.log(`  GET  http://localhost:${port}/threads             - list inbox threads`)
  console.log()
  console.log(`Register this webhook URL in Pigeons:`)
  console.log(`  curl -X POST $PIGEONS_URL/v1/webhooks \\`)
  console.log(`    -H "x-api-key: $PIGEONS_API_KEY" \\`)
  console.log(`    -H "Content-Type: application/json" \\`)
  console.log(`    -d '{"url": "http://localhost:${port}/webhooks/inbound", "events": ["inbox.message.received"]}'`)
})
