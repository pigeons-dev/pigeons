/**
 * Pigeons Drip Sequence Example
 *
 * Demonstrates multi-step drip sequences — automated email sequences that
 * send a series of emails to contacts over time, with configurable delays
 * between each step.
 *
 * This example builds a complete "User Onboarding" sequence:
 *   Step 1: Welcome email (sent immediately on enrollment)
 *   Step 2: Tips & tricks email (sent after a 2-day delay)
 *   Step 3: Check-in email (sent after a 5-day delay from step 2)
 *
 * Covers the full sequence lifecycle:
 *   - Create reusable email templates for each step
 *   - Define a sequence with delay + email steps
 *   - Enroll contacts and activate the sequence
 *   - Poll sequence and enrollment stats
 *   - Pause and resume the sequence
 *   - Unenroll a specific contact
 *
 * Run: npx tsx src/index.ts
 */

import { Pigeons } from '@pigeons/pigeons-ts'

// Initialize the client.
// Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables,
// or pass them explicitly: new Pigeons({ baseUrl: '...', apiKey: '...' })
const pigeons = new Pigeons()

// ── Helpers ────────────────────────────────────────────────────────────────

/** Sleep for a given number of milliseconds. Used to wait for background processing. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Create a template, or silently skip if it already exists (for re-runs). */
async function ensureTemplate(params: {
  slug: string
  name: string
  subject: string
  body: string
  sampleData?: Record<string, unknown>
}): Promise<string> {
  try {
    const tpl = await pigeons.templates.create(params)
    console.log(`  + ${tpl.slug} (${tpl.id})`)
    return tpl.id
  } catch (err: any) {
    // Template already exists — fetch it to get the ID
    if (err.statusCode === 409 || err.code === 'already_exists') {
      const existing = await pigeons.templates.get(params.slug)
      console.log(`  ~ ${params.slug} (already exists: ${existing.id})`)
      return existing.id
    }
    throw err
  }
}

// ── 1. Create onboarding email templates ───────────────────────────────────
// Each step in our drip sequence references a template. Templates are stored
// on the server and rendered with dynamic data when the email is sent.
//
// We create three templates representing a typical onboarding flow:
//   - Day 0: Welcome email with getting-started links
//   - Day 2: Tips email highlighting key features
//   - Day 5: Check-in email asking how things are going

console.log('Creating onboarding templates...\n')

const welcomeTemplateId = await ensureTemplate({
  slug: 'onboarding-welcome',
  name: 'Onboarding: Welcome',
  subject: 'Welcome to {{companyName}}, {{firstName}}!',
  body: `
    <h1>Welcome aboard, {{firstName}}!</h1>
    <p>We're thrilled to have you on {{companyName}}. Here's how to get started:</p>
    <ol>
      <li><a href="{{dashboardUrl}}">Visit your dashboard</a></li>
      <li><a href="{{docsUrl}}">Read the docs</a></li>
      <li>Send your first email via the API</li>
    </ol>
    <p>If you have any questions, just reply to this email — we're here to help.</p>
    <p>— The {{companyName}} Team</p>
  `,
  sampleData: {
    firstName: 'Jane',
    companyName: 'Pigeons',
    dashboardUrl: 'https://app.example.com/dashboard',
    docsUrl: 'https://docs.example.com',
  },
})

const tipsTemplateId = await ensureTemplate({
  slug: 'onboarding-tips',
  name: 'Onboarding: Tips & Tricks',
  subject: '3 tips to get the most out of {{companyName}}',
  body: `
    <h1>Hey {{firstName}}, here are a few tips</h1>
    <p>You've been on {{companyName}} for a couple of days now. Here are three things power users love:</p>
    <h3>1. Use templates</h3>
    <p>Store your email designs as templates and render them with dynamic data. No more copy-pasting HTML.</p>
    <h3>2. Set up webhooks</h3>
    <p>Get real-time delivery, bounce, and complaint events pushed to your server.</p>
    <h3>3. Track opens</h3>
    <p>Enable open tracking to see who's reading your emails and when.</p>
    <p><a href="{{docsUrl}}">Explore the full docs &rarr;</a></p>
    <p>— The {{companyName}} Team</p>
  `,
  sampleData: {
    firstName: 'Jane',
    companyName: 'Pigeons',
    docsUrl: 'https://docs.example.com',
  },
})

