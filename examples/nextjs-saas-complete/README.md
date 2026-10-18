# Next.js SaaS Complete

A comprehensive Next.js App Router example showing every email integration pattern a production SaaS app needs: authentication emails, transactional sends with idempotency, contact management, campaigns, webhook event handling, and an admin stats dashboard. This is the capstone example that ties together patterns from all the other examples into one cohesive app.

## What you'll learn

- Send authentication emails (welcome, password reset) with templates
- Send transactional emails with idempotency keys to prevent duplicates
- Check email delivery status by ID
- Create and manage contacts with tags for audience segmentation
- Create and send campaigns to tagged audiences
- Receive webhook events (delivered, bounced, complained, opened) in real time
- Build a stats dashboard with delivery rates, bounce rates, and campaign metrics
- Map Pigeons SDK errors to proper HTTP responses in every route
- Structure a production-quality email integration in Next.js App Router

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with `emails:send`, `contacts:read`, `contacts:write`, `campaigns:read`, `campaigns:write`, `stats:read`, and `webhooks:write` scopes

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` with your instance URL, API key, and app URL:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
WEBHOOK_SECRET=whsec_...
```

### Create templates

The auth routes use templates. Create them in your Pigeons instance:

**welcome** template:
```json
{
  "slug": "welcome",
  "name": "Welcome Email",
  "subject": "Welcome to YourApp, {{name}}!",
  "body": "<h2>Welcome, {{name}}!</h2><p>Your account is ready. <a href=\"{{loginUrl}}\">Log in now</a>.</p>"
}
```

**password-reset** template:
```json
{
  "slug": "password-reset",
  "name": "Password Reset",
  "subject": "Reset your password",
  "body": "<h2>Hi {{name}},</h2><p>Click below to reset your password:</p><p><a href=\"{{resetUrl}}\">Reset password</a></p><p>This link expires in {{expiresIn}}.</p>"
}
```

Create them via curl:

```bash
curl -X POST http://localhost:3891/v1/templates \
  -H "x-api-key: pgn_..." \
  -H "Content-Type: application/json" \
  -d '{"slug": "welcome", "name": "Welcome Email", "subject": "Welcome, {{name}}!", "body": "<h2>Welcome, {{name}}!</h2><p><a href=\"{{loginUrl}}\">Log in</a></p>"}'

curl -X POST http://localhost:3891/v1/templates \
  -H "x-api-key: pgn_..." \
  -H "Content-Type: application/json" \
  -d '{"slug": "password-reset", "name": "Password Reset", "subject": "Reset your password", "body": "<h2>Hi {{name}},</h2><p><a href=\"{{resetUrl}}\">Reset password</a> (expires in {{expiresIn}})</p>"}'
```

### Register a webhook

Register a webhook so Pigeons sends delivery events to your app:

```bash
curl -X POST http://localhost:3891/v1/webhooks \
  -H "x-api-key: pgn_..." \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000/api/webhooks/pigeons", "events": ["email.delivered", "email.bounced", "email.complained", "email.opened"], "secret": "whsec_..."}'
```

## Run

```bash
npm run dev
```

The app starts at `http://localhost:3000`. Hit the API routes with curl:

```bash
# Send a welcome email on signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice"}'

# Send a password reset email
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice"}'

# Send a transactional email with idempotency
curl -X POST http://localhost:3000/api/emails/send \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123-receipt" \
  -d '{"to": "user@example.com", "templateId": "receipt", "data": {"orderId": "123", "total": "$49.99"}}'

# Check email delivery status
curl http://localhost:3000/api/emails/msg_abc123

# Create a contact
curl -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "firstName": "Alice", "tags": ["beta", "product-updates"]}'

# List contacts filtered by tag
curl "http://localhost:3000/api/contacts?tag=beta&limit=20"

# Update a contact
curl -X PATCH http://localhost:3000/api/contacts/ctc_abc123 \
  -H "Content-Type: application/json" \
  -d '{"tags": ["beta", "product-updates", "enterprise"]}'

# Create and send a campaign
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "Launch Announcement", "templateId": "launch", "audienceTag": "beta"}'

# List campaigns with stats
curl "http://localhost:3000/api/campaigns?status=sent"

# View dashboard stats
curl http://localhost:3000/api/dashboard/stats
```

## Architecture overview

```
Next.js App (localhost:3000)
├── src/lib/pigeons.ts           Singleton Pigeons SDK client
│
├── Auth emails
│   ├── POST /api/auth/signup           → pigeons.contacts.create + pigeons.emails.send
│   └── POST /api/auth/forgot-password  → pigeons.emails.send (template: password-reset)
│
├── Transactional emails
│   ├── POST /api/emails/send           → pigeons.emails.send (template or inline HTML)
│   └── GET  /api/emails/:id            → pigeons.emails.get (delivery status)
│
├── Contacts
│   ├── GET    /api/contacts            → pigeons.contacts.list (paginated, tag filter)
│   ├── POST   /api/contacts            → pigeons.contacts.create
│   ├── GET    /api/contacts/:id        → pigeons.contacts.get
│   ├── PATCH  /api/contacts/:id        → pigeons.contacts.update
│   └── DELETE /api/contacts/:id        → pigeons.contacts.delete
│
├── Campaigns
│   ├── GET  /api/campaigns             → pigeons.campaigns.list (with stats)
│   └── POST /api/campaigns             → pigeons.campaigns.create + pigeons.campaigns.send
│
├── Webhooks
│   └── POST /api/webhooks/pigeons      ← Pigeons fires events here
│       Handles: email.delivered, email.bounced, email.complained, email.opened
│
└── Dashboard
    └── GET /api/dashboard/stats        → pigeons.stats.get + pigeons.campaigns.list
        Returns: delivery/bounce/complaint/open rates, top domains, recent campaigns

Pigeons Instance (localhost:3891)
├── Stores emails, contacts, templates, campaigns
├── Sends via AWS SES
├── Tracks delivery events via SES → SNS → Pigeons
└── Fires webhooks to your app on email lifecycle events
```

