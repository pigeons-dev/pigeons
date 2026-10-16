import { eq, and, lte } from 'drizzle-orm'
import { jobs } from '../db/schema.js'
import { handleSendEmail } from './handlers/send-email.js'
import { handleWebhookDeliver } from './handlers/webhook-deliver.js'
import { handleSendCampaign } from './handlers/send-campaign.js'
import { handleProcessSequenceStep } from './handlers/process-sequence-step.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

type JobHandler = (db: DB, config: Config, payload: Record<string, unknown>) => Promise<void>

const handlers: Record<string, JobHandler> = {
  send_email: handleSendEmail,
  'webhook.deliver': handleWebhookDeliver,
  send_campaign: handleSendCampaign,
  process_sequence_step: handleProcessSequenceStep,
}

export function createWorker(db: DB, config: Config) {
  let running = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function poll() {
    if (!running) return

    try {
      const now = new Date().toISOString()

      const pending = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
        .limit(10)

      for (const job of pending) {
        await db
          .update(jobs)
          .set({ status: 'running', startedAt: new Date().toISOString(), attempts: job.attempts + 1 })
          .where(and(eq(jobs.id, job.id), eq(jobs.status, 'pending')))

        const handler = handlers[job.type]
        if (!handler) {
          await db
            .update(jobs)
            .set({ status: 'dead', lastError: `Unknown job type: ${job.type}`, completedAt: new Date().toISOString() })
            .where(eq(jobs.id, job.id))
          continue
        }

        try {
          await handler(db, config, job.payload as Record<string, unknown>)
          await db
            .update(jobs)
            .set({ status: 'completed', completedAt: new Date().toISOString() })
            .where(eq(jobs.id, job.id))
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          const nextAttempt = job.attempts + 1

          if (nextAttempt >= job.maxAttempts) {
            await db
              .update(jobs)
              .set({ status: 'dead', lastError: error, completedAt: new Date().toISOString() })
              .where(eq(jobs.id, job.id))
          } else {
            const backoffMs = Math.min(60_000 * Math.pow(2, nextAttempt - 1), 900_000)
            const retryAt = new Date(Date.now() + backoffMs).toISOString()
            await db
              .update(jobs)
              .set({ status: 'pending', lastError: error, runAt: retryAt })
              .where(eq(jobs.id, job.id))
          }
        }
      }
    } catch (err) {
      console.error('Worker poll error:', err)
    }

    if (running) {
      timer = setTimeout(poll, config.workerPollInterval)
    }
  }

  return {
    start() {
      running = true
      poll()
    },
    stop() {
      running = false
      if (timer) clearTimeout(timer)
    },
  }
}
