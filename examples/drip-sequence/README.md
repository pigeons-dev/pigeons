# Drip Sequence

Build a multi-step onboarding drip sequence that sends a series of emails to new users over time, with configurable delays between each step.

## What you'll learn

- Create reusable email templates for each step in a sequence
- Define a sequence with ordered email and delay steps
- Configure delay durations between emails (days, hours, minutes)
- Enroll contacts and manage their progression through steps
- Monitor sequence stats and per-step delivery metrics
- Pause and resume a running sequence
- Unenroll contacts before they complete the sequence
- Understand enrollment lifecycle states (active, completed, exited, failed)

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with `sequences:write`, `templates:write`, and `contacts:write` scopes

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
Creating onboarding templates...

  + onboarding-welcome (tpl_abc123)
  + onboarding-tips (tpl_def456)
  + onboarding-checkin (tpl_ghi789)

Creating "User Onboarding" sequence...

  Sequence created: seq_abc123
  Name:   User Onboarding
  Status: draft
  Steps:  5

  Step breakdown:
    0. [email] send template tpl_abc123
    1. [delay] wait 2d
    2. [email] send template tpl_def456
    3. [delay] wait 5d
    4. [email] send template tpl_ghi789

Creating sample contacts...

  + alice@example.com (ctc_abc123)
  + bob@example.com (ctc_def456)
  + carol@example.com (ctc_ghi789)

Activating the sequence...

  Status: active

Enrolling contacts...

  + alice@example.com enrolled (enr_abc123)
    Status: active
    Current step: stp_abc123
  + bob@example.com enrolled (enr_def456)
    Status: active
    Current step: stp_abc123
  + carol@example.com enrolled (enr_ghi789)
    Status: active
    Current step: stp_abc123

Checking sequence stats...

  Sequence: User Onboarding (active)

  Overall stats:
    Enrolled:  3
    Active:    3
    Completed: 0
    Exited:    0

  Per-step stats:
    Step 0 [email]:
      Sent: 3  Delivered: 3  Opened: 0  Bounced: 0
    Step 1 [delay]: waiting 2d
    Step 2 [email]:
      Sent: 0  Delivered: 0  Opened: 0  Bounced: 0
    Step 3 [delay]: waiting 5d
    Step 4 [email]:
      Sent: 0  Delivered: 0  Opened: 0  Bounced: 0

Listing active enrollments...

  enr_abc123  contact=ctc_abc123  step=stp_def456  status=active
  enr_def456  contact=ctc_def456  step=stp_def456  status=active
  enr_ghi789  contact=ctc_ghi789  step=stp_def456  status=active

Pausing the sequence...

  Status: paused
  All step processing is now halted. Contacts hold at their current step.

Resuming the sequence...

  Status: active
  Processing resumes. Contacts with elapsed delays will advance immediately.

Unenrolling a contact...

  Removing carol@example.com from the sequence...
  Enrollment enr_ghi789: status was "active"
  Contact will no longer receive emails from this sequence.

  Sequence re-activated. Remaining contacts continue as normal.

Final sequence state...

  Sequence:  User Onboarding
  ID:        seq_abc123
  Status:    active
  Enrolled:  3
  Active:    2
  Completed: 0
  Exited:    1
  Steps:     5
  Created:   2026-10-17T...

Done!

In a real deployment, the background worker processes delay steps
automatically. After 2 days, enrolled contacts receive the tips email.
After 7 total days, they receive the check-in email and the enrollment
is marked as "completed".
```

## Sequence lifecycle

```
                    create
                      |
                      v
  +-----------+   activate   +-----------+
  |   draft   | -----------> |  active   |<----+
  +-----------+              +-----------+     |
                                |     |        |
                          pause |     | enroll |  activate
                                v     v        |  (resume)
                           +-----------+       |
                           |  paused   |-------+
                           +-----------+

  Enrollment states:

  enroll -> [active] -> step 0 -> delay -> step 2 -> delay -> step 4 -> [completed]
                |                                                 |
                +------- unenroll/bounce -------> [exited]        |
                |                                                 |
                +------- step failure ----------> [failed]        |
