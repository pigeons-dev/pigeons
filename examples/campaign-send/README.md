# Campaign Send

Send a one-time email campaign to a list of contacts using a template. Covers the full campaign lifecycle from template creation through delivery monitoring.

## What you'll learn

- Create reusable email templates with variable placeholders
- Import contacts via batch create (simulating a CSV import)
- Create a campaign targeting contacts by tag
- Send the campaign and monitor delivery stats in real-time
- Calculate delivery, bounce, and open rates

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with `campaigns`, `templates`, and `contacts` scopes
- A verified sending domain (for the `fromEmail` address)

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

Update the `fromEmail` in `src/index.ts` to use your verified domain.

## Run

```bash
npx tsx src/index.ts
```

Expected output:

```
Creating product launch template...

  Template created: product-launch (tpl_abc123)

Importing contacts...

  Created: 5
  Skipped: 0 (already existed)
  Contacts:
    ctc_a1b2c3  alice@example.com
    ctc_d4e5f6  bob@example.com
    ctc_g7h8i9  carol@example.com
    ctc_j0k1l2  dave@example.com
    ctc_m3n4o5  eve@example.com

Creating campaign...

  Campaign created: Pigeons v2 Product Launch
  ID:       cmp_xyz789
  Status:   draft
  Template: product-launch
  Audience: contacts tagged "product-updates"

Sending campaign...

  Status changed: draft -> sending
  Total recipients: 5

Monitoring delivery...

  [ 1] sending    sent=2/5  delivered=0  opened=0  bounced=0  failed=0
  [ 2] sending    sent=5/5  delivered=2  opened=0  bounced=0  failed=0
  [ 3] sending    sent=5/5  delivered=4  opened=0  bounced=0  failed=0
  [ 4] sent       sent=5/5  delivered=5  opened=0  bounced=0  failed=0

Campaign complete!

  Name:        Pigeons v2 Product Launch
  Status:      sent
  Started:     2025-01-10T14:30:00.000Z
  Completed:   2025-01-10T14:30:12.000Z

  Delivery stats:
    Total:      5
    Sent:       5
    Delivered:  5
    Opened:     0
    Bounced:    0
    Complained: 0
    Failed:     0

  Rates:
    Delivery:   100.0%
    Bounce:     0.0%
    Open:       0.0%

Done!
```

## Code walkthrough

### Template creation

Templates separate your email design from campaign logic. The example creates a `product-launch` template with a branded HTML layout and `{{variable}}` placeholders for product name, features, and CTA. The template is stored server-side and referenced by slug.

### Contact import

Contacts are batch-imported using `pigeons.contacts.batch()`. Each contact has an email, name, and tags. The batch endpoint is idempotent — re-running the example skips contacts that already exist.

### Campaign creation

A campaign ties a template, audience, and sender identity together. The `audienceFilter` field selects which contacts receive the campaign — here we filter by the `product-updates` tag. The campaign starts in `draft` status and doesn't send until explicitly triggered.

### Sending

`pigeons.campaigns.send()` transitions the campaign to `sending`. Pigeons queues individual email jobs for each contact in the audience. Each email is rendered with the template and the campaign's `templateData`, with per-contact variables (like `firstName`) merged in.

You can also schedule a future send:

```typescript
await pigeons.campaigns.send(campaign.id, {
  scheduledAt: '2025-01-15T09:00:00Z'
})
```

### Monitoring

The example polls `pigeons.campaigns.get()` every 3 seconds to show delivery progress. Stats include `sent`, `delivered`, `opened`, `bounced`, `complained`, and `failed` counters. In production, use webhooks for real-time delivery events instead of polling.

## API reference

- [`pigeons.templates.create()`](https://pigeons.dev/docs/api/templates#create) — Create a template
- [`pigeons.contacts.batch()`](https://pigeons.dev/docs/api/contacts#batch) — Batch-create contacts
- [`pigeons.campaigns.create()`](https://pigeons.dev/docs/api/campaigns#create) — Create a campaign
- [`pigeons.campaigns.send()`](https://pigeons.dev/docs/api/campaigns#send) — Send or schedule a campaign
- [`pigeons.campaigns.get()`](https://pigeons.dev/docs/api/campaigns#get) — Get campaign status and stats

## Next steps

- [drip-sequence](../drip-sequence/) — Set up a multi-step automated email sequence
- [delivery-monitor](../delivery-monitor/) — Track delivery health across domains
- [email-templates](../email-templates/) — Build a library of reusable templates
- [inbound-webhook-handler](../inbound-webhook-handler/) — Process delivery events via webhooks instead of polling