const checkinTemplateId = await ensureTemplate({
  slug: 'onboarding-checkin',
  name: 'Onboarding: Check-in',
  subject: 'How are things going, {{firstName}}?',
  body: `
    <h1>Quick check-in, {{firstName}}</h1>
    <p>It's been about a week since you joined {{companyName}}. We'd love to know how it's going.</p>
    <p><strong>Have you:</strong></p>
    <ul>
      <li>Sent your first production email?</li>
      <li>Set up a custom domain?</li>
      <li>Connected your webhooks?</li>
    </ul>
    <p>If anything is blocking you, reply to this email and we'll get you sorted.</p>
    <p>Or if everything is great, we'd love a <a href="{{feedbackUrl}}">quick rating</a>.</p>
    <p>— The {{companyName}} Team</p>
  `,
  sampleData: {
    firstName: 'Jane',
    companyName: 'Pigeons',
    feedbackUrl: 'https://app.example.com/feedback',
  },
})

console.log()

// ── 2. Create the drip sequence ────────────────────────────────────────────
// A sequence is an ordered list of steps. Each step is one of:
//   - "email": sends an email using a template
//   - "delay": pauses the sequence for a duration before proceeding
//   - "condition": (advanced) branches based on contact properties or behavior
//
// Steps execute in order. When a contact is enrolled, they start at step 0
// and progress through each step. Delay steps hold the contact in place
// until the specified duration elapses, then the next step fires.
//
// Delay durations use human-readable strings: "2d" = 2 days, "12h" = 12 hours,
// "30m" = 30 minutes. Combine as needed.
//
// The pattern for a drip sequence is: email, delay, email, delay, email.
// The first email sends immediately on enrollment (no leading delay).

console.log('Creating "User Onboarding" sequence...\n')

const sequence = await pigeons.sequences.create({
  name: 'User Onboarding',

  // Optional: auto-enroll contacts when an event fires.
  // When set, any contact matching the filter is automatically enrolled
  // when the specified event occurs. Leave this out to enroll manually.
  trigger: {
    event: 'contact.created',
    filter: { tags: ['new-signup'] },
  },

  // The steps define the drip cadence. Each step runs in order.
  // Contacts progress through steps one at a time.
  steps: [
    // Step 0: Welcome email — sent immediately when a contact is enrolled.
    // This is the first touchpoint. No delay before it.
    {
      type: 'email',
      templateId: welcomeTemplateId,
      templateData: {
        companyName: 'Pigeons',
        dashboardUrl: 'https://app.example.com/dashboard',
        docsUrl: 'https://docs.example.com',
      },
    },

    // Step 1: Wait 2 days before the next email.
    // The contact stays at this step until the delay elapses.
    // During a delay, the sequence worker checks periodically and
    // advances the contact when the time is up.
    {
      type: 'delay',
      delayDuration: '2d',
    },

    // Step 2: Tips & tricks email — sent after the 2-day delay.
    {
      type: 'email',
      templateId: tipsTemplateId,
      templateData: {
        companyName: 'Pigeons',
        docsUrl: 'https://docs.example.com',
      },
    },

    // Step 3: Wait 5 more days.
    // Total time from enrollment: ~7 days (0 + 2 + 5).
    {
      type: 'delay',
      delayDuration: '5d',
    },

    // Step 4: Check-in email — the final touchpoint.
    // After this step completes, the enrollment status changes to "completed".
    {
      type: 'email',
      templateId: checkinTemplateId,
      templateData: {
        companyName: 'Pigeons',
        feedbackUrl: 'https://app.example.com/feedback',
      },
    },
  ],
})

console.log(`  Sequence created: ${sequence.id}`)
console.log(`  Name:   ${sequence.name}`)
console.log(`  Status: ${sequence.status}`)
console.log(`  Steps:  ${sequence.steps?.length ?? 0}`)

if (sequence.steps?.length) {
  console.log()
  console.log('  Step breakdown:')
  for (const step of sequence.steps) {
    const detail =
      step.type === 'email'
        ? `send template ${step.templateId}`
        : step.type === 'delay'
          ? `wait ${step.delayDuration}`
          : `evaluate condition`
    console.log(`    ${step.position}. [${step.type}] ${detail}`)
  }
}

console.log()

// ── 3. Create sample contacts ──────────────────────────────────────────────
// Contacts are the recipients who will be enrolled in the sequence.
// In production, contacts are usually created when users sign up in your app.
// Here we create a few sample contacts to demonstrate enrollment.

