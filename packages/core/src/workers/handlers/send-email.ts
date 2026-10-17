import { eq, inArray } from 'drizzle-orm'
import { emails, contacts } from '../../db/schema.js'
import { sendEmail } from '../../services/email-sender.js'
import { injectTrackingPixel } from '../../services/open-tracking.js'
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

  const recipients = email.to as string[]
  const knownContacts = await db
    .select({ email: contacts.email, unsubscribed: contacts.unsubscribed })
    .from(contacts)
    .where(inArray(contacts.email, recipients))

  const unsubEmails = new Set(
    knownContacts.filter((c) => c.unsubscribed).map((c) => c.email),
  )
  const filteredTo = recipients.filter((e) => !unsubEmails.has(e))

  if (filteredTo.length === 0) {
    await db.update(emails).set({ status: 'failed' }).where(eq(emails.id, emailId))
    return
  }

  await db.update(emails).set({ status: 'sending' }).where(eq(emails.id, emailId))

  const headers: Record<string, string> = {
    ...((email.headers as Record<string, string>) ?? {}),
    'List-Unsubscribe': `<mailto:unsubscribe@${email.from.split('@')[1]}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }

  let html = email.html ?? undefined
  if (html && email.trackOpens) {
    html = injectTrackingPixel(html, email.id, config)
  }

  const result = await sendEmail(config, {
    from: email.from,
    to: filteredTo,
    cc: (email.cc as string[]) ?? undefined,
    bcc: (email.bcc as string[]) ?? undefined,
    subject: email.subject,
    html,
    text: email.text ?? undefined,
    headers,
  })

  await db
    .update(emails)
    .set({ status: 'sent', sesMessageId: result.messageId })
    .where(eq(emails.id, emailId))
}
