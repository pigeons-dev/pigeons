import { NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// GET /api/dashboard/stats
//
// Returns aggregated email stats for your admin dashboard.
// Combines data from two sources:
//
//   1. Pigeons global stats API — delivery rates, bounce rates, complaint
//      rates, and open rates across 24h / 7d / 30d windows. Also includes
//      top sending domains with per-domain delivery rates.
//
//   2. Campaign stats — completion rates and per-campaign delivery metrics.
//
// This gives you a complete picture of your email health:
//   - Are emails being delivered? (delivery rate)
//   - Are you hitting spam traps? (complaint rate — keep under 0.1%)
//   - Are addresses valid? (bounce rate — keep under 5%)
//   - Are recipients engaged? (open rate)
//   - Which campaigns performed best?
//
// In production, you'd cache these results (e.g. 60s TTL) to avoid
// hitting the Pigeons API on every dashboard page load.
export async function GET() {
  try {
    // Fetch global stats and recent campaigns in parallel.
    // This is more efficient than sequential requests — the Pigeons
    // API handles them independently.
    const [globalStats, campaigns] = await Promise.all([
      pigeons.stats.get(),
      pigeons.campaigns.list({ limit: 10 }),
    ])

    // Build the dashboard response.
    // The global stats give you aggregate rates, while the campaign
    // list gives you per-campaign breakdowns for your campaigns table.
    const dashboard = {
      // Aggregate stats across all emails (transactional + campaigns)
      overview: {
        last24h: {
          sent: globalStats.last24h.sent,
          delivered: globalStats.last24h.delivered,
          bounced: globalStats.last24h.bounced,
          complained: globalStats.last24h.complained,
          opened: globalStats.last24h.opened,
          deliveryRate: globalStats.last24h.deliveryRate,
          bounceRate: globalStats.last24h.bounceRate,
          complaintRate: globalStats.last24h.complaintRate,
          openRate: globalStats.last24h.openRate,
        },
        last7d: {
          sent: globalStats.last7d.sent,
          delivered: globalStats.last7d.delivered,
          bounced: globalStats.last7d.bounced,
          complained: globalStats.last7d.complained,
          opened: globalStats.last7d.opened,
          deliveryRate: globalStats.last7d.deliveryRate,
          bounceRate: globalStats.last7d.bounceRate,
          complaintRate: globalStats.last7d.complaintRate,
          openRate: globalStats.last7d.openRate,
        },
        last30d: {
          sent: globalStats.last30d.sent,
          delivered: globalStats.last30d.delivered,
          bounced: globalStats.last30d.bounced,
          complained: globalStats.last30d.complained,
          opened: globalStats.last30d.opened,
          deliveryRate: globalStats.last30d.deliveryRate,
          bounceRate: globalStats.last30d.bounceRate,
          complaintRate: globalStats.last30d.complaintRate,
          openRate: globalStats.last30d.openRate,
        },
      },

      // Per-domain breakdown — useful for multi-domain setups
      // to spot domain-specific deliverability issues.
      topDomains: globalStats.topDomains,

      // Recent campaigns with their stats.
      // Each campaign includes total, sent, delivered, opened,
      // bounced, complained, and failed counts.
      recentCampaigns: campaigns.data.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        stats: c.stats,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
      })),
    }

    return NextResponse.json(dashboard)
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to load stats'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
