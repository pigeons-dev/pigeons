import { eq } from 'drizzle-orm'
import { campaigns, contacts, emails, templates, jobs } from '../../db/schema.js'
import { sendEmail } from '../../services/email-sender.js'
import { generateId } from '../../utils/id.js'
import type { DB } from '../../db/index.js'
import type { Config } from '../../config.js'

const BATCH_SIZE = 10

export async function handleSendCampaign(
  db: DB,
  config: Config,
  payload: Record<string, unknown>,
): Promise<void> {
  const campaignId = payload.campaignId as string
  const contactIds = payload.contactIds as string[]
  if (!campaignId) throw new Error('Missing campaignId in job payload')

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  if (campaign.status === 'cancelled' || campaign.status === 'paused') return

  let template: { subject: string; body: string } | null = null
  if (campaign.templateId) {
    const [tpl] = await db.select().from(templates).where(eq(templates.id, campaign.templateId)).limit(1)
    if (!tpl) throw new Error(`Template ${campaign.templateId} not found`)
    template = tpl
  }

  const subject = campaign.subject ?? template?.subject ?? 'No subject'
  const fromEmail = campaign.fromEmail ?? config.fromEmail
  const from = campaign.fromName ? `${campaign.fromName} <${fromEmail}>` : fromEmail
  const stats = { ...campaign.stats }

  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const [fresh] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1)
    if (fresh?.status === 'cancelled' || fresh?.status === 'paused') return

    const batch = contactIds.slice(i, i + BATCH_SIZE)
    const batchContacts = await Promise.all(
      batch.map(async (id) => {
        const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1)
        return c
      }),
    )

    for (const contact of batchContacts) {
      if (!contact || contact.unsubscribed || contact.bounced || contact.complained) {
        stats.failed++
        continue
      }

      if (campaign.topicId) {
        const unsubs = (contact.unsubscribedTopics ?? []) as string[]
        if (unsubs.includes(campaign.topicId)) {
          stats.failed++
          continue
        }
      }

      const emailId = generateId('email')
      let html = template?.body ?? ''
      let subjectLine = subject

      const data = campaign.templateData as Record<string, string> | null
      if (data) {
        for (const [key, value] of Object.entries(data)) {
          html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
          subjectLine = subjectLine.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
        }
      }

      try {
        await db.insert(emails).values({
          id: emailId,
          from: fromEmail,
          to: [contact.email],
          subject: subjectLine,
          html,
          status: 'sending',
          tags: ['campaign', campaignId],
        })

        const result = await sendEmail(config, {
          from,
          to: [contact.email],
          subject: subjectLine,
          html,
          headers: {
            'List-Unsubscribe': campaign.topicId
              ? `<mailto:unsubscribe+${campaign.topicId}@${fromEmail.split('@')[1]}?subject=unsubscribe>`
              : `<mailto:unsubscribe@${fromEmail.split('@')[1]}?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })

        await db.update(emails).set({ status: 'sent', sesMessageId: result.messageId }).where(eq(emails.id, emailId))
        stats.sent++
      } catch {
        await db.update(emails).set({ status: 'failed' }).where(eq(emails.id, emailId))
        stats.failed++
      }

      await db.update(campaigns).set({ stats }).where(eq(campaigns.id, campaignId))
    }
  }

  await db.update(campaigns).set({
    status: 'sent',
    completedAt: new Date().toISOString(),
    stats,
  }).where(eq(campaigns.id, campaignId))
}
