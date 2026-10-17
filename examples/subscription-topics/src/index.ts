/**
 * Pigeons Subscription Topics Example
 *
 * Demonstrates the full subscription topic lifecycle for managing email
 * preferences. Subscription topics let your users control which categories
 * of email they receive — product updates, marketing, digests, etc. —
 * without unsubscribing from everything.
 *
 * The subscription model works like this:
 *
 *   1. You create topics that represent categories of email your product sends.
 *   2. Contacts are subscribed to ALL topics by default (opt-out model).
 *   3. When a contact unsubscribes from a topic, their `unsubscribedTopics`
 *      array gains that topic's ID.
 *   4. Campaigns and sequence steps scoped to a topic automatically skip
 *      contacts who have unsubscribed from that topic.
 *   5. Global unsubscribe (no topicId) opts the contact out of everything.
 *      Per-topic unsubscribe only affects that specific topic.
 *
 * This example walks through:
 *   a. Creating subscription topics
 *   b. Creating a contact and managing their topic subscriptions
 *   c. Listing a contact's active subscriptions
 *   d. Unsubscribing from a specific topic
 *   e. Sending a topic-scoped campaign
 *   f. Checking subscription status before sending
 *   g. The full unsubscribe/resubscribe flow
 *
 * Run: npx tsx src/index.ts
 */

import { Pigeons } from '@pigeons/pigeons-ts'

// ── Initialize ──────────────────────────────────────────────────────────────
// Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables.
// No default URL — you must configure your own self-hosted instance.

const pigeons = new Pigeons()

// Helper: the SDK's contacts.unsubscribe() and contacts.resubscribe() perform
// global (all-email) operations. For per-topic subscription management, we
// call the same endpoints with a `topicId` in the request body. This helper
// wraps that pattern so the rest of the example stays clean.

const baseUrl = process.env.PIGEONS_URL!.replace(/\/+$/, '')
const apiKey = process.env.PIGEONS_API_KEY!

