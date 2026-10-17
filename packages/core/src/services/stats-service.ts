import { sql, eq, and, gte, like } from 'drizzle-orm'
import { emails, domains } from '../db/schema.js'
import { NotFoundError } from '../utils/errors.js'
import type { DB } from '../db/index.js'

interface PeriodStats {
  sent: number
  delivered: number
  opened: number
  bounced: number
  complained: number
  failed: number
  deliveryRate: number
  bounceRate: number
  complaintRate: number
  openRate: number
}

interface StatsResponse {
  last24h: PeriodStats
  last7d: PeriodStats
  last30d: PeriodStats
}

export interface DomainStatsResponse extends StatsResponse {
  domain: string
  domainId: string
  warmup: WarmupGuidance
}

export interface GlobalStatsResponse extends StatsResponse {
  topDomains: Array<{ domain: string; sent: number; deliveryRate: number }>
}

interface WarmupGuidance {
  phase: 'new' | 'warming' | 'established'
  dailyLimit: number
  recommendation: string
}

function periodCutoff(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString()
}

function computeRates(stats: Omit<PeriodStats, 'deliveryRate' | 'bounceRate' | 'complaintRate' | 'openRate'>): PeriodStats {
  const { sent, delivered, opened, bounced, complained, failed } = stats
  return {
    ...stats,
    deliveryRate: sent > 0 ? round(delivered / sent) : 0,
    bounceRate: sent > 0 ? round(bounced / sent) : 0,
    complaintRate: delivered > 0 ? round(complained / delivered) : 0,
    openRate: delivered > 0 ? round(opened / delivered) : 0,
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

async function aggregateEmails(
  db: DB,
  since: string,
  domainPattern?: string,
): Promise<PeriodStats> {
  const conditions = [gte(emails.createdAt, since)]
  if (domainPattern) {
    conditions.push(like(emails.from, `%@${domainPattern}`))
  }

  const rows = await db
    .select({
      status: emails.status,
      trackOpens: emails.trackOpens,
      openCount: emails.openCount,
    })
    .from(emails)
    .where(and(...conditions))

  let sent = 0
  let delivered = 0
  let opened = 0
  let bounced = 0
  let complained = 0
  let failed = 0

  for (const row of rows) {
    const s = row.status
    if (s === 'sent' || s === 'delivered' || s === 'bounced' || s === 'complained') sent++
    if (s === 'delivered') delivered++
    if (s === 'bounced') bounced++
    if (s === 'complained') complained++
    if (s === 'failed') failed++
    if (row.trackOpens && row.openCount > 0) opened++
  }

  return computeRates({ sent, delivered, opened, bounced, complained, failed })
}

function computeWarmup(domainCreatedAt: string, last7dSent: number): WarmupGuidance {
  const ageDays = Math.floor((Date.now() - new Date(domainCreatedAt).getTime()) / 86_400_000)

  if (ageDays < 7) {
    return {
      phase: 'new',
      dailyLimit: 200,
      recommendation: 'Send to your most engaged recipients first. Keep volume under 200/day for the first week.',
    }
  }

  const dailyAvg = Math.round(last7dSent / 7)

  if (ageDays < 30 || dailyAvg < 50) {
    return {
      phase: 'warming',
      dailyLimit: Math.min(dailyAvg * 2, 10000),
      recommendation: `Gradually increase volume. Current average: ${dailyAvg}/day. Safe to double, but avoid sudden spikes.`,
    }
  }

  return {
    phase: 'established',
    dailyLimit: dailyAvg * 3,
    recommendation: 'Domain is warmed. Monitor bounce rate (<5%) and complaint rate (<0.08%) to maintain reputation.',
  }
}

export async function getDomainStats(db: DB, domainId: string): Promise<DomainStatsResponse> {
  const [dom] = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1)
  if (!dom) throw new NotFoundError('Domain', domainId)

  const [last24h, last7d, last30d] = await Promise.all([
    aggregateEmails(db, periodCutoff(1), dom.domain),
    aggregateEmails(db, periodCutoff(7), dom.domain),
    aggregateEmails(db, periodCutoff(30), dom.domain),
  ])

  return {
    domainId: dom.id,
    domain: dom.domain,
    last24h,
    last7d,
    last30d,
    warmup: computeWarmup(dom.createdAt, last7d.sent),
  }
}

export async function getGlobalStats(db: DB): Promise<GlobalStatsResponse> {
  const [last24h, last7d, last30d] = await Promise.all([
    aggregateEmails(db, periodCutoff(1)),
    aggregateEmails(db, periodCutoff(7)),
    aggregateEmails(db, periodCutoff(30)),
  ])

  const allDomains = await db.select().from(domains)
  const topDomains: GlobalStatsResponse['topDomains'] = []

  for (const dom of allDomains) {
    const stats = await aggregateEmails(db, periodCutoff(30), dom.domain)
    topDomains.push({
      domain: dom.domain,
      sent: stats.sent,
      deliveryRate: stats.deliveryRate,
    })
  }

  topDomains.sort((a, b) => b.sent - a.sent)

  return { last24h, last7d, last30d, topDomains: topDomains.slice(0, 10) }
}
