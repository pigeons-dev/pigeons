# Inbound Webhook Handler

Receive inbound emails via webhooks and send auto-replies using the Pigeons TypeScript SDK.

## What you'll learn

- Receive `inbox.message.received` webhook events when emails arrive at your inbox
- Parse the webhook payload and fetch full message content (sender, subject, body, attachments)
- Send threaded auto-replies using `inReplyTo` to maintain email conversations
- List inbox messages and conversation threads via the Pigeons API

## Prerequisites

- Node.js 20+
- A running Pigeons instance with **inbound email configured** (SES receipt rule, S3 bucket, SNS topic)
- An API key with inbox read/write scopes
- An inbox created in Pigeons (you'll need the inbox ID)

If you haven't set up inbound email yet, see the [Pigeons deployment guide](https://pigeons.dev/docs/inbound-email) for SES receipt rule and S3 configuration.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your instance URL, API key, and inbox ID:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
PORT=4001
INBOX_ID=inb_...
```

## Run

```bash
npx tsx src/index.ts
```

Expected output:

```
Inbound webhook handler listening on http://localhost:4001
Monitoring inbox: inb_abc123

Endpoints:
  POST http://localhost:4001/webhooks/inbound  — receives webhook events
  GET  http://localhost:4001/messages           — list inbox messages
  GET  http://localhost:4001/threads            — list inbox threads

Register this webhook URL in Pigeons:
  curl -X POST $PIGEONS_URL/v1/webhooks \
    -H "x-api-key: $PIGEONS_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"url": "http://localhost:4001/webhooks/inbound", "events": ["inbox.message.received"]}'
```

## Register the webhook in Pigeons

Before your handler can receive events, register it as a webhook endpoint. Use the CLI, SDK, or a direct API call:

**Via curl:**

```bash
curl -X POST $PIGEONS_URL/v1/webhooks \
  -H "x-api-key: $PIGEONS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:4001/webhooks/inbound",
    "events": ["inbox.message.received"]
  }'
```

**Via the SDK:**

```typescript
const webhook = await pigeons.webhooks.create({
  url: 'http://localhost:4001/webhooks/inbound',
  events: ['inbox.message.received'],
})
console.log(`Webhook registered: ${webhook.id}`)
console.log(`Secret: ${webhook.secret}`) // save this for signature verification
```

The response includes a `secret` — save it if you want to verify webhook signatures in production.

For local development, use a tunnel (ngrok, Cloudflare Tunnel, etc.) so Pigeons can reach your localhost:

```bash
ngrok http 4001
# Then register the ngrok URL as the webhook URL instead of localhost
```

## Testing

Send a test email to your inbox's email address. If your inbox is configured at `support@yourdomain.com`:

```bash
# From any email client, send a message to support@yourdomain.com
# Or use the Pigeons SDK to send a test email to the inbox address:
await pigeons.emails.send({
  to: 'support@yourdomain.com',
  subject: 'Test inbound email',
  text: 'Hello, this is a test message!',
})
```

Your handler should log:

```
--- New inbound email ---
  Inbox:   inb_abc123
  Message: inm_def456
  Thread:  thr_ghi789
  From:    sender@example.com
  To:      support@yourdomain.com
  Subject: Test inbound email
  Preview: Hello, this is a test message!
  Reply sent: inm_jkl012
---
```

You can also check messages and threads via the API:

```bash
# List recent messages
curl http://localhost:4001/messages

# Filter by direction
curl http://localhost:4001/messages?direction=inbound

# List conversation threads
curl http://localhost:4001/threads

# Filter by thread status
curl http://localhost:4001/threads?status=open
```

## Code walkthrough

### Webhook endpoint (`POST /webhooks/inbound`)

Pigeons fires an `inbox.message.received` webhook when a new email arrives at an inbox. The webhook payload contains only IDs:

```json
{
  "event": "inbox.message.received",
  "data": {
    "inbox_id": "inb_...",
    "message_id": "inm_...",
    "thread_id": "thr_..."
  }
}
```

The handler fetches the full message using `pigeons.inboxes.messages.get()`, which returns the sender, subject, body (HTML and plain text), extracted reply content (with quoted text stripped), and any attachments.

### Auto-reply with threading

The auto-reply uses `pigeons.inboxes.messages.create()` with the `inReplyTo` field set to the original message ID. This tells Pigeons to:

1. Link the reply to the same conversation thread
2. Set the correct `In-Reply-To` and `References` email headers
3. Ensure the recipient's email client threads the reply with their original message

Without `inReplyTo`, the reply would start a new, disconnected thread.

### Message listing (`GET /messages`)

Lists messages from the inbox with optional filters:
- `direction` — `inbound` (received) or `outbound` (sent from inbox)
- `threadId` — only messages in a specific thread
- `limit` / `cursor` — cursor-based pagination

### Thread listing (`GET /threads`)

Lists conversation threads with optional filters:
- `status` — `open`, `closed`, or `snoozed`
- `limit` / `cursor` — cursor-based pagination

Each thread includes the subject, participants, message count, and timestamps.

### Inbound email pipeline

The full path an inbound email takes to reach your webhook:

1. Someone sends an email to your domain (e.g. `support@yourdomain.com`)
2. SES receives it via a receipt rule configured for your domain
3. SES stores the raw MIME message in S3 and notifies via SNS
4. Pigeons receives the SNS notification at `/v1/internal/ses/inbound`
5. Pigeons fetches the raw email from S3, parses it (MIME, attachments, headers)
6. Pigeons routes it to the matching inbox by email address (or catch-all)
7. Pigeons resolves or creates a conversation thread using `In-Reply-To`/`References` headers
8. Pigeons stores the message and fires `inbox.message.received` webhooks
9. Your handler receives the webhook and takes action

## Webhook headers

Pigeons sends these headers with each webhook delivery:

| Header | Description |
|---|---|
| `X-Pigeons-Event` | Event type (e.g. `inbox.message.received`) |
| `X-Pigeons-Delivery` | Unique delivery ID (`whd_...`) for deduplication |
| `X-Pigeons-Signature` | HMAC-SHA256 hex digest of the body, signed with your webhook secret |

To verify signatures in production:

```typescript
import { createHmac } from 'node:crypto'

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex')
  return expected === signature
}
```

## Next steps

- [helpdesk-inbox](../helpdesk-inbox/) — Build a full helpdesk with ticket routing and status management
- [mcp-claude-agent](../mcp-claude-agent/) — Let an LLM agent read and reply to emails via MCP tools