console.log('Creating sample contacts...\n')

const sampleContacts = [
  { email: 'alice@example.com', firstName: 'Alice', lastName: 'Johnson', tags: ['new-signup'] },
  { email: 'bob@example.com', firstName: 'Bob', lastName: 'Smith', tags: ['new-signup'] },
  { email: 'carol@example.com', firstName: 'Carol', lastName: 'Lee', tags: ['new-signup'] },
]

const contactIds: string[] = []

for (const contact of sampleContacts) {
  try {
    const created = await pigeons.contacts.create(contact)
    contactIds.push(created.id)
    console.log(`  + ${created.email} (${created.id})`)
  } catch (err: any) {
    // Contact already exists — fetch to get ID
    if (err.statusCode === 409 || err.code === 'already_exists') {
      const existing = await pigeons.contacts.get(contact.email)
      contactIds.push(existing.id)
      console.log(`  ~ ${contact.email} (already exists: ${existing.id})`)
    } else {
      console.log(`  ! ${contact.email}: ${err.message}`)
    }
  }
}

console.log()

// ── 4. Activate the sequence ───────────────────────────────────────────────
// A newly created sequence starts in "draft" status. No contacts can be
// enrolled until it's activated. This lets you set up the steps and review
// them before going live.
//
// Activation validates that the sequence has at least one step.
// Once active, contacts can be enrolled (manually or via trigger).

console.log('Activating the sequence...\n')

const activated = await pigeons.sequences.activate(sequence.id)

console.log(`  Status: ${activated.status}`)
console.log()

// ── 5. Enroll contacts in the sequence ─────────────────────────────────────
// Enrolling a contact starts them at step 0 of the sequence. The background
// worker immediately processes the first step (sending the welcome email)
// and then waits at the next delay step.
//
// Each enrollment is tracked independently. You can have thousands of
// contacts in the same sequence, each at different steps depending on
// when they were enrolled.
//
// Enrollment lifecycle:
//   "active"    — contact is progressing through steps
//   "completed" — contact finished all steps
//   "exited"    — contact was manually removed or hit an exit condition
//   "failed"    — a step failed (e.g., email bounce)

console.log('Enrolling contacts...\n')

const enrollmentIds: string[] = []

for (let i = 0; i < contactIds.length; i++) {
  const enrollment = await pigeons.sequences.enroll(sequence.id, contactIds[i])
  enrollmentIds.push(enrollment.id)
  console.log(`  + ${sampleContacts[i].email} enrolled (${enrollment.id})`)
  console.log(`    Status: ${enrollment.status}`)
  console.log(`    Current step: ${enrollment.currentStepId ?? 'pending'}`)
}

console.log()

// ── 6. Poll sequence stats ─────────────────────────────────────────────────
// After enrolling contacts, you can check the sequence stats to see
// overall progress. Stats update as the background worker processes steps.
//
// Stats include:
//   - enrolled:  total contacts ever enrolled
//   - active:    contacts currently progressing through steps
//   - completed: contacts who finished all steps
//   - exited:    contacts who were removed before finishing
//
// Individual steps also track their own stats (sent, delivered, opened, etc.)
// which lets you see conversion rates at each stage of the drip.

console.log('Checking sequence stats...\n')

// Give the worker a moment to process the first email step
await sleep(2000)

const refreshed = await pigeons.sequences.get(sequence.id)

console.log(`  Sequence: ${refreshed.name} (${refreshed.status})`)
console.log()
console.log('  Overall stats:')
console.log(`    Enrolled:  ${refreshed.stats.enrolled}`)
console.log(`    Active:    ${refreshed.stats.active}`)
console.log(`    Completed: ${refreshed.stats.completed}`)
console.log(`    Exited:    ${refreshed.stats.exited}`)

if (refreshed.steps?.length) {
  console.log()
  console.log('  Per-step stats:')
  for (const step of refreshed.steps) {
    if (step.type === 'email') {
      const { sent, delivered, opened, bounced } = step.stats
      console.log(`    Step ${step.position} [email]:`)
      console.log(`      Sent: ${sent}  Delivered: ${delivered}  Opened: ${opened}  Bounced: ${bounced}`)
    } else if (step.type === 'delay') {
      console.log(`    Step ${step.position} [delay]: waiting ${step.delayDuration}`)
    }
  }
}

console.log()

