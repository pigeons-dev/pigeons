/**
 * Pigeons Campaign Send Example
 *
 * Demonstrates the full lifecycle of sending a one-time email campaign
 * to a list of contacts using a template:
 *
 *   1. Create a product launch announcement template
 *   2. Import contacts (simulating a CSV import)
 *   3. Batch-create contacts via the API
 *   4. Create a campaign targeting contacts by tag
 *   5. Send the campaign
 *   6. Monitor delivery stats in real-time
 *   7. Print a final summary
 *
 * This is the pattern you'd use for product announcements, newsletters,
 * promotional emails, or any one-time send to a segment of your audience.
 *
 * Run: npx tsx src/index.ts
 */

import { Pigeons } from '@pigeons/pigeons-ts'

const pigeons = new Pigeons()

// ── 1. Create a template ────────────────────────────────────────────────────
// Templates let you separate design from data. Create the template once,
// then reference it by slug or ID in every campaign that uses it.
// The body is a React Email-style HTML string with {{variable}} placeholders
// that get replaced at send time with the campaign's templateData.

console.log('Creating product launch template...\n')

let template
try {
  template = await pigeons.templates.create({
    slug: 'product-launch',
    name: 'Product Launch Announcement',
    subject: '{{productName}} is here  - see what\'s new',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color: #656ee8; padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">
                {{productName}}
              </h1>
              <p style="margin: 8px 0 0; color: #c7caff; font-size: 14px;">
                {{tagline}}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.6;">
                Hi {{firstName}},
              </p>
              <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.6;">
                We're excited to announce the launch of <strong>{{productName}}</strong>  - {{description}}
              </p>
              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.6;">
                Here's what you can do with it:
              </p>
              <ul style="margin: 0 0 24px; padding-left: 20px; color: #374151; font-size: 15px; line-height: 1.8;">
                <li>{{feature1}}</li>
                <li>{{feature2}}</li>
                <li>{{feature3}}</li>
              </ul>

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 0 auto 24px;">
                <tr>
                  <td style="background-color: #656ee8; border-radius: 6px;">
                    <a href="{{ctaUrl}}" style="display: inline-block; padding: 12px 32px; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none;">
                      {{ctaText}}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                Questions? Just reply to this email  - we read every message.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px; text-align: center;">
                {{companyName}} &middot; You're receiving this because you signed up for product updates.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    sampleData: {
      productName: 'Pigeons v2',
      tagline: 'Email infrastructure for developers',
      firstName: 'Alex',
      description: 'a complete rewrite of our email sending pipeline.',
      feature1: 'Sub-second delivery with smart queue prioritization',
      feature2: 'Built-in bounce handling and complaint tracking',
      feature3: 'Campaign analytics with real-time open tracking',
      ctaUrl: 'https://pigeons.dev/docs',
      ctaText: 'Read the docs',
      companyName: 'Pigeons',
    },
  })
  console.log(`  Template created: ${template.slug} (${template.id})\n`)
} catch (err: any) {
  // If the template already exists from a previous run, fetch it instead.
  // This makes the example safe to run multiple times.
  if (err.statusCode === 409 || err.code === 'already_exists') {
    template = await pigeons.templates.get('product-launch')
    console.log(`  Template already exists: ${template.slug} (${template.id})\n`)
  } else {
    throw err
  }
}

// ── 2. Prepare contact data ─────────────────────────────────────────────────
// In production, you'd import contacts from a CSV file, CRM export, or
// database query. Here we simulate that with an inline array.
// Each contact has an email, name, and tags. The tags are important  -
// they're how we target the campaign audience later.

const contactData = [
  { email: 'alice@example.com', firstName: 'Alice', lastName: 'Chen', tags: ['beta-user', 'product-updates'] },
  { email: 'bob@example.com', firstName: 'Bob', lastName: 'Martinez', tags: ['product-updates'] },
  { email: 'carol@example.com', firstName: 'Carol', lastName: 'Johnson', tags: ['beta-user', 'product-updates'] },
  { email: 'dave@example.com', firstName: 'Dave', lastName: 'Kim', tags: ['product-updates', 'enterprise'] },
  { email: 'eve@example.com', firstName: 'Eve', lastName: 'Nakamura', tags: ['beta-user', 'product-updates', 'enterprise'] },
]

// ── 3. Import contacts ──────────────────────────────────────────────────────
// Use batch import for efficiency. The batch endpoint handles duplicates
// gracefully  - if a contact with that email already exists, it's skipped
// rather than causing an error.

console.log('Importing contacts...\n')

const batchResult = await pigeons.contacts.batch(contactData)

console.log(`  Created: ${batchResult.created}`)
console.log(`  Skipped: ${batchResult.skipped} (already existed)`)
console.log(`  Contacts:`)
for (const c of batchResult.contacts) {
  console.log(`    ${c.id}  ${c.email}`)
}
console.log()

// ── 4. Create the campaign ──────────────────────────────────────────────────
// A campaign ties together a template, audience, and send configuration.
//
// Key fields:
//   - name: Internal label for your reference (not shown to recipients)
//   - templateId: Which template to render for each recipient
//   - templateData: Variables injected into the template at send time
//   - fromName / fromEmail: The sender identity recipients see
//   - audienceFilter: Select which contacts receive this campaign.
//     Filter by tag to target a specific segment.
//   - subject: Can also contain {{variables}} from templateData
//
// The campaign starts in "draft" status  - it won't send until you
// explicitly call campaigns.send().

