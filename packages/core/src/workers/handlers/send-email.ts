import { eq } from 'drizzle-orm'
import { emails } from '../../db/schema.js'
import { sendEmail } from '../../services/email-sender.js'
import type { DB } from '../../db/index.js'
import type { Config } from '../../config.js'

export async function handleSendEmail(
  db: DB,
  config: Config,
  payload: Record<string, unknown>,
): Promise<void> {
  const emailId = payload.emailId as string
  if (!emailId) throw new Error('Missing emailId in job payload')

  const [email] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1)

  if (!email) throw new Error(`Email ${emailId} not found`)
  if (email.status !== 'queued' && email.status !== 'sending') {
    return
  }

  await db.update(emails).set({ status: 'sending' }).where(eq(emails.id, emailId))

  const result = await sendEmail(config, {
    from: email.from,
    to: email.to as string[],
    cc: (email.cc as string[]) ?? undefined,
    bcc: (email.bcc as string[]) ?? undefined,
    subject: email.subject,
    html: email.html ?? undefined,
    text: email.text ?? undefined,
    headers: (email.headers as Record<string, string>) ?? undefined,
  })

  await db
    .update(emails)
    .set({ status: 'sent', sesMessageId: result.messageId })
    .where(eq(emails.id, emailId))
}
