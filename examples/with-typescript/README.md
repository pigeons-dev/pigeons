# Quick Start — TypeScript

Send your first email with the Pigeons TypeScript SDK in under 5 minutes.

## What you'll learn

- Initialize the `Pigeons` client with environment variables
- Send a transactional email
- Check delivery status by email ID
- List recent emails with cursor-based pagination

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your instance URL and API key:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
```

## Run

```bash
npx tsx src/index.ts
```

Expected output:

```
Sending email...

  Email sent!
  ID:     msg_abc123
  Status: queued
  To:     recipient@example.com

Checking delivery status...

  Current status: delivered
  SES Message ID: 0100018a...

Listing recent emails...

  msg_abc123  delivered   Hello from Pigeons

Done!
```

## Code walkthrough

The example covers three SDK methods:

1. **`pigeons.emails.send()`** — Queues an email for delivery. Returns immediately with the email object (status: `queued`). The background worker picks it up and sends it through SES.

2. **`pigeons.emails.get(id)`** — Fetches the current state of an email by ID. Status progresses through: `queued` → `sending` → `sent` → `delivered`. If something goes wrong: `bounced`, `complained`, or `failed`.

3. **`pigeons.emails.list()`** — Returns a paginated list of emails. Supports filtering by `status`, `limit`, and `cursor` for pagination.

## Next steps

- [with-python](../with-python/) — Same flow in Python
- [with-curl](../with-curl/) — Raw HTTP calls without an SDK
- [email-templates](../email-templates/) — Use React Email templates instead of inline HTML
- [webhook-event-handler](../webhook-event-handler/) — Get delivery/bounce/complaint events in real-time instead of polling
