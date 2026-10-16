import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
} from '@aws-sdk/client-sesv2'
import { eq } from 'drizzle-orm'
import { domains } from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { NotFoundError, ConflictError } from '../utils/errors.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

function getSesClient(config: Config): SESv2Client {
  return new SESv2Client({
    region: config.aws.region,
    credentials: {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    },
  })
}

function buildRecords(
  domain: string,
  region: string,
  dkimTokens: string[],
): Array<{ type: string; name: string; value: string; ttl: number; status: string; purpose: string }> {
  const records = dkimTokens.map((token) => ({
    type: 'CNAME',
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
    ttl: 3600,
    status: 'pending',
    purpose: 'dkim',
  }))

  records.push(
    {
      type: 'TXT',
      name: `mail.${domain}`,
      value: 'v=spf1 include:amazonses.com ~all',
      ttl: 3600,
      status: 'pending',
      purpose: 'spf',
    },
    {
      type: 'MX',
      name: `mail.${domain}`,
      value: `10 feedback-smtp.${region}.amazonses.com`,
      ttl: 3600,
      status: 'pending',
      purpose: 'mail_from',
    },
    {
      type: 'MX',
      name: domain,
      value: `10 inbound-smtp.${region}.amazonaws.com`,
      ttl: 3600,
      status: 'pending',
      purpose: 'inbound',
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
      ttl: 3600,
      status: 'pending',
      purpose: 'dmarc',
    },
  )

  return records
}

export async function addDomain(db: DB, config: Config, domain: string) {
  const [existing] = await db
    .select()
    .from(domains)
    .where(eq(domains.domain, domain))
    .limit(1)

  if (existing) throw new ConflictError(`Domain '${domain}' already exists`)

  const ses = getSesClient(config)
  const response = await ses.send(
    new CreateEmailIdentityCommand({
      EmailIdentity: domain,
    }),
  )

  const dkimTokens = response.DkimAttributes?.Tokens ?? []
  const records = buildRecords(domain, config.aws.region, dkimTokens)
  const id = generateId('domain')

  await db.insert(domains).values({
    id,
    domain,
    region: config.aws.region,
    dkimTokens,
    records,
  })

  return { id, domain, verificationStatus: 'pending', records }
}

export async function verifyDomain(db: DB, config: Config, id: string) {
  const [dom] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!dom) throw new NotFoundError('Domain', id)

  const ses = getSesClient(config)
  const response = await ses.send(
    new GetEmailIdentityCommand({ EmailIdentity: dom.domain }),
  )

  const dkimVerified =
    response.DkimAttributes?.Status === 'SUCCESS' ||
    response.DkimAttributes?.SigningEnabled === true
  const verificationStatus = dkimVerified ? 'verified' : 'pending'

  const updatedRecords = (dom.records ?? []).map((r) => {
    if (r.purpose === 'dkim' && dkimVerified) return { ...r, status: 'verified' }
    return r
  })

  await db
    .update(domains)
    .set({
      verificationStatus: verificationStatus as 'pending' | 'verified' | 'failed',
      records: updatedRecords,
    })
    .where(eq(domains.id, id))

  if (dkimVerified && dom.verificationStatus !== 'verified') {
    try {
      await ses.send(
        new PutEmailIdentityMailFromAttributesCommand({
          EmailIdentity: dom.domain,
          MailFromDomain: `mail.${dom.domain}`,
        }),
      )
    } catch {
      // Non-critical — MAIL FROM can be configured later
    }
  }

  return { ...dom, verificationStatus, records: updatedRecords }
}

export async function listDomains(db: DB) {
  return db.select().from(domains)
}

export async function deleteDomain(db: DB, config: Config, id: string) {
  const [dom] = await db.select().from(domains).where(eq(domains.id, id)).limit(1)
  if (!dom) throw new NotFoundError('Domain', id)

  const ses = getSesClient(config)
  try {
    await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: dom.domain }))
  } catch {
    // Domain may not exist in SES anymore
  }

  await db.delete(domains).where(eq(domains.id, id))
  return { id, deleted: true }
}
