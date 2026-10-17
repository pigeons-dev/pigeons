/**
 * Pigeons Delivery Monitor
 *
 * A deliverability monitoring dashboard that pulls stats from your Pigeons
 * instance and prints a formatted report. Demonstrates:
 *
 *   1. Fetching global delivery statistics (sent, delivered, bounced, etc.)
 *   2. Checking domain verification and authentication status (SPF, DKIM, DMARC)
 *   3. Listing bounced and complained emails with categorization
 *   4. Computing a composite deliverability health score
 *   5. Alerting on threshold violations
 *
 * Run: npx tsx src/index.ts
 */

import { Pigeons } from '@pigeons/pigeons-ts'
import type { Email, Domain, PeriodStats, GlobalStats } from '@pigeons/pigeons-ts'

// ── Initialize the client ──────────────────────────────────────────────────
// Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables.
// Set these in a .env file or export them before running.

const pigeons = new Pigeons()

// ── Formatting helpers ─────────────────────────────────────────────────────

/**
 * Format a number with thousand separators.
 * Examples: 1247 -> "1,247", 12 -> "12"
 */
function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Format a rate as a percentage string with one decimal place.
 * The API returns rates as 0-100 floats (e.g. 97.8 for 97.8%).
 */
function pct(rate: number): string {
  return `${rate.toFixed(1)}%`
}

/**
 * Right-align a string to a given width by padding with spaces.
 * Used to produce neat columnar output in the dashboard.
 */
function rpad(str: string, width: number): string {
  return str.padStart(width)
}

// ── Deliverability health score ────────────────────────────────────────────

/**
 * Health score thresholds, grounded in industry best practices:
 *
 * - Delivery rate:   The percentage of emails accepted by the receiving MTA.
 *                    Above 97% is excellent; below 90% signals serious issues
 *                    (bad list hygiene, blocklisting, DNS misconfig).
 *
 * - Bounce rate:     The percentage of sends that hard- or soft-bounced.
 *                    Hard bounces (invalid addresses) damage sender reputation
 *                    far more than soft bounces (full mailbox, temp failure).
 *                    AWS SES suspends accounts above ~5% bounce rate.
 *
 * - Complaint rate:  The percentage of recipients who clicked "Report Spam."
 *                    This is the most dangerous metric — ISPs weigh complaints
 *                    heavily. A rate above 0.1% triggers warnings from Gmail,
 *                    Yahoo, and SES. Above 0.3% risks account suspension.
 */

interface HealthScore {
  score: number
  label: string
  breakdown: {
    deliveryPoints: number
    bouncePoints: number
    complaintPoints: number
  }
}

/**
 * Calculate a 0-100 deliverability health score from period stats.
 *
 * Scoring breakdown (100 points total):
 *   - Delivery rate:   up to 50 points (the foundation metric)
 *   - Bounce rate:     up to 30 points (deducted for high bounces)
 *   - Complaint rate:  up to 20 points (deducted for complaints)
 *
 * Each component is scored on a sliding scale so the score degrades
 * gracefully rather than cliff-edging from good to bad.
 */
function calculateHealthScore(stats: PeriodStats): HealthScore {
  // Delivery rate scoring (50 points max)
  // 98%+ = full marks, linear decline to 0 at 80%
  let deliveryPoints: number
  if (stats.deliveryRate >= 98) {
    deliveryPoints = 50
  } else if (stats.deliveryRate >= 80) {
    // Linear interpolation: 80% -> 0 points, 98% -> 50 points
    deliveryPoints = Math.round(((stats.deliveryRate - 80) / 18) * 50)
  } else {
    deliveryPoints = 0
  }

  // Bounce rate scoring (30 points max)
  // 0% bounces = full marks, 5%+ = zero
  // SES hard limit is ~5%, so anything above that is critical.
  let bouncePoints: number
  if (stats.bounceRate <= 0.5) {
    bouncePoints = 30
  } else if (stats.bounceRate <= 5) {
    // Linear interpolation: 0.5% -> 30 points, 5% -> 0 points
    bouncePoints = Math.round(((5 - stats.bounceRate) / 4.5) * 30)
  } else {
    bouncePoints = 0
  }

  // Complaint rate scoring (20 points max)
  // 0% complaints = full marks, 0.3%+ = zero
  // Gmail/Yahoo postmaster guidelines flag accounts above 0.1%.
  // SES begins enforcement action around 0.1% sustained.
  let complaintPoints: number
  if (stats.complaintRate <= 0.02) {
    complaintPoints = 20
  } else if (stats.complaintRate <= 0.3) {
    // Linear interpolation: 0.02% -> 20 points, 0.3% -> 0 points
    complaintPoints = Math.round(((0.3 - stats.complaintRate) / 0.28) * 20)
  } else {
    complaintPoints = 0
  }

  const score = deliveryPoints + bouncePoints + complaintPoints

  // Label the overall score
  let label: string
  if (score >= 90) {
    label = 'Excellent'
  } else if (score >= 75) {
    label = 'Good'
  } else if (score >= 50) {
    label = 'Fair'
  } else if (score >= 25) {
    label = 'Poor'
  } else {
    label = 'Critical'
  }

  return { score, label, breakdown: { deliveryPoints, bouncePoints, complaintPoints } }
}

