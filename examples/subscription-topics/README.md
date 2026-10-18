# Subscription Topics

Manage email preferences with fine-grained subscription topics. Let your users control which categories of email they receive without unsubscribing from everything.

## What you'll learn

- **Topics CRUD**  - create, list, update, and delete subscription topics
- **Contact subscriptions**  - subscribe and unsubscribe contacts from specific topics
- **Topic-scoped sending**  - campaigns that automatically skip unsubscribed contacts
- **Preference management**  - check subscription status before sending, build preference center patterns

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with full scopes

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

## Expected output

```
=== Step 1: Creating subscription topics ===

  + Created: product-updates (top_abc123)
  + Created: weekly-digest (top_def456)
  + Created: marketing (top_ghi789)
  + Created: security-alerts (top_jkl012)

  Total topics: 4

=== Step 2: Creating a contact ===

  + Created: alice@example.com (ctc_mno345)
  Unsubscribed: false
  (New contacts are subscribed to all topics by default)

=== Step 3: Listing active subscriptions ===

  Contact: alice@example.com
  Global unsubscribed: false
  Topic-level unsubscribes: 0

  [+] product-updates      subscribed
  [+] weekly-digest         subscribed
  [+] marketing             subscribed
  [+] security-alerts       subscribed

=== Step 4: Unsubscribing from specific topics ===

  Unsubscribing from: marketing
  unsubscribedTopics: [top_ghi789]
  Global unsubscribed: false (unchanged)

  Unsubscribing from: weekly-digest
  unsubscribedTopics: [top_ghi789, top_def456]
  Global unsubscribed: false (still false)

  Updated subscription status:
    [+] product-updates      subscribed
    [-] weekly-digest         unsubscribed
    [-] marketing             unsubscribed
    [+] security-alerts       subscribed

=== Step 5: Sending a topic-scoped campaign ===

  Created campaign: October Product Update (cmp_abc123)
  Topic: product-updates (top_abc123)
  Status: draft

  Created campaign: Holiday Special Offer (cmp_def456)
  Topic: marketing (top_ghi789)
  Alice would be SKIPPED (unsubscribed from marketing)

=== Step 6: Checking subscription status before sending ===

  Checking product-updates:
    Contact alice@example.com is subscribed to topic top_abc123  - will send
  Checking marketing:
    Contact alice@example.com is unsubscribed from topic top_ghi789  - skipping

  Sending product update to Alice...
  Sent! msg_xyz789 (status: queued)
  Skipped marketing email (Alice is unsubscribed from that topic)

=== Step 7: Resubscribe flow ===

  Before: Alice is unsubscribed from:
    - marketing
    - weekly-digest

  Resubscribing to: weekly-digest

  After: Alice is unsubscribed from:
    - marketing

  Note: marketing unsubscribe is still in place

  Final subscription status:
    [+] product-updates      subscribed
    [+] weekly-digest         subscribed
    [-] marketing             unsubscribed
    [+] security-alerts       subscribed

=== Step 8: Topic management ===

  All subscription topics:
    top_abc123  product-updates       Feature announcements, changelogs, and product news
    top_def456  weekly-digest          Weekly summary of activity and highlights
    top_ghi789  marketing              Promotions, special offers, and partnership announcements
    top_jkl012  security-alerts        Password changes, new device logins, and security notices

  Updated topic: security-alerts
  New description: Critical security notices  - password resets, new logins, and 2FA changes

Done!
```

## Code walkthrough

### Subscription model

Pigeons uses an **opt-out** subscription model:

- Contacts are subscribed to all topics by default
- Unsubscribing adds a topic ID to the contact's `unsubscribedTopics` array
- Global unsubscribe (without a `topicId`) opts the contact out of all email
- Per-topic and global unsubscribes are independent

### Topics CRUD

Topics are created via `pigeons.topics.create()` with a name and optional description. Topic names must be unique. IDs use the `top_` prefix.

```ts
const topic = await pigeons.topics.create({
  name: 'product-updates',
  description: 'Feature announcements and changelogs',
})
```

### Per-topic unsubscribe

The contacts API accepts an optional `topicId` body parameter on the unsubscribe and resubscribe endpoints:

```
POST /v1/contacts/:id/unsubscribe   { "topicId": "top_abc123" }
POST /v1/contacts/:id/resubscribe   { "topicId": "top_abc123" }
```

Without `topicId`, these endpoints perform a global unsubscribe/resubscribe.

### Topic-scoped campaigns

Campaigns created with a `topicId` automatically filter their audience at send time. The campaign worker checks each contact's `unsubscribedTopics` and skips those who have opted out.

```ts
const campaign = await pigeons.campaigns.create({
  name: 'October Update',
  topicId: topic.id,
  // ...
})
```

### Subscription check helper

For ad-hoc sends outside of campaigns, check the contact's subscription status before sending:

```ts
const contact = await pigeons.contacts.get(contactId)
const unsubs: string[] = contact.unsubscribedTopics ?? []

if (contact.unsubscribed || unsubs.includes(topicId)) {
  // Don't send  - contact has opted out
}
```

## Integration patterns

### Preference center

Build a settings page where users toggle topics on and off:

1. `GET /v1/topics`  - fetch all topics to display as toggles
2. `GET /v1/contacts/:email`  - fetch the contact's `unsubscribedTopics`
3. When a user toggles off: `POST /v1/contacts/:id/unsubscribe` with `{ topicId }`
4. When a user toggles on: `POST /v1/contacts/:id/resubscribe` with `{ topicId }`

### List-Unsubscribe header

Add a one-click unsubscribe header to your emails for email client integration:

```ts
await pigeons.emails.send({
  to: 'user@example.com',
  subject: 'Weekly Digest',
  html: '...',
  headers: {
    'List-Unsubscribe': '<https://your-app.com/unsubscribe?contact=ctc_abc&topic=top_xyz>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
})
```

Your unsubscribe endpoint then calls the Pigeons API to record the opt-out.

### CAN-SPAM / GDPR compliance

- **Physical address**: include your mailing address in the email footer
- **Unsubscribe link**: every marketing email must include a visible unsubscribe link
- **Honor requests promptly**: Pigeons records the unsubscribe immediately; campaigns check it at send time
- **Topic granularity**: offering per-topic preferences (rather than all-or-nothing) improves compliance and reduces global unsubscribes
- **Transactional exemption**: security alerts and account notifications are typically exempt from unsubscribe requirements, but it's good practice to offer the option

## Next steps

- [email-templates](../email-templates/)  - Create templates for your topic-scoped campaigns
- [express-order-emails](../express-order-emails/)  - Transactional email patterns with Express
- [inbound-webhook-handler](../inbound-webhook-handler/)  - Handle delivery events and bounces
- [ai-outreach-agent](../ai-outreach-agent/)  - Build AI agents that respect subscription preferences