```

**Sequence statuses:**
- `draft`  - created but not yet activated. Steps can be edited freely.
- `active`  - processing enrollments. Contacts progress through steps.
- `paused`  - processing halted. Contacts hold at their current step.
- `archived`  - sequence is retired. No new enrollments or processing.

**Enrollment statuses:**
- `active`  - contact is progressing through steps.
- `completed`  - contact finished all steps successfully.
- `exited`  - contact was removed before completing (manual unenroll, unsubscribe).
- `failed`  - a step failed permanently (e.g., hard bounce).

## Code walkthrough

### 1. Templates

Each email in the sequence uses a stored template. Templates support Handlebars-style variables (`{{firstName}}`, `{{companyName}}`) that are populated with data at send time.

```typescript
const id = await pigeons.templates.create({
  slug: 'onboarding-welcome',
  name: 'Onboarding: Welcome',
  subject: 'Welcome to {{companyName}}, {{firstName}}!',
  body: '<h1>Welcome, {{firstName}}!</h1>...',
})
```

### 2. Sequence definition

A sequence is an ordered list of steps. Steps execute top-to-bottom. Each step has a `type`:

- `email`  - sends an email using a template, with optional `templateData` for variables
- `delay`  - pauses for a duration (`"2d"`, `"12h"`, `"30m"`)
- `condition`  - (advanced) branches based on contact properties or behavior

```typescript
const sequence = await pigeons.sequences.create({
  name: 'User Onboarding',
  steps: [
    { type: 'email', templateId: '...', templateData: { ... } },
    { type: 'delay', delayDuration: '2d' },
    { type: 'email', templateId: '...', templateData: { ... } },
  ],
})
```

### 3. Enrollment

Enrolling a contact starts them at step 0. The background worker processes steps automatically.

```typescript
const enrollment = await pigeons.sequences.enroll(sequence.id, contactId)
// enrollment.status === 'active'
// enrollment.currentStepId === first step ID
```

### 4. Stats and monitoring

The sequence object includes aggregate stats. Individual steps track email delivery metrics.

```typescript
const seq = await pigeons.sequences.get(sequence.id)
console.log(seq.stats)        // { enrolled, active, completed, exited }
console.log(seq.steps[0].stats) // { sent, delivered, opened, bounced, complained }
```

### 5. Pause/resume

Pausing halts all processing. Contacts stay at their current step. Resuming picks up where it left off.

```typescript
await pigeons.sequences.pause(sequence.id)   // status -> 'paused'
await pigeons.sequences.activate(sequence.id) // status -> 'active'
```

## Common patterns

### Onboarding sequence

Welcome new users with a series of helpful emails over their first week:

| Day | Email | Purpose |
|-----|-------|---------|
| 0 | Welcome | Getting started, key links |
| 2 | Tips | Feature highlights, best practices |
| 5 | Check-in | Ask for feedback, offer help |

### Re-engagement sequence

Win back inactive users:

| Day | Email | Purpose |
|-----|-------|---------|
| 0 | We miss you | Highlight new features since last visit |
| 3 | Special offer | Discount or incentive to return |
| 7 | Last chance | Final reminder before archiving |

### Trial conversion sequence

Convert free trial users to paid:

| Day | Email | Purpose |
|-----|-------|---------|
| 0 | Trial started | What's included, how to get value fast |
| 5 | Mid-trial | Success stories, advanced features |
| 12 | Trial ending | Urgency, comparison of plans |
| 14 | Trial expired | Grace period offer |

## Next steps

- [email-templates](../email-templates/)  - Build a full template library with React Email components
- [inbound-webhook-handler](../inbound-webhook-handler/)  - Handle delivery/bounce events to auto-exit bounced contacts
- [mcp-claude-agent](../mcp-claude-agent/)  - Let an AI agent manage sequences and enrollments
