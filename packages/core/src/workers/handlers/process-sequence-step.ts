import { eq, and } from 'drizzle-orm'
import {
  sequenceEnrollments,
  sequenceSteps,
  sequences,
  contacts,
  emails,
  templates,
  jobs,
} from '../../db/schema.js'
import { sendEmail } from '../../services/email-sender.js'
import { generateId } from '../../utils/id.js'
import type { DB } from '../../db/index.js'
import type { Config } from '../../config.js'

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/)
  if (!match) return 0
  const n = parseInt(match[1])
  switch (match[2]) {
    case 's': return n * 1000
    case 'm': return n * 60_000
    case 'h': return n * 3_600_000
    case 'd': return n * 86_400_000
    default: return 0
  }
}

export async function handleProcessSequenceStep(
  db: DB,
  config: Config,
  payload: Record<string, unknown>,
): Promise<void> {
  const enrollmentId = payload.enrollmentId as string
  const stepId = payload.stepId as string
  if (!enrollmentId || !stepId) throw new Error('Missing enrollmentId or stepId')

  const [enrollment] = await db
    .select()
    .from(sequenceEnrollments)
    .where(eq(sequenceEnrollments.id, enrollmentId))
    .limit(1)

  if (!enrollment || enrollment.status !== 'active') return

  const [sequence] = await db
    .select()
    .from(sequences)
    .where(eq(sequences.id, enrollment.sequenceId))
    .limit(1)

  if (!sequence || sequence.status !== 'active') return

  const [step] = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.id, stepId))
    .limit(1)

  if (!step) {
    await db.update(sequenceEnrollments).set({ status: 'failed' }).where(eq(sequenceEnrollments.id, enrollmentId))
    return
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, enrollment.contactId))
    .limit(1)

  if (!contact || contact.unsubscribed || contact.bounced || contact.complained) {
    await db.update(sequenceEnrollments).set({ status: 'exited' }).where(eq(sequenceEnrollments.id, enrollmentId))
    const seqStats = sequence.stats
    await db.update(sequences).set({
      stats: { ...seqStats, active: seqStats.active - 1, exited: seqStats.exited + 1 },
    }).where(eq(sequences.id, sequence.id))
    return
  }

  if (step.type === 'email') {
    let html = ''
    let subject = step.subject ?? ''

    if (step.templateId) {
      const [tpl] = await db.select().from(templates).where(eq(templates.id, step.templateId)).limit(1)
      if (tpl) {
        html = tpl.body
        if (!step.subject) subject = tpl.subject
      }
    }

    const data = step.templateData as Record<string, string> | null
    if (data) {
      for (const [key, value] of Object.entries(data)) {
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
        subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), String(value))
      }
    }

    const emailId = generateId('email')
    await db.insert(emails).values({
      id: emailId,
      from: config.fromEmail,
      to: [contact.email],
      subject,
      html,
      status: 'sending',
      tags: ['sequence', sequence.id, step.id],
    })

    try {
      const result = await sendEmail(config, {
        from: config.fromEmail,
        to: [contact.email],
        subject,
        html,
        headers: {
          'List-Unsubscribe': `<mailto:unsubscribe@${config.fromEmail.split('@')[1]}?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
      await db.update(emails).set({ status: 'sent', sesMessageId: result.messageId }).where(eq(emails.id, emailId))

      const stepStats = step.stats
      await db.update(sequenceSteps).set({
        stats: { ...stepStats, sent: stepStats.sent + 1 },
      }).where(eq(sequenceSteps.id, step.id))
    } catch {
      await db.update(emails).set({ status: 'failed' }).where(eq(emails.id, emailId))
    }
  }

  if (step.type === 'delay') {
    // Delay steps schedule the next step with a delay offset — handled below
  }

  if (step.type === 'condition') {
    const condition = step.condition as Record<string, unknown> | null
    if (condition) {
      const match = Object.entries(condition).every(([key, val]) => {
        if (key === 'tags') return (contact.tags ?? []).includes(val as string)
        return (contact.properties ?? {})[key] === val
      })
      if (!match) {
        await db.update(sequenceEnrollments).set({ status: 'exited' }).where(eq(sequenceEnrollments.id, enrollmentId))
        const seqStats = sequence.stats
        await db.update(sequences).set({
          stats: { ...seqStats, active: seqStats.active - 1, exited: seqStats.exited + 1 },
        }).where(eq(sequences.id, sequence.id))
        return
      }
    }
  }

  const allSteps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequence.id))
    .orderBy(sequenceSteps.position)

  const currentIdx = allSteps.findIndex((s) => s.id === step.id)
  const nextStep = allSteps[currentIdx + 1]

  if (!nextStep) {
    await db.update(sequenceEnrollments).set({
      status: 'completed',
      completedAt: new Date().toISOString(),
    }).where(eq(sequenceEnrollments.id, enrollmentId))

    const seqStats = sequence.stats
    await db.update(sequences).set({
      stats: { ...seqStats, active: seqStats.active - 1, completed: seqStats.completed + 1 },
    }).where(eq(sequences.id, sequence.id))
    return
  }

  await db.update(sequenceEnrollments).set({ currentStepId: nextStep.id }).where(eq(sequenceEnrollments.id, enrollmentId))

  const delay = step.type === 'delay' && step.delayDuration
    ? parseDuration(step.delayDuration)
    : 0

  await db.insert(jobs).values({
    id: generateId('job'),
    type: 'process_sequence_step',
    payload: { enrollmentId, stepId: nextStep.id },
    runAt: new Date(Date.now() + delay).toISOString(),
  })
}
