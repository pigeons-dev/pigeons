# Delivery Monitor

Monitor email deliverability across your Pigeons instance. Fetches stats, checks domain health, categorizes bounces, and prints a formatted dashboard with health scoring and alerts.

## What you'll learn

- Fetch global and per-domain delivery statistics with the stats API
- Understand deliverability metrics: delivery rate, bounce rate, complaint rate
- Calculate a composite health score with weighted thresholds
- Generate alerts based on industry-standard limits (SES, Gmail, Yahoo)
- Inspect domain authentication status (SPF, DKIM, DMARC)

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with `emails:read`, `domains:read`, and `stats:read` scopes

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

Expected output:

```
═══ Deliverability Dashboard ═══

────────────────────────────────────────────────────

  Domain Health:
    example.com          ✓ verified     SPF ✓  DKIM ✓  DMARC ✓

  Delivery Stats (last 30 days):
    Sent:          1,247
    Delivered:     1,219  (97.8%)
    Bounced:          18  (1.4%)
    Complained:        3  (0.2%)
    Failed:            7  (0.6%)

  Health Score: 96/100 (Excellent)

  Score Breakdown:
    Delivery rate:   50/50
    Bounce rate:     26/30
    Complaint rate:  20/20

────────────────────────────────────────────────────

  Recent Bounces:
    msg_abc123 → bounced → user@invalid.com
    msg_def456 → bounced → full@mailbox.com

  Recent Complaints:
    msg_ghi789 → complaint → user@example.com  "Special Offer"

────────────────────────────────────────────────────

  Alerts:
    ⚠ Complaint rate 0.2% above 0.1%  - review recent sends

Done!
```

## Understanding the metrics

### Delivery rate

The percentage of emails accepted by the receiving mail server. Industry benchmark is 95%+. Below 90% indicates serious problems  - check your DNS records, sender reputation, and whether your IP is on any blocklists.

### Bounce types

- **Hard bounce**: Permanent failure. The email address doesn't exist, the domain has no mail server, or the recipient server explicitly rejected the message. Remove hard-bounced addresses immediately  - continuing to send to them damages your sender reputation with ISPs.
- **Soft bounce**: Temporary failure. The recipient's mailbox is full, the server is temporarily down, or the message exceeded size limits. SES retries soft bounces automatically. If the same address soft-bounces repeatedly across multiple days, treat it as a hard bounce.

AWS SES enforces a hard limit at ~5% bounce rate. Above that, your account risks suspension.

### Complaint rate

The percentage of recipients who clicked "Report Spam" in their email client. This is the most dangerous metric  - ISPs weight complaints far more heavily than bounces.

- **0.1%**: Gmail and Yahoo postmaster guidelines flag accounts at this level. SES begins monitoring.
- **0.3%**: SES escalates to enforcement action (sending throttled or paused).
- **0.5%+**: Account suspension likely.

Common causes: sending to unsubscribed users, missing unsubscribe links, misleading subject lines, purchased email lists.

### Domain authentication

Three DNS records form the email authentication triad:

- **SPF** (Sender Policy Framework): Declares which IP addresses are authorized to send email for your domain. Without SPF, any server can claim to send as you.
- **DKIM** (DomainKeys Identified Mail): Adds a cryptographic signature to each email proving it wasn't modified in transit. SES handles DKIM signing automatically once the domain is verified.
- **DMARC** (Domain-based Message Authentication, Reporting & Conformance): Tells receiving servers what to do when SPF or DKIM checks fail (none/quarantine/reject). Also enables aggregate reports from ISPs about your domain's email traffic.

All three should be configured and passing for optimal deliverability.

## Code walkthrough

The script follows five steps:

1. **`pigeons.stats.get()`**  - Fetches global delivery statistics aggregated across all domains. Returns metrics for three time windows: last 24 hours, last 7 days, and last 30 days. The dashboard uses the 30-day window because it smooths daily variance.

2. **`pigeons.domains.list()`**  - Lists all configured domains with their verification status and authentication record states (SPF, DKIM, DMARC).

3. **`pigeons.emails.list({ status: 'bounced' })`**  - Fetches recent bounced emails. In production you'd parse the webhook event payload for `bounceType` (Permanent vs. Transient) and `bounceSubType` for finer categorization.

4. **`pigeons.emails.list({ status: 'complained' })`**  - Fetches recent complaint emails. Cross-reference these with your unsubscribe process to find gaps.

5. **Health scoring**  - A weighted composite score (0-100) combining delivery rate (50 points), bounce rate (30 points), and complaint rate (20 points). Thresholds are based on AWS SES enforcement limits and major ISP postmaster guidelines.

## Automating monitoring

### Cron schedule

Run the monitor on a schedule to catch problems early:

```bash
# Run every 6 hours
0 */6 * * * cd /path/to/delivery-monitor && npx tsx src/index.ts >> /var/log/pigeons-monitor.log 2>&1
```

### Webhook integration

For real-time monitoring, register a webhook to receive bounce and complaint events as they happen instead of polling:

```typescript
const pigeons = new Pigeons()

await pigeons.webhooks.create({
  url: 'https://your-app.com/webhooks/pigeons',
  events: ['email.bounced', 'email.complained'],
})
```

Your webhook handler can then trigger alerts, update suppression lists, or page on-call when complaint rates spike. See the [inbound-webhook-handler](../inbound-webhook-handler/) example for a full webhook server implementation.

## Next steps

- [inbound-webhook-handler](../inbound-webhook-handler/)  - Handle delivery events in real-time with webhooks
- [campaign-send](../campaign-send/)  - Send campaigns and track per-campaign delivery stats
- [with-typescript](../with-typescript/)  - Basic send/check/list flow
