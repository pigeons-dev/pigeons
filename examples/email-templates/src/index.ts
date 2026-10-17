/**
 * Pigeons Email Templates Example
 *
 * Demonstrates the full template lifecycle:
 *   1. Create templates from React Email components
 *   2. Preview a template with sample data
 *   3. Send an email using a template with variables
 *
 * This example includes 6 production-quality templates:
 *   - Stripe-style welcome (polished onboarding email)
 *   - Simple welcome (minimal signup confirmation)
 *   - Password reset (with time-limited link)
 *   - Payment receipt (with line items and totals)
 *   - Activity notification (comments, mentions, assignments)
 *   - Team invite (workspace collaboration invite)
 *
 * Each template is a React Email component stored as a Pigeons template.
 * The server renders them server-side — no React runtime needed in your app.
 *
 * Run: npx tsx src/index.ts
 */

import { Pigeons } from '@pigeons/pigeons-ts'

import * as stripeWelcome from './templates/stripe-welcome.js'
import * as welcome from './templates/welcome.js'
import * as passwordReset from './templates/password-reset.js'
import * as receipt from './templates/receipt.js'
import * as notification from './templates/notification.js'
import * as teamInvite from './templates/team-invite.js'

const pigeons = new Pigeons()

// All 6 templates to register
const templates = [stripeWelcome, welcome, passwordReset, receipt, notification, teamInvite]

// ── 1. Create templates ─────────────────────────────────────────────────────
// Upload each template to the Pigeons server. The template body is a React
// Email component — Pigeons stores it and renders it server-side when you
// send an email referencing the template slug.

console.log('Creating templates...\n')

for (const tpl of templates) {
  try {
    const created = await pigeons.templates.create({
      slug: tpl.slug,
      name: tpl.name,
      subject: tpl.subject,
      body: tpl.body,
      sampleData: tpl.sampleData,
    })
    console.log(`  + ${created.slug} (${created.id})`)
  } catch (err: any) {
    // Template already exists — that's fine for re-runs
    if (err.statusCode === 409 || err.code === 'already_exists') {
      console.log(`  ~ ${tpl.slug} (already exists)`)
    } else {
      console.log(`  ! ${tpl.slug}: ${err.message}`)
    }
  }
}

console.log()

// ── 2. Preview a template ───────────────────────────────────────────────────
// Render a template with data without sending an email. Useful for testing
// how the template looks before sending it to real recipients.

console.log('Previewing stripe-welcome template...\n')

const preview = await pigeons.templates.preview('stripe-welcome', {
  companyName: 'Pigeons',
  dashboardUrl: 'https://app.pigeons.dev/dashboard',
  docsUrl: 'https://pigeons.dev/docs',
})

console.log(`  Subject: ${preview.subject}`)
console.log(`  HTML:    ${preview.html.length} characters`)
console.log(`  Text:    ${preview.text.slice(0, 80)}...`)
console.log()

// ── 3. List all templates ───────────────────────────────────────────────────
// Fetch the template library to see what's available.

console.log('Template library:\n')

const { data: allTemplates } = await pigeons.templates.list()

for (const t of allTemplates) {
  console.log(`  ${t.slug.padEnd(20)} v${t.version}  "${t.subject}"`)
}
console.log()

// ── 4. Send an email using a template ───────────────────────────────────────
// Reference a template by slug when sending. The server renders the React
// Email component with your data and sends the resulting HTML.

console.log('Sending email with receipt template...\n')

const email = await pigeons.emails.send({
  to: 'customer@example.com',
  templateId: 'receipt',
  data: {
    customerName: 'Jane Doe',
    companyName: 'Pigeons',
    invoiceNumber: 'INV-2026-0001',
    invoiceUrl: 'https://app.pigeons.dev/invoices/1',
    total: '$29.00',
    date: 'October 17, 2026',
    itemName: 'Pigeons Pro (Monthly)',
    itemAmount: '$29.00',
  },
})

console.log(`  Sent! ${email.id} (status: ${email.status})`)
console.log('\nDone!')
