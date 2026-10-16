import { Router } from 'express'
import MessageValidator from 'sns-validator'
import { processInboundEmail, type SesNotification } from '../services/inbound.js'
import { fireWebhooks } from '../services/webhook-service.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

const validator = new MessageValidator()

function validateSnsMessage(body: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    validator.validate(body, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export function createSesInboundRoutes(db: DB, config: Config): Router {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body

      // SNS sends content-type text/plain, but we parse as JSON via express.json
      const messageType = req.headers['x-amz-sns-message-type'] as string | undefined

      await validateSnsMessage(body)

      if (messageType === 'SubscriptionConfirmation') {
        // Auto-confirm the subscription
        const subscribeUrl = body.SubscribeURL as string
        if (subscribeUrl) {
          await fetch(subscribeUrl)
        }
        res.json({ confirmed: true })
        return
      }

      if (messageType === 'Notification') {
        const message = JSON.parse(body.Message as string)

        if (message.notificationType === 'Received') {
          const notification = message as SesNotification
          const result = await processInboundEmail(db, config, notification)

          if (result) {
            await fireWebhooks(db, 'inbox.message.received', {
              inbox_id: result.inboxId,
              message_id: result.messageId,
              thread_id: result.threadId,
            })
            res.json({ processed: true, ...result })
          } else {
            res.json({ processed: false, reason: 'no_matching_inbox' })
          }
          return
        }
      }

      res.json({ processed: false, reason: 'unhandled_message_type' })
    } catch (err) {
      next(err)
    }
  })

  return router
}