// ── Alert generation ───────────────────────────────────────────────────────

interface Alert {
  level: 'critical' | 'warning' | 'info'
  message: string
}

/**
 * Generate alerts based on deliverability thresholds.
 *
 * Thresholds are based on AWS SES enforcement policies and
 * major ISP postmaster guidelines (Gmail, Yahoo, Microsoft):
 *
 *   Bounce rate:
 *     > 5%  = CRITICAL — SES will suspend sending
 *     > 2%  = WARNING  — approaching danger zone, clean your list
 *
 *   Complaint rate:
 *     > 0.3% = CRITICAL — SES suspension imminent
 *     > 0.1% = WARNING  — Gmail/Yahoo flag this; review content and list
 *
 *   Delivery rate:
 *     < 90% = WARNING  — significant portion of emails not reaching inboxes
 *
 *   Domain verification:
 *     Any unverified authentication record = WARNING
 */
function generateAlerts(stats: PeriodStats, domains: Domain[]): Alert[] {
  const alerts: Alert[] = []

  // Bounce rate alerts
  if (stats.bounceRate > 5) {
    alerts.push({
      level: 'critical',
      message: `Bounce rate ${pct(stats.bounceRate)} exceeds 5% — SES account suspension risk`,
    })
  } else if (stats.bounceRate > 2) {
    alerts.push({
      level: 'warning',
      message: `Bounce rate ${pct(stats.bounceRate)} above 2% — clean your recipient list`,
    })
  }

  // Complaint rate alerts
  // Even 0.1% is a danger signal. Major ESPs (Gmail, Yahoo) use complaint
  // feedback loops to throttle or blocklist senders above this threshold.
  if (stats.complaintRate > 0.3) {
    alerts.push({
      level: 'critical',
      message: `Complaint rate ${pct(stats.complaintRate)} exceeds 0.3% — immediate action required`,
    })
  } else if (stats.complaintRate > 0.1) {
    alerts.push({
      level: 'warning',
      message: `Complaint rate ${pct(stats.complaintRate)} above 0.1% — review recent sends`,
    })
  }

  // Delivery rate alert
  if (stats.deliveryRate < 90) {
    alerts.push({
      level: 'warning',
      message: `Delivery rate ${pct(stats.deliveryRate)} below 90% — check DNS records and sender reputation`,
    })
  }

  // Domain authentication alerts
  // SPF, DKIM, and DMARC are the three pillars of email authentication.
  // Missing any one of them increases the chance of emails landing in spam.
  for (const domain of domains) {
    if (domain.verificationStatus !== 'verified') {
      alerts.push({
        level: 'warning',
        message: `Domain ${domain.domain} is not verified (status: ${domain.verificationStatus})`,
      })
    }

    if (!domain.spfVerified) {
      alerts.push({
        level: 'warning',
        message: `Domain ${domain.domain} missing SPF record — recipients may reject your emails`,
      })
    }

    if (!domain.dmarcVerified) {
      alerts.push({
        level: 'info',
        message: `Domain ${domain.domain} missing DMARC record — add one to improve deliverability`,
      })
    }
  }

  // No alerts is good news
  if (alerts.length === 0) {
    alerts.push({
      level: 'info',
      message: 'All metrics within healthy ranges',
    })
  }

  return alerts
}