async function topicUnsubscribe(contactId: string, topicId: string) {
  const res = await fetch(`${baseUrl}/v1/contacts/${contactId}/unsubscribe`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicId }),
  })
  if (!res.ok) throw new Error(`Unsubscribe failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function topicResubscribe(contactId: string, topicId: string) {
  const res = await fetch(`${baseUrl}/v1/contacts/${contactId}/resubscribe`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicId }),
  })
  if (!res.ok) throw new Error(`Resubscribe failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── 1. Create subscription topics ───────────────────────────────────────────
// Topics represent the categories of email your product sends. Common examples:
//   - Product updates (feature announcements, changelogs)
//   - Weekly digest (summary emails)
//   - Marketing (promotions, offers)
//   - Security alerts (password changes, login notifications)
//
// By creating topics upfront, you build a preference center that contacts
// can use to control exactly what they receive.

console.log('=== Step 1: Creating subscription topics ===\n')

const topicDefinitions = [
  { name: 'product-updates', description: 'Feature announcements, changelogs, and product news' },
  { name: 'weekly-digest', description: 'Weekly summary of activity and highlights' },
  { name: 'marketing', description: 'Promotions, special offers, and partnership announcements' },
  { name: 'security-alerts', description: 'Password changes, new device logins, and security notices' },
]

// Store the created topics so we can reference their IDs later.
// Topic IDs use the `top_` prefix (e.g. top_abc123).
const topics: Record<string, { id: string; name: string; description?: string }> = {}

for (const def of topicDefinitions) {
  try {
    const topic = await pigeons.topics.create(def)
    topics[def.name] = topic
    console.log(`  + Created: ${topic.name} (${topic.id})`)
  } catch (err: any) {
    // If the topic already exists from a previous run, fetch the full list
    // and find it by name. This makes the example safely re-runnable.
    if (err.statusCode === 409 || err.code === 'already_exists') {
      console.log(`  ~ Exists:  ${def.name} (already created)`)
    } else {
      throw err
    }
  }
}

// If some topics already existed, fetch them all so we have their IDs.
// The list endpoint returns all topics with cursor-based pagination.
if (Object.keys(topics).length < topicDefinitions.length) {
  const { data: allTopics } = await pigeons.topics.list({ limit: 100 })
  for (const t of allTopics) {
    if (topicDefinitions.some((d) => d.name === t.name)) {
      topics[t.name] = t
    }
  }
}

console.log(`\n  Total topics: ${Object.keys(topics).length}\n`)

// ── 2. Create a contact ─────────────────────────────────────────────────────
// Contacts are subscribed to ALL topics by default. This is the opt-out model
// required by most email regulations — you only need to track when someone
// opts OUT, not when they opt in.
//
// The contact's `unsubscribedTopics` field starts as null/empty, meaning
// they receive all topic-scoped emails.

console.log('=== Step 2: Creating a contact ===\n')

let contact
try {
  contact = await pigeons.contacts.create({
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Johnson',
    tags: ['early-adopter', 'pro-plan'],
    properties: {
      plan: 'pro',
      signupSource: 'website',
    },
  })
  console.log(`  + Created: ${contact.email} (${contact.id})`)
} catch (err: any) {
  // Contact already exists — fetch them by email.
  if (err.statusCode === 409 || err.code === 'already_exists') {
    contact = await pigeons.contacts.get('alice@example.com')
    console.log(`  ~ Exists:  ${contact.email} (${contact.id})`)
  } else {
    throw err
  }
}

console.log(`  Unsubscribed: ${contact.unsubscribed}`)
console.log(`  (New contacts are subscribed to all topics by default)\n`)

// ── 3. List active subscriptions ────────────────────────────────────────────
// To determine which topics a contact is subscribed to, compare the full
// topic list against the contact's `unsubscribedTopics` array. If a topic
// ID is NOT in `unsubscribedTopics`, the contact is subscribed to it.
//
// This opt-out model means new topics automatically include all existing
// contacts — no migration needed when you add a new email category.

console.log('=== Step 3: Listing active subscriptions ===\n')

// Fetch the contact's current state to see their unsubscribedTopics.
const freshContact = await pigeons.contacts.get(contact.id)

// The unsubscribedTopics field is null when no per-topic unsubscribes exist.
const unsubscribedTopicIds: string[] = (freshContact as any).unsubscribedTopics ?? []

console.log(`  Contact: ${freshContact.email}`)
console.log(`  Global unsubscribed: ${freshContact.unsubscribed}`)
console.log(`  Topic-level unsubscribes: ${unsubscribedTopicIds.length}\n`)

// Show subscription status for each topic.
for (const [name, topic] of Object.entries(topics)) {
  const subscribed = !unsubscribedTopicIds.includes(topic.id)
  const icon = subscribed ? '+' : '-'
  console.log(`  [${icon}] ${name.padEnd(20)} ${subscribed ? 'subscribed' : 'unsubscribed'}`)
}
console.log()

// ── 4. Unsubscribe from a specific topic ────────────────────────────────────
// Per-topic unsubscribe lets contacts opt out of one category without
// losing all emails. This is key for compliance and user experience:
//   - Contact opts out of "marketing" but still gets "security-alerts"
//   - The contact's global `unsubscribed` flag stays false
//   - Only the specific topic ID is added to `unsubscribedTopics`

console.log('=== Step 4: Unsubscribing from specific topics ===\n')

// Alice wants to opt out of marketing emails and the weekly digest,
// but keep product updates and security alerts.

const marketingTopic = topics['marketing']
const digestTopic = topics['weekly-digest']

console.log(`  Unsubscribing from: ${marketingTopic.name}`)
const afterMarketing = await topicUnsubscribe(contact.id, marketingTopic.id)
console.log(`  unsubscribedTopics: [${afterMarketing.unsubscribedTopics?.join(', ') ?? ''}]`)
console.log(`  Global unsubscribed: ${afterMarketing.unsubscribed} (unchanged)\n`)

console.log(`  Unsubscribing from: ${digestTopic.name}`)
const afterDigest = await topicUnsubscribe(contact.id, digestTopic.id)
console.log(`  unsubscribedTopics: [${afterDigest.unsubscribedTopics?.join(', ') ?? ''}]`)
console.log(`  Global unsubscribed: ${afterDigest.unsubscribed} (still false)\n`)

// Verify: re-check all subscriptions after the changes.
console.log('  Updated subscription status:')
const updatedUnsubs: string[] = afterDigest.unsubscribedTopics ?? []
for (const [name, topic] of Object.entries(topics)) {
  const subscribed = !updatedUnsubs.includes(topic.id)
  const icon = subscribed ? '+' : '-'
  console.log(`    [${icon}] ${name.padEnd(20)} ${subscribed ? 'subscribed' : 'unsubscribed'}`)
}
console.log()

// ── 5. Send a topic-scoped campaign ─────────────────────────────────────────
// When you create a campaign with a `topicId`, Pigeons automatically filters
// out contacts who have unsubscribed from that topic. This happens at the
// worker level — the campaign handler checks each contact's
// `unsubscribedTopics` before sending.
//
// This means you don't need to filter your audience manually. Just assign
// a topic to the campaign and Pigeons handles compliance.

console.log('=== Step 5: Sending a topic-scoped campaign ===\n')

// Create a campaign scoped to the "product-updates" topic.
// Alice is still subscribed to this topic, so she will receive it.
const productTopic = topics['product-updates']

const campaign = await pigeons.campaigns.create({
  name: 'October Product Update',
  subject: 'What\'s new in Pigeons this month',
  topicId: productTopic.id,
  fromName: 'Pigeons Team',
  fromEmail: 'updates@example.com',
})

console.log(`  Created campaign: ${campaign.name} (${campaign.id})`)
console.log(`  Topic: ${productTopic.name} (${productTopic.id})`)
console.log(`  Status: ${campaign.status}`)
console.log()

// When this campaign is sent, Pigeons will:
//   1. Gather all contacts matching the audience filter (or all contacts)
//   2. For each contact, check if productTopic.id is in their unsubscribedTopics
//   3. Skip contacts who have unsubscribed from this topic
//   4. Send to everyone else
//
// Now create a marketing campaign — Alice has unsubscribed from marketing,
// so she would be automatically excluded.

const marketingCampaign = await pigeons.campaigns.create({
  name: 'Holiday Special Offer',
  subject: '50% off for the holidays',
  topicId: marketingTopic.id,
  fromName: 'Pigeons Deals',
  fromEmail: 'deals@example.com',
})

console.log(`  Created campaign: ${marketingCampaign.name} (${marketingCampaign.id})`)
console.log(`  Topic: ${marketingTopic.name} (${marketingTopic.id})`)
console.log(`  Alice would be SKIPPED (unsubscribed from marketing)\n`)

// ── 6. Check subscription status before sending ─────────────────────────────
// For transactional or ad-hoc emails outside of campaigns, you may want
// to check a contact's subscription status before sending. This is useful
// when your application logic needs to decide whether to send.
//
// The pattern: fetch the contact, check their unsubscribedTopics, and
// only send if they haven't opted out of the relevant topic.

console.log('=== Step 6: Checking subscription status before sending ===\n')

async function shouldSendToContact(contactId: string, topicId: string): Promise<boolean> {
  const c = await pigeons.contacts.get(contactId)

  // If the contact has globally unsubscribed, don't send anything.
  if (c.unsubscribed) {
    console.log(`    Contact ${c.email} is globally unsubscribed — skipping`)
    return false
  }

  // Check per-topic unsubscribe. The unsubscribedTopics field contains
  // an array of topic IDs the contact has opted out of.
  const unsubs: string[] = (c as any).unsubscribedTopics ?? []
  if (unsubs.includes(topicId)) {
    console.log(`    Contact ${c.email} is unsubscribed from topic ${topicId} — skipping`)
    return false
  }

  console.log(`    Contact ${c.email} is subscribed to topic ${topicId} — will send`)
  return true
}

// Check: can we send Alice a product update?
console.log('  Checking product-updates:')
const canSendProduct = await shouldSendToContact(contact.id, productTopic.id)

// Check: can we send Alice a marketing email?
console.log('  Checking marketing:')
const canSendMarketing = await shouldSendToContact(contact.id, marketingTopic.id)

console.log()

// Send the product update since Alice is subscribed.
if (canSendProduct) {
  console.log('  Sending product update to Alice...')
  const email = await pigeons.emails.send({
    to: contact.email,
    subject: 'New feature: Subscription Topics',
    html: `
      <h1>New in Pigeons: Subscription Topics</h1>
      <p>Hi ${contact.firstName},</p>
      <p>You can now let your users manage their email preferences
      with fine-grained subscription topics.</p>
      <p>
        <a href="https://pigeons.dev/docs/topics">Read the docs</a>
      </p>
    `,
    text: `New in Pigeons: Subscription Topics\n\nHi ${contact.firstName},\n\nYou can now let your users manage their email preferences with fine-grained subscription topics.\n\nRead the docs: https://pigeons.dev/docs/topics`,
    tags: ['product-update', 'feature-announcement'],
  })
  console.log(`  Sent! ${email.id} (status: ${email.status})`)
}

if (!canSendMarketing) {
  console.log('  Skipped marketing email (Alice is unsubscribed from that topic)')
}
console.log()

// ── 7. Demonstrate the resubscribe flow ─────────────────────────────────────
// Contacts can resubscribe to topics they previously opted out of. This is
// typically triggered by:
//   - A preference center UI where the user toggles topics back on
//   - A re-engagement campaign where the user clicks "resubscribe"
//   - An admin action to reset a contact's preferences
//
// Resubscribing from a specific topic removes that topic ID from the
// contact's unsubscribedTopics array. Other topic unsubscribes are preserved.

console.log('=== Step 7: Resubscribe flow ===\n')

// Alice changes her mind — she wants the weekly digest back.
console.log(`  Before: Alice is unsubscribed from:`)
const beforeResub = await pigeons.contacts.get(contact.id)
const beforeUnsubs: string[] = (beforeResub as any).unsubscribedTopics ?? []
for (const topicId of beforeUnsubs) {
  const topicName = Object.entries(topics).find(([_, t]) => t.id === topicId)?.[0] ?? topicId
  console.log(`    - ${topicName}`)
}

console.log(`\n  Resubscribing to: ${digestTopic.name}`)
const afterResub = await topicResubscribe(contact.id, digestTopic.id)
const afterUnsubs: string[] = afterResub.unsubscribedTopics ?? []

console.log(`\n  After: Alice is unsubscribed from:`)
if (afterUnsubs.length === 0) {
  console.log('    (none — subscribed to all topics)')
} else {
  for (const topicId of afterUnsubs) {
    const topicName = Object.entries(topics).find(([_, t]) => t.id === topicId)?.[0] ?? topicId
    console.log(`    - ${topicName}`)
  }
}

// Note: the marketing unsubscribe is still in place. Resubscribing from
// one topic does not affect other topic-level unsubscribes.
console.log(`\n  Note: marketing unsubscribe is still in place`)

// Final subscription status.
console.log('\n  Final subscription status:')
for (const [name, topic] of Object.entries(topics)) {
  const subscribed = !afterUnsubs.includes(topic.id)
  const icon = subscribed ? '+' : '-'
  console.log(`    [${icon}] ${name.padEnd(20)} ${subscribed ? 'subscribed' : 'unsubscribed'}`)
}

// ── 8. List all topics ──────────────────────────────────────────────────────
// You can list all topics to build a preference center or admin UI.
// Topics support cursor-based pagination like all Pigeons list endpoints.

console.log('\n=== Step 8: Topic management ===\n')

const { data: allTopics, has_more } = await pigeons.topics.list()
console.log('  All subscription topics:')
for (const t of allTopics) {
  console.log(`    ${t.id}  ${t.name.padEnd(20)}  ${t.description ?? '(no description)'}`)
}
if (has_more) {
  console.log('  (more topics available — use cursor pagination)')
}

// You can also update topic names and descriptions. This is useful when
// you want to rename a category without breaking existing subscriptions.
// The topic ID stays the same, so all existing unsubscribes still apply.

const securityTopic = topics['security-alerts']
const updated = await pigeons.topics.update(securityTopic.id, {
  description: 'Critical security notices — password resets, new logins, and 2FA changes',
})
console.log(`\n  Updated topic: ${updated.name}`)
console.log(`  New description: ${updated.description}`)

console.log('\nDone!')