console.log('Creating campaign...\n')

const campaign = await pigeons.campaigns.create({
  name: 'Pigeons v2 Product Launch',
  subject: '{{productName}} is here  - see what\'s new',
  templateId: template.id,
  templateData: {
    productName: 'Pigeons v2',
    tagline: 'Email infrastructure for developers',
    description: 'a complete rewrite of our email sending pipeline.',
    feature1: 'Sub-second delivery with smart queue prioritization',
    feature2: 'Built-in bounce handling and complaint tracking',
    feature3: 'Campaign analytics with real-time open tracking',
    ctaUrl: 'https://pigeons.dev/changelog/v2',
    ctaText: 'See what\'s new',
    companyName: 'Pigeons',
  },
  fromName: 'Pigeons Team',
  fromEmail: 'updates@yourdomain.com',
  audienceFilter: { tags: { contains: 'product-updates' } },
})

console.log(`  Campaign created: ${campaign.name}`)
console.log(`  ID:       ${campaign.id}`)
console.log(`  Status:   ${campaign.status}`)
console.log(`  Template: ${template.slug}`)
console.log(`  Audience: contacts tagged "product-updates"`)
console.log()

// ── 5. Send the campaign ────────────────────────────────────────────────────
// Calling send() transitions the campaign from "draft" to "sending".
// Pigeons queues individual email jobs for each matching contact.
//
// You can also schedule a campaign for later by passing scheduledAt:
//   await pigeons.campaigns.send(campaign.id, {
//     scheduledAt: '2025-01-15T09:00:00Z'
//   })
//
// Once sending starts, the campaign processes contacts in batches.
// Each email is rendered with the template + templateData, with
// per-contact variables (like firstName) merged in automatically.

console.log('Sending campaign...\n')

const sentCampaign = await pigeons.campaigns.send(campaign.id)

console.log(`  Status changed: ${campaign.status} -> ${sentCampaign.status}`)
console.log(`  Total recipients: ${sentCampaign.stats.total}`)
console.log()

// ── 6. Monitor delivery stats ───────────────────────────────────────────────
// Poll the campaign every 3 seconds to watch delivery progress.
// In production, you'd use webhooks for real-time delivery events
// instead of polling. This is just to visualize the lifecycle.
//
// Stats fields:
//   - total:      Number of contacts in the audience
//   - sent:       Emails handed off to SES
//   - delivered:  Confirmed delivered by SES
//   - opened:     Recipients who opened the email (if open tracking is on)
//   - bounced:    Hard or soft bounces
//   - complained: Recipients who marked the email as spam
//   - failed:     Emails that failed to send

console.log('Monitoring delivery...\n')

const maxPolls = 20           // Stop after ~60 seconds to avoid infinite loops
const pollIntervalMs = 3000   // Check every 3 seconds
let polls = 0
let done = false

while (!done && polls < maxPolls) {
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  polls++

  const current = await pigeons.campaigns.get(campaign.id)
  const s = current.stats

  // Print a compact status line showing all stat counters
  const line = [
    `sent=${s.sent}/${s.total}`,
    `delivered=${s.delivered}`,
    `opened=${s.opened}`,
    `bounced=${s.bounced}`,
    `failed=${s.failed}`,
  ].join('  ')

  console.log(`  [${String(polls).padStart(2)}] ${current.status.padEnd(10)} ${line}`)

  // A campaign is done when its status moves to "sent" (all emails processed)
  // or "cancelled" / "paused" (manually stopped)
  if (['sent', 'cancelled', 'paused'].includes(current.status)) {
    done = true
  }
}

console.log()

// ── 7. Final summary ────────────────────────────────────────────────────────
// Fetch the final state and print a human-readable summary.

const final = await pigeons.campaigns.get(campaign.id)
const stats = final.stats

console.log('Campaign complete!\n')
console.log(`  Name:        ${final.name}`)
console.log(`  Status:      ${final.status}`)
console.log(`  Started:     ${final.startedAt ?? 'N/A'}`)
console.log(`  Completed:   ${final.completedAt ?? 'N/A'}`)
console.log()
console.log('  Delivery stats:')
console.log(`    Total:      ${stats.total}`)
console.log(`    Sent:       ${stats.sent}`)
console.log(`    Delivered:  ${stats.delivered}`)
console.log(`    Opened:     ${stats.opened}`)
console.log(`    Bounced:    ${stats.bounced}`)
console.log(`    Complained: ${stats.complained}`)
console.log(`    Failed:     ${stats.failed}`)

// Calculate rates (avoid division by zero)
if (stats.sent > 0) {
  const deliveryRate = ((stats.delivered / stats.sent) * 100).toFixed(1)
  const bounceRate = ((stats.bounced / stats.sent) * 100).toFixed(1)
  const openRate = stats.delivered > 0
    ? ((stats.opened / stats.delivered) * 100).toFixed(1)
    : '0.0'
  console.log()
  console.log('  Rates:')
  console.log(`    Delivery:   ${deliveryRate}%`)
  console.log(`    Bounce:     ${bounceRate}%`)
  console.log(`    Open:       ${openRate}%`)
}

console.log('\nDone!')