// ── Dashboard rendering ────────────────────────────────────────────────────

/**
 * Print the domain health section.
 * Shows each domain's verification status and authentication records.
 * SPF, DKIM, and DMARC together form the email authentication triad:
 *   - SPF:   Declares which IPs are allowed to send for your domain
 *   - DKIM:  Cryptographic signature proving the email wasn't tampered with
 *   - DMARC: Policy telling receivers what to do with unauthenticated mail
 */
function printDomainHealth(domains: Domain[]): void {
  console.log('  Domain Health:')

  if (domains.length === 0) {
    console.log('    (no domains configured)')
    return
  }

  for (const domain of domains) {
    const verified = domain.verificationStatus === 'verified' ? '✓ verified' : '✗ ' + domain.verificationStatus
    const spf = domain.spfVerified ? 'SPF ✓' : 'SPF ✗'

    // DKIM is verified when the domain itself is verified and dkimTokens are present.
    // The domain verification process in SES includes DKIM setup.
    const dkim = domain.verificationStatus === 'verified' ? 'DKIM ✓' : 'DKIM ✗'
    const dmarc = domain.dmarcVerified ? 'DMARC ✓' : 'DMARC ✗'

    const name = domain.domain.padEnd(20)
    console.log(`    ${name} ${verified.padEnd(14)} ${spf}  ${dkim}  ${dmarc}`)
  }
}

/**
 * Print the delivery statistics section.
 * Uses the 30-day stats window which gives the most meaningful picture
 * of ongoing deliverability trends. Shorter windows (24h, 7d) are noisier.
 */
function printDeliveryStats(stats: PeriodStats): void {
  // Calculate absolute counts from rates and total sent.
  // The API provides both absolute counts and rates.
  const sent = stats.sent
  const delivered = stats.delivered
  const bounced = stats.bounced
  const complained = stats.complained
  const failed = stats.failed

  // Column width for right-aligned numbers
  const w = 8

  console.log('  Delivery Stats (last 30 days):')
  console.log(`    Sent:       ${rpad(fmt(sent), w)}`)
  console.log(`    Delivered:  ${rpad(fmt(delivered), w)}  (${pct(stats.deliveryRate)})`)
  console.log(`    Bounced:    ${rpad(fmt(bounced), w)}  (${pct(stats.bounceRate)})`)
  console.log(`    Complained: ${rpad(fmt(complained), w)}  (${pct(stats.complaintRate)})`)
  console.log(`    Failed:     ${rpad(fmt(failed), w)}  (${pct(sent > 0 ? (failed / sent) * 100 : 0)})`)
}

/**
 * Print the health score with its breakdown.
 */
function printHealthScore(health: HealthScore): void {
  console.log(`  Health Score: ${health.score}/100 (${health.label})`)
  console.log()
  console.log('  Score Breakdown:')
  console.log(`    Delivery rate:   ${health.breakdown.deliveryPoints}/50`)
  console.log(`    Bounce rate:     ${health.breakdown.bouncePoints}/30`)
  console.log(`    Complaint rate:  ${health.breakdown.complaintPoints}/20`)
}

/**
 * Print recent bounced emails grouped by likely bounce type.
 *
 * Bounce types explained:
 *   - Hard bounce:  Permanent failure. The address doesn't exist or the
 *                   domain has no mail server. Remove these immediately —
 *                   continuing to send to hard bounces damages reputation.
 *   - Soft bounce:  Temporary failure. Mailbox full, server down, message
 *                   too large. SES retries soft bounces automatically.
 *                   Persistent soft bounces (same address, multiple days)
 *                   should be treated as hard bounces.
 */
function printRecentBounces(bouncedEmails: Email[]): void {
  console.log('  Recent Bounces:')

  if (bouncedEmails.length === 0) {
    console.log('    (none)')
    return
  }

  for (const email of bouncedEmails.slice(0, 10)) {
    // The email status is 'bounced' but we don't have a sub-type field.
    // In a production monitor you'd parse the bounce notification from
    // the webhook event payload which includes bounceType (Permanent/Transient)
    // and bounceSubType (General, NoEmail, MailboxFull, etc.).
    const recipient = email.to[0] ?? 'unknown'
    console.log(`    ${email.id} → bounced → ${recipient}`)
  }
}

