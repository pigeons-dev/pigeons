# Helpdesk Inbox

A multi-inbox helpdesk system built with FastAPI and Pigeons. Demonstrates inbox routing, automatic message labeling by keyword detection, context-aware auto-replies, and thread lifecycle management.

## What you'll learn

- Create multiple inboxes for different departments (support, billing, sales)
- Receive inbound emails via Pigeons webhooks
- Auto-label messages using keyword detection
- Send different auto-replies depending on which inbox received the email
- Manage thread status (open, closed, snoozed) for helpdesk workflows
- Build a dashboard summarizing thread counts per inbox

## Prerequisites

- Python 3.10+
- A running Pigeons instance (local or Docker)
- An API key with inbox and email scopes
- A verified domain configured for inbound email (SES receipt rule + S3 + SNS)

## Setup

```bash
cd examples/helpdesk-inbox
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your instance URL, API key, and domain:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
DOMAIN=yourapp.com
```

Register a Pigeons webhook pointing to your server. This tells Pigeons to notify your helpdesk whenever an inbound email arrives:

```bash
curl -X POST $PIGEONS_URL/v1/webhooks \
  -H "x-api-key: $PIGEONS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.example.com/webhooks/inbound",
    "events": ["inbox.message.received"]
  }'
```

For local development, use a tunnel (e.g. ngrok) to expose your FastAPI server to the internet so Pigeons can reach the webhook URL.

## Run

```bash
uvicorn main:app --reload --port 8000
```

## Architecture

```
Incoming email
    │
    ▼
Amazon SES (receipt rule)
    │
    ├──▶ S3 (stores raw MIME)
    │
    ▼
Amazon SNS
    │
    ▼
Pigeons server
    ├── Routes to matching inbox (support@, billing@, sales@)
    ├── Creates thread (or appends to existing thread)
    └── Fires inbox.message.received webhook
            │
            ▼
      This helpdesk app (POST /webhooks/inbound)
            │
            ├── Fetches full message from Pigeons
            ├── Detects labels by keyword (refund → billing, bug → technical)
            ├── Looks up inbox type (support / billing / sales)
            ├── Sends context-aware auto-reply via Pigeons
            └── Returns processing summary
```

## curl examples

**1. Create the helpdesk inboxes**

```bash
curl -X POST http://localhost:8000/setup
```

Response:

```json
{
  "support": "inb_abc123",
  "billing": "inb_def456",
  "sales": "inb_ghi789"
}
```

**2. Simulate an inbound webhook** (for testing without real email)

```bash
curl -X POST http://localhost:8000/webhooks/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "event": "inbox.message.received",
    "data": {
      "inbox_id": "inb_abc123",
      "message_id": "inm_xyz",
      "thread_id": "thr_xyz"
    }
  }'
```

**3. View the dashboard**

```bash
curl http://localhost:8000/dashboard
```

Response:

```json
{
  "inboxes": [
    {
      "inbox_id": "inb_abc123",
      "inbox_name": "Helpdesk — Support",
      "email_address": "support@example.com",
      "threads": { "open": 12, "closed": 45, "snoozed": 3 }
    }
  ],
  "total_threads": 60
}
```

**4. Close a thread**

```bash
curl -X PATCH http://localhost:8000/threads/inb_abc123/thr_xyz \
  -H "Content-Type: application/json" \
  -d '{"status": "closed"}'
```

**5. List open threads for an inbox**

```bash
curl "http://localhost:8000/threads/inb_abc123?status=open&limit=10"
```

**6. Snooze a thread with metadata**

```bash
curl -X PATCH http://localhost:8000/threads/inb_abc123/thr_xyz \
  -H "Content-Type: application/json" \
  -d '{
    "status": "snoozed",
    "metadata": { "reason": "waiting_on_customer", "snooze_until": "2025-01-15" }
  }'
```

## Code walkthrough

### Inbox setup (`POST /setup`)

Creates three inboxes via `pigeons.inboxes.create()`, each bound to a specific email address on your domain. Pigeons automatically routes inbound emails to the inbox whose `emailAddress` matches the recipient.

### Webhook handler (`POST /webhooks/inbound`)

The core of the helpdesk. When Pigeons receives an inbound email, it fires a webhook with `{ event, data: { inbox_id, message_id, thread_id } }`. The handler:

1. **Fetches the message** — the webhook payload only contains IDs to keep payloads small. We call `pigeons.inboxes.messages.get()` to read the subject and body.
2. **Detects labels** — scans for keywords like "refund" (billing), "bug" (technical), "pricing" (sales), and "urgent". A message can receive multiple labels.
3. **Sends an auto-reply** — each inbox type has its own reply template. The reply is sent via `pigeons.inboxes.messages.create()` with `inReplyTo` set so it threads correctly in the sender's email client.

### Label detection

Simple keyword matching against subject + body text. Each rule maps a list of keywords to a label. Rules are evaluated independently, so a message about an "urgent refund" gets both `urgent` and `billing` labels.

In production, you might replace this with an LLM classifier for more nuanced categorization — see the [ai-support-agent](../ai-support-agent/) example.

### Thread management

Threads are created automatically by Pigeons when a new inbound email arrives (or appended to an existing thread if the email is a reply). The helpdesk exposes two endpoints for managing thread lifecycle:

- `PATCH /threads/{inbox_id}/{thread_id}` — change status to `open`, `closed`, or `snoozed`. Optionally attach metadata (assigned agent, SLA deadline, snooze reason).
- `GET /threads/{inbox_id}` — list threads with optional status filter and cursor pagination.

### Dashboard

Aggregates thread counts per inbox by querying each status separately. Gives a quick view of helpdesk load: how many threads are open (need attention), closed (resolved), or snoozed (deferred).

## Next steps

- [ai-support-agent](../ai-support-agent/) — Replace keyword detection with an LLM that reads inbound emails and drafts replies
- [webhook-event-handler](../webhook-event-handler/) — Handle delivery, bounce, and complaint events alongside inbound
- [inbound-webhook-handler](../inbound-webhook-handler/) — Simpler single-inbox inbound processing
- Add webhook signature verification using `X-Pigeons-Signature` header and your webhook secret
- Persist the inbox registry to a database instead of in-memory
- Add assignment logic: route threads to specific agents based on labels
