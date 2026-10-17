import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { emails, campaigns, sequenceSteps } from '../db/schema.js'
import { fireWebhooks } from '../services/webhook-service.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

export function createTrackingRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.get('/:emailId', async (req, res) => {
    res.setHeader('Content-Type', 'image/gif')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
    res.end(PIXEL)

    try {
      const { emailId } = req.params

      const [email] = await db
        .select()
        .from(emails)
        .where(eq(emails.id, emailId))
        .limit(1)

      if (!email || !email.trackOpens) return

      const now = new Date().toISOString()
      const isFirstOpen = email.openCount === 0

      await db
        .update(emails)
        .set({
          openCount: email.openCount + 1,
          lastOpenedAt: now,
          ...(isFirstOpen ? { firstOpenedAt: now } : {}),
        })
        .where(eq(emails.id, email.id))

      if (isFirstOpen) {
        await updateCampaignOpenStats(db, email.tags as string[] | null)
        await fireWebhooks(db, 'email.opened', {
          email_id: email.id,
          opened_at: now,
        })
      }
    } catch {
      // Tracking failures must never break the pixel response
    }
  })

  return router
}

async function updateCampaignOpenStats(db: DB, tags: string[] | null) {
  if (!tags || tags.length < 2) return

  if (tags[0] === 'campaign') {
    const campaignId = tags[1]
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)

    if (campaign) {
      const stats = { ...campaign.stats }
      stats.opened = (stats.opened ?? 0) + 1
      await db
        .update(campaigns)
        .set({ stats })
        .where(eq(campaigns.id, campaignId))
    }
  }

  if (tags[0] === 'sequence' && tags[2]) {
    const stepId = tags[2]
    const [step] = await db
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.id, stepId))
      .limit(1)

    if (step) {
      const stats = { ...step.stats }
      stats.opened = (stats.opened ?? 0) + 1
      await db
        .update(sequenceSteps)
        .set({ stats })
        .where(eq(sequenceSteps.id, stepId))
    }
  }
}
