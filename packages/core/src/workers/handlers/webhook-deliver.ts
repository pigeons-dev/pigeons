import { deliverWebhook } from '../../services/webhook-service.js'
import type { DB } from '../../db/index.js'
import type { Config } from '../../config.js'

export async function handleWebhookDeliver(
  db: DB,
  _config: Config,
  payload: Record<string, unknown>,
): Promise<void> {
  const deliveryId = payload.deliveryId as string
  if (!deliveryId) throw new Error('Missing deliveryId in webhook.deliver job')
  await deliverWebhook(db, deliveryId)
}
