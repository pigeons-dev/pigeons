import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { emails, contacts } from '../db/schema.js'
import type { DB } from '../db/index.js'

export function createSesEventRoutes(db: DB): Router {
  const router = Router()

  router.post('/events', async (req, res, next) => {
    try {
      const message = req.body

      if (message.Type === 'SubscriptionConfirmation') {
        const { default: fetch } = await import('node-fetch' as any).catch(() => ({ default: globalThis.fetch }))
        await fetch(message.SubscribeURL)
        return res.json({ confirmed: true })
      }

      if (message.Type !== 'Notification') {
        return res.json({ skipped: true })
      }

      const payload = JSON.parse(message.Message)
      const eventType = payload.eventType ?? payload.notificationType

      switch (eventType) {
        case 'Delivery':
          await handleDelivery(db, payload)
          break
        case 'Bounce':
          await handleBounce(db, payload)
          break
        case 'Complaint':
          await handleComplaint(db, payload)
          break
        default:
          break
      }

      res.json({ processed: eventType })
    } catch (err) {
      next(err)
    }
  })

  return router
}

async function handleDelivery(db: DB, payload: any) {
  const messageId = payload.mail?.messageId
  if (!messageId) return

  const [email] = await db
    .select()
    .from(emails)
    .where(eq(emails.sesMessageId, messageId))
    .limit(1)

  if (email) {
    await db.update(emails).set({ status: 'delivered' }).where(eq(emails.id, email.id))
  }
}

async function handleBounce(db: DB, payload: any) {
  const messageId = payload.mail?.messageId
  const bounce = payload.bounce

  if (messageId) {
    const [email] = await db
      .select()
      .from(emails)
      .where(eq(emails.sesMessageId, messageId))
      .limit(1)

    if (email) {
      await db.update(emails).set({ status: 'bounced' }).where(eq(emails.id, email.id))
    }
  }

  if (bounce?.bounceType === 'Permanent' && bounce.bouncedRecipients) {
    for (const recipient of bounce.bouncedRecipients) {
      const addr = recipient.emailAddress
      if (!addr) continue

      const [contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.email, addr))
        .limit(1)

      if (contact) {
        await db.update(contacts).set({
          bounced: true,
          bouncedAt: new Date().toISOString(),
        }).where(eq(contacts.id, contact.id))
      }
    }
  }
}

async function handleComplaint(db: DB, payload: any) {
  const messageId = payload.mail?.messageId

  if (messageId) {
    const [email] = await db
      .select()
      .from(emails)
      .where(eq(emails.sesMessageId, messageId))
      .limit(1)

    if (email) {
      await db.update(emails).set({ status: 'complained' }).where(eq(emails.id, email.id))
    }
  }

  const recipients = payload.complaint?.complainedRecipients ?? []
  for (const recipient of recipients) {
    const addr = recipient.emailAddress
    if (!addr) continue

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.email, addr))
      .limit(1)

    if (contact) {
      await db.update(contacts).set({
        unsubscribed: true,
        unsubscribedAt: new Date().toISOString(),
        complained: true,
        complainedAt: new Date().toISOString(),
      }).where(eq(contacts.id, contact.id))
    }
  }
}