## API routes reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Create contact + send welcome email |
| POST | `/api/auth/forgot-password` | Send password reset email |
| POST | `/api/emails/send` | Send transactional email (template or HTML) |
| GET | `/api/emails/:id` | Get email delivery status |
| GET | `/api/contacts` | List contacts (paginated, tag filter) |
| POST | `/api/contacts` | Create a contact |
| GET | `/api/contacts/:id` | Get a contact by ID or email |
| PATCH | `/api/contacts/:id` | Update contact tags/properties |
| DELETE | `/api/contacts/:id` | Delete a contact |
| GET | `/api/campaigns` | List campaigns with stats |
| POST | `/api/campaigns` | Create and send a campaign |
| POST | `/api/webhooks/pigeons` | Receive Pigeons webhook events |
| GET | `/api/dashboard/stats` | Aggregated email health metrics |

## Code walkthrough

### Client initialization (`src/lib/pigeons.ts`)

Creates a singleton `Pigeons` client that reads `PIGEONS_URL` and `PIGEONS_API_KEY` from environment variables. The client is imported by every API route. The SDK handles auth headers (`x-api-key`) and error mapping automatically.

### Auth emails (`src/app/api/auth/`)

The signup route demonstrates a two-step pattern common in SaaS apps: first create a contact (so the user is part of your audience for future campaigns), then send the welcome email. It gracefully handles the case where the contact already exists (409) by catching and continuing. The forgot-password route sends a template-based reset email with a generated token URL.

### Transactional emails (`src/app/api/emails/`)

The send route supports two modes: template-based (pass `templateId` and `data`) and inline HTML (pass `subject` and `html`). It forwards the client's `Idempotency-Key` header to the Pigeons SDK, ensuring retries are safe. The status route fetches an email by ID to check its delivery progression (queued, sending, sent, delivered, bounced, complained, failed).

### Contact management (`src/app/api/contacts/`)

Full CRUD for contacts with tag-based filtering. Tags are the primary segmentation mechanism  - when you create a campaign, you target contacts by tag. The list endpoint supports pagination via cursor and filtering by a single tag. The update endpoint replaces tags wholesale (fetch-merge-update if you need additive behavior).

### Campaigns (`src/app/api/campaigns/`)

The list endpoint returns campaigns with their stats (total, sent, delivered, opened, bounced, complained, failed). The create endpoint demonstrates the two-step campaign flow: create in draft status, then immediately send (or schedule for later by passing `scheduledAt`). The audience is targeted by tag via `audienceFilter: { tag: "..." }`.

### Webhooks (`src/app/api/webhooks/pigeons/`)

Receives POST requests from Pigeons whenever an email lifecycle event occurs. Routes events by type to handler functions. The example uses an in-memory log for demonstration  - in production, write events to your database and add signature verification using the `X-Pigeons-Signature` header and your `WEBHOOK_SECRET`.

### Dashboard stats (`src/app/api/dashboard/stats/`)

Fetches global stats and recent campaigns in parallel using `Promise.all()` for efficiency. Returns aggregate rates (delivery, bounce, complaint, open) across 24h/7d/30d windows, top sending domains, and per-campaign breakdowns. In production, cache the response with a 60s TTL to avoid excessive API calls.

## Production checklist

- [ ] **Webhook signature verification**  - Verify the `X-Pigeons-Signature` header using HMAC-SHA256 with your `WEBHOOK_SECRET`. Without this, anyone can POST fake events to your webhook endpoint.
- [ ] **Error handling**  - Every route maps `PigeonsError` to the appropriate HTTP status. Add structured logging (e.g. Pino, Winston) for debugging production issues.
- [ ] **Rate limiting**  - Add rate limiting to auth routes (especially forgot-password) per IP and per email to prevent abuse.
- [ ] **Idempotency keys**  - Use deterministic idempotency keys for all transactional sends (e.g. `order-${orderId}-receipt`). This makes retries safe and prevents duplicate emails.
- [ ] **Contact suppression**  - On `email.bounced` (hard) and `email.complained` events, immediately suppress the contact. Continued sends to these addresses damage your sender reputation.
- [ ] **Dashboard caching**  - Cache the stats endpoint response (60s TTL) to avoid hammering the Pigeons API on every page load.
- [ ] **Template management**  - Store template slugs as constants, not inline strings. Consider a setup script that creates templates on first deploy.
- [ ] **Monitoring**  - Track delivery rates, bounce rates, and complaint rates. Alert if complaint rate exceeds 0.1% or bounce rate exceeds 5%.

## Next steps

- [nextjs-authentication-emails](../nextjs-authentication-emails/)  - Deeper dive into auth email patterns
- [campaign-send](../campaign-send/)  - Full campaign lifecycle with contact batching
- [inbound-webhook-handler](../inbound-webhook-handler/)  - Receive and reply to inbound emails
- [subscription-topics](../subscription-topics/)  - Per-topic subscription management
- [with-typescript](../with-typescript/)  - Minimal SDK quick-start