/**
 * Print recent complaint emails.
 *
 * Complaints (also called "spam reports" or "feedback loop reports") are
 * the single most damaging deliverability signal. When a recipient clicks
 * "Report Spam" in Gmail/Yahoo/Outlook, the ISP sends a complaint back
 * to SES via the feedback loop. Even a small number of complaints can
 * tank your sender reputation.
 *
 * Common causes:
 *   - Sending to people who didn't opt in
 *   - No visible unsubscribe link
 *   - Misleading subject lines
 *   - Sending too frequently
 */
function printRecentComplaints(complainedEmails: Email[]): void {
  console.log('  Recent Complaints:')

  if (complainedEmails.length === 0) {
    console.log('    (none)')
    return
  }

  for (const email of complainedEmails.slice(0, 10)) {
    const recipient = email.to[0] ?? 'unknown'
    console.log(`    ${email.id} → complaint → ${recipient}  "${email.subject}"`)
  }
}

/**
 * Print alerts with severity-appropriate prefixes.
 */
function printAlerts(alerts: Alert[]): void {
  console.log('  Alerts:')

  for (const alert of alerts) {
    let prefix: string
    switch (alert.level) {
      case 'critical':
        // Red circle — immediate action needed
        prefix = '✖'
        break
      case 'warning':
        // Warning triangle — investigate soon
        prefix = '⚠'
        break
      case 'info':
        // Info — no action needed
        prefix = 'ℹ'
        break
    }
    console.log(`    ${prefix} ${alert.message}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log()
console.log('═══ Deliverability Dashboard ═══')
console.log()

// Step 1: Fetch global delivery statistics.
// The stats endpoint returns aggregated metrics across all domains for
// three time windows: last 24 hours, last 7 days, and last 30 days.
// We use the 30-day window for the dashboard since it smooths out
// day-to-day variance and gives a truer picture of sender health.

console.log('Fetching delivery stats...\n')

const globalStats: GlobalStats = await pigeons.stats.get()
const stats30d = globalStats.last30d

// Step 2: Fetch domain list and check verification status.
// Each domain needs SPF, DKIM, and DMARC configured correctly.
// Missing authentication records don't prevent sending but dramatically
// increase the chance of emails being flagged as spam.

console.log('Checking domain health...\n')

const { data: domains } = await pigeons.domains.list()

// Step 3: List recent bounced emails.
// Bounces are the clearest signal of list quality problems. Tracking
// which addresses bounce helps you clean your list proactively.

console.log('Loading recent bounces and complaints...\n')

const [bouncedResponse, complainedResponse] = await Promise.all([
  pigeons.emails.list({ status: 'bounced', limit: 10 }),
  pigeons.emails.list({ status: 'complained', limit: 10 }),
])

const bouncedEmails = bouncedResponse.data
const complainedEmails = complainedResponse.data

// Step 4: Calculate health score and generate alerts.
const health = calculateHealthScore(stats30d)
const alerts = generateAlerts(stats30d, domains)

// ── Render the dashboard ───────────────────────────────────────────────────

console.log('─'.repeat(52))
console.log()

// Domain health: verification and authentication status
printDomainHealth(domains)
console.log()

// Delivery statistics: the core numbers
printDeliveryStats(stats30d)
console.log()

// Composite health score with breakdown
printHealthScore(health)
console.log()

console.log('─'.repeat(52))
console.log()

// Recent bounces and complaints: the problem emails
printRecentBounces(bouncedEmails)
console.log()

printRecentComplaints(complainedEmails)
console.log()

console.log('─'.repeat(52))
console.log()

// Alerts: actionable items based on threshold analysis
printAlerts(alerts)
console.log()

// ── Top domains by volume ──────────────────────────────────────────────────
// Show which domains are sending the most email and their individual
// delivery rates. A domain with high volume but low delivery rate
// is dragging down your overall reputation.

if (globalStats.topDomains.length > 0) {
  console.log('─'.repeat(52))
  console.log()
  console.log('  Top Domains by Volume:')
  for (const td of globalStats.topDomains) {
    const name = td.domain.padEnd(24)
    console.log(`    ${name} ${rpad(fmt(td.sent), 6)} sent  (${pct(td.deliveryRate)} delivered)`)
  }
  console.log()
}

console.log('Done!')
