/**
 * Pigeons Quick Start  - TypeScript
 *
 * Demonstrates the three most common operations:
 *   1. Send a transactional email
 *   2. Check delivery status by ID
 *   3. List recent emails with filters
 *
 * Run: npx tsx src/index.ts
 */

import { Pigeons } from '@pigeons/pigeons-ts'

// Initialize the client.
// Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables,
// or pass them explicitly: new Pigeons({ baseUrl: '...', apiKey: '...' })
const pigeons = new Pigeons()

// ── 1. Send an email ────────────────────────────────────────────────────────
// The SDK returns the full email object immediately. The email is queued
// for delivery  - status will be "queued" until the background worker
// picks it up and hands it to SES.

console.log('Sending email...\n')

const email = await pigeons.emails.send({
  to: 'recipient@example.com',
  subject: 'Hello from Pigeons',
  html: '<h1>Welcome!</h1><p>Your Pigeons instance is working.</p>',
  text: 'Welcome! Your Pigeons instance is working.',
})

console.log(`  Email sent!`)
console.log(`  ID:     ${email.id}`)
console.log(`  Status: ${email.status}`)
console.log(`  To:     ${email.to.join(', ')}\n`)

// ── 2. Check delivery status ────────────────────────────────────────────────
// Poll the email by ID to see its current status. In production you'd
// use webhooks instead of polling  - see the webhook-event-handler example.

console.log('Checking delivery status...\n')

// Wait a moment for the background worker to process the job
await new Promise((resolve) => setTimeout(resolve, 3000))

const updated = await pigeons.emails.get(email.id)

console.log(`  Current status: ${updated.status}`)
if (updated.sesMessageId) {
  console.log(`  SES Message ID: ${updated.sesMessageId}`)
}
console.log()

// ── 3. List recent emails ───────────────────────────────────────────────────
// Fetch the most recent emails, optionally filtering by status.
// The response includes cursor-based pagination.

console.log('Listing recent emails...\n')

const { data: emails, has_more, next_cursor } = await pigeons.emails.list({
  limit: 5,
})

for (const e of emails) {
  console.log(`  ${e.id}  ${e.status.padEnd(10)}  ${e.subject}`)
}

if (has_more) {
  console.log(`\n  More emails available (cursor: ${next_cursor})`)
}

console.log('\nDone!')
