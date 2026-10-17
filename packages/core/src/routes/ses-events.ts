import { Router } from 'express'
import MessageValidator from 'sns-validator'
import { eq } from 'drizzle-orm'
import { emails, contacts } from '../db/schema.js'
import type { DB } from '../db/index.js'

const validator = new MessageValidator()

function validateSnsMessage(body: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    validator.validate(body, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

const SNS_URL_PATTERN = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//

export function createSesEventRoutes(db: DB): Router {
  const router = Router()

  router.post('/events', async (req, res, next) => {
    try {
      const body = req.body
      const messageType = req.headers['x-amz-sns-message-type'] as string | undefined

      try {
        await validateSnsMessage(body)
      } catch {
        res.status(403).json({ error: 'Invalid SNS signature' })
        return
      }

      if (messageType === 'SubscriptionConfirmation') {
        const subscribeUrl = body.SubscribeURL as string
        if (!subscribeUrl || !SNS_URL_PATTERN.test(subscribeUrl)) {
          res.status(403).json({ error: 'Invalid SubscribeURL' })
          return
        }
        await fetch(subscribeUrl)
        return res.json({ confirmed: true })
      }

      if (messageType !== 'Notification') {
        return res.json({ skipped: true })
      }

      const payload = JSON.parse(body.Message as string)
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
