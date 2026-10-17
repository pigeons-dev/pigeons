# Webhook Event Handler

Handle email delivery lifecycle events from Pigeons — delivery confirmations, bounces, complaints, opens, and failures — with an Express webhook server.

## What you'll learn

- Register a webhook endpoint programmatically via the TypeScript SDK
- Receive and verify webhook event signatures (HMAC-SHA256)
- Route events to typed handlers based on event type
- Handle bounces correctly: suppress hard bounces, monitor soft bounces
- Handle complaints: immediately and permanently suppress the contact
- Track email opens with caveats (image blocking, privacy proxies)
- Implement idempotent event processing using delivery IDs
- Use SES simulator addresses to trigger each event type in sandbox mode

## Prerequisites

- Node.js 20+
- A running Pigeons instance with SES configured (outbound email working)
- An API key with email send and webhook management scopes

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your instance URL and API key:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
WEBHOOK_PORT=4000
```

### Local development with ngrok

Pigeons needs to reach your webhook server over the network. For local development, use a tunnel:

```bash
ngrok http 4000
```

Copy the HTTPS URL ngrok gives you and set it as an environment variable:

```bash
export WEBHOOK_URL=https://abc123.ngrok.io/webhooks/pigeons
```

The server uses `WEBHOOK_URL` when registering the webhook with Pigeons. If not set, it defaults to `http://localhost:4000/webhooks/pigeons` (which only works if Pigeons runs on the same machine).

## Run

```bash
npx tsx src/index.ts
```

Expected output:

```
Webhook event handler listening on http://localhost:4000

Endpoints:
  POST http://localhost:4000/webhooks/pigeons  — receives webhook events
  GET  http://localhost:4000/events             — view received events
  GET  http://localhost:4000/health             — health check

Webhook registered:
  ID:     whk_abc123
  URL:    https://abc123.ngrok.io/webhooks/pigeons
  Events: email.sent, email.delivered, email.bounced, email.complained, email.opened, email.failed
  Secret: whsec_a1b2c3...

Sending test email to trigger events...
  Test email sent: msg_def456
  Status: queued

Watch the console for incoming webhook events...
```

Within a few seconds, you should see events arriving:

```
--- Webhook received ---
  Event:    email.sent
  Delivery: whd_111
  Signature: verified
  [sent] Email msg_def456 accepted and queued for delivery
  Action: logged: email queued for SES delivery
---

--- Webhook received ---
  Event:    email.delivered
  Delivery: whd_222
  Signature: verified
  [delivered] Email msg_def456 successfully delivered
  Action: logged: delivery confirmed, status updated
---
```

## Event types

| Event | When it fires | What to do |
|---|---|---|
| `email.sent` | Pigeons accepts the email and queues it for SES delivery | Log for audit trail; update status to "sending" |
| `email.delivered` | SES confirms the recipient's server accepted the email | Update status to "delivered"; show confirmation in UI |
| `email.bounced` | The recipient's server rejects the email | **Hard bounce**: suppress contact immediately. **Soft bounce**: log and monitor |
| `email.complained` | The recipient clicks "Report Spam" in their email client | Suppress contact immediately and permanently |
| `email.opened` | The recipient's email client loads the tracking pixel (first open only) | Track engagement; useful for A/B testing and segmentation |
| `email.failed` | Pigeons cannot send the email at all (SES rejection, invalid sender, etc.) | Alert ops team; investigate root cause |

## Architecture

```
                                 Your Application
                                 ----------------
                                        |
                                   emails.send()
                                        |
                                        v
+-------------------+           +-------------------+
|   Your Webhook    |           |     Pigeons       |
|   Handler         |<----------|     Server        |
|   (this server)   |  webhook  |                   |
+-------------------+  POST     +-------------------+
  |                                     |
  |-- handleEmailSent()                 |-- Queue email
  |-- handleEmailDelivered()            |-- Send via SES
  |-- handleEmailBounced()              |-- Process SES events
  |   |-- suppress hard bounces         |-- Fire webhooks
  |-- handleEmailComplained()           |
  |   |-- suppress contact              |
  |-- handleEmailOpened()            +-------------------+
  |-- handleEmailFailed()            |     Amazon SES    |
  |                                  +-------------------+
  v                                     |
 In-memory event store                  |-- Delivery notification
 (or your database)                     |-- Bounce notification
                                        |-- Complaint feedback loop
```