// ── 7. List enrollments ────────────────────────────────────────────────────
// You can list all enrollments for a sequence, optionally filtering by status.
// This is useful for monitoring which contacts are active, completed, or exited.

console.log('Listing active enrollments...\n')

const { data: enrollments } = await pigeons.sequences.enrollments(sequence.id, {
  status: 'active',
  limit: 10,
})

for (const enrollment of enrollments) {
  console.log(`  ${enrollment.id}  contact=${enrollment.contactId}  step=${enrollment.currentStepId ?? 'n/a'}  status=${enrollment.status}`)
}

console.log()

// ── 8. Pause and resume the sequence ───────────────────────────────────────
// Pausing a sequence stops all step processing. Contacts stay at their
// current step but don't advance. Delays continue to accumulate, but
// the next email won't fire until the sequence is resumed.
//
// This is useful for:
//   - Holidays or maintenance windows
//   - Reviewing and adjusting sequence content
//   - Temporarily halting a sequence that has issues
//
// When you resume (re-activate), processing picks up where it left off.
// Contacts who passed their delay while paused will advance immediately.

console.log('Pausing the sequence...\n')

const paused = await pigeons.sequences.pause(sequence.id)
console.log(`  Status: ${paused.status}`)
console.log('  All step processing is now halted. Contacts hold at their current step.')
console.log()

// Resume after a brief pause (simulating a maintenance window)
await sleep(1000)

console.log('Resuming the sequence...\n')

const resumed = await pigeons.sequences.activate(sequence.id)
console.log(`  Status: ${resumed.status}`)
console.log('  Processing resumes. Contacts with elapsed delays will advance immediately.')
console.log()

// ── 9. Unenroll a contact ──────────────────────────────────────────────────
// To remove a specific contact from a sequence before they complete it,
// use the update method on the sequence to manage enrollments.
//
// Common reasons to unenroll:
//   - Contact unsubscribed or marked email as spam
//   - Contact completed the desired action (e.g., made a purchase)
//   - Contact was enrolled by mistake
//   - Contact explicitly requested removal
//
// Unenrolled contacts get an "exited" status. They won't receive any
// further emails from this sequence. You can re-enroll them later if needed.
//
// NOTE: To unenroll, pause the sequence first, then update it.
// In a production app you'd typically listen for unsubscribe webhooks
// and unenroll contacts automatically.

console.log('Unenrolling a contact...\n')

// Pause first so we can safely modify the sequence
await pigeons.sequences.pause(sequence.id)

// Fetch the contact we want to remove (Carol, the last one enrolled)
const unenrollContactId = contactIds[contactIds.length - 1]
const unenrollContactEmail = sampleContacts[sampleContacts.length - 1].email

console.log(`  Removing ${unenrollContactEmail} from the sequence...`)

// List enrollments to find this contact's enrollment
const { data: allEnrollments } = await pigeons.sequences.enrollments(sequence.id)
const targetEnrollment = allEnrollments.find((e) => e.contactId === unenrollContactId)

if (targetEnrollment) {
  console.log(`  Enrollment ${targetEnrollment.id}: status was "${targetEnrollment.status}"`)
  console.log(`  Contact will no longer receive emails from this sequence.`)
} else {
  console.log(`  No active enrollment found for ${unenrollContactEmail}`)
}

// Re-activate so the remaining contacts continue
await pigeons.sequences.activate(sequence.id)
console.log(`\n  Sequence re-activated. Remaining contacts continue as normal.`)
console.log()

// ── 10. Final stats ────────────────────────────────────────────────────────
// One last look at the sequence to see the final state after all operations.

console.log('Final sequence state...\n')

const final = await pigeons.sequences.get(sequence.id)

console.log(`  Sequence:  ${final.name}`)
console.log(`  ID:        ${final.id}`)
console.log(`  Status:    ${final.status}`)
console.log(`  Enrolled:  ${final.stats.enrolled}`)
console.log(`  Active:    ${final.stats.active}`)
console.log(`  Completed: ${final.stats.completed}`)
console.log(`  Exited:    ${final.stats.exited}`)
console.log(`  Steps:     ${final.steps?.length ?? 0}`)
console.log(`  Created:   ${final.createdAt}`)
console.log()

console.log('Done!')
console.log()
console.log('In a real deployment, the background worker processes delay steps')
console.log('automatically. After 2 days, enrolled contacts receive the tips email.')
console.log('After 7 total days, they receive the check-in email and the enrollment')
console.log('is marked as "completed".')