## Code walkthrough

### Webhook registration

On startup, the server calls `pigeons.webhooks.create()` to register its endpoint for all email lifecycle events:

```typescript
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
```

The response includes a `secret` (e.g., `whsec_...`) used to verify webhook signatures. This secret is only returned on `create()` — subsequent `get()` and `list()` calls strip it.

### Signature verification

Every webhook delivery includes an `X-Pigeons-Signature` header containing an HMAC-SHA256 hex digest of the raw JSON body:

```typescript
const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
```

The server captures the raw request body before JSON parsing (via the `verify` callback in `express.json()`) because `JSON.stringify(parsedBody)` can produce different bytes than the original payload due to key ordering.

### Event routing

The webhook handler uses a switch on `payload.event` to dispatch to typed handler functions. Each handler logs what happened and returns an action string describing what it did:

- **`email.delivered`** — Log success, update internal status
- **`email.bounced`** — Check bounce type; hard bounces trigger immediate contact suppression
- **`email.complained`** — Immediate permanent suppression (complaints are the most damaging signal)
- **`email.opened`** — Log the open timestamp for engagement tracking
- **`email.failed`** — Log the error for investigation

### Idempotency

Pigeons retries webhook deliveries on failure (up to 3 attempts with exponential backoff: 1m, 5m, 15m). Each delivery has a unique ID in the `X-Pigeons-Delivery` header. The handler tracks processed IDs in a `Set` and skips duplicates:

```typescript
if (deliveryId && processedDeliveries.has(deliveryId)) {
  res.json({ received: true, duplicate: true })
  return
}
```

In production, store processed delivery IDs in your database with a TTL (e.g., 24 hours).

### Event inspection

The `GET /events` endpoint returns recent events from the in-memory store, including the suppression list:

```bash
# All recent events
curl http://localhost:4000/events

# Filter by type
curl http://localhost:4000/events?type=email.bounced

# Limit results
curl http://localhost:4000/events?limit=5
```

## Testing with SES simulator

In SES sandbox mode, use these simulator addresses to trigger specific event types:

| Address | Event triggered |
|---|---|
| `success@simulator.amazonses.com` | `email.delivered` |
| `bounce@simulator.amazonses.com` | `email.bounced` (Permanent) |
| `complaint@simulator.amazonses.com` | `email.complained` |

Uncomment the bounce and complaint test sends in `src/index.ts` to exercise all paths.

## Production considerations

### Respond quickly

Pigeons has a 10-second timeout on webhook deliveries. If your processing takes longer, accept the event (return 200), enqueue it, and process asynchronously. Never do slow work (database writes, external API calls) synchronously in the handler.

### Persistent idempotency

The in-memory `Set` for deduplication is lost on restart. In production, store delivery IDs in your database with a TTL index. A simple approach:

```sql
CREATE TABLE webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Clean up after 24 hours via a cron job or TTL index
```

### Suppression list

The in-memory suppression list is a demo. In production, integrate with your contacts database. Before every send, check that the recipient is not suppressed. The Pigeons server also maintains its own suppression via the contacts API (`bounced`, `unsubscribed` flags), but defense in depth is good practice.

### Monitoring and alerting

Track your bounce and complaint rates:
- **Bounce rate**: SES review threshold is 5%. Keep well below.
- **Complaint rate**: SES threshold is 0.1%. This is the most critical metric.

Set up alerts when rates exceed your thresholds. The `GET /events` endpoint or your database can provide the data.

### Retry behavior

Pigeons retries failed deliveries up to 3 times with exponential backoff (1m, 5m, 15m). After 10 consecutive failures across all deliveries, the webhook is automatically disabled. Monitor webhook status via `pigeons.webhooks.list()` and re-enable with `pigeons.webhooks.update(id, { status: 'active' })` after fixing the issue.

## Next steps

- [inbound-webhook-handler](../inbound-webhook-handler/) — Handle incoming emails with auto-replies and threading
- [delivery-monitor](../delivery-monitor/) — Poll delivery stats and track sender reputation metrics
- [campaign-send](../campaign-send/) — Send campaigns and monitor delivery with webhooks
