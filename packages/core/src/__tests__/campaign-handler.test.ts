import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema.js'
import { generateId } from '../utils/id.js'
import { handleSendCampaign } from '../workers/handlers/send-campaign.js'
import type { DB } from '../db/index.js'
import type { Config } from '../config.js'

let db: DB

const config: Config = {
  aws: { accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' },
  fromEmail: 'test@example.com',
  port: 0,
  databaseUrl: ':memory:',
  workerPollInterval: 50,
}

beforeAll(async () => {
  const client = createClient({ url: ':memory:' })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: 'drizzle' })
})

vi.mock('../services/email-sender.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'ses_mock_id' }),
}))

async function createCampaign(overrides: Partial<typeof schema.campaigns.$inferInsert> = {}) {
  const id = generateId('campaign')
  await db.insert(schema.campaigns).values({
    id,
    name: 'Test Campaign',
    subject: 'Test Subject',
    status: 'sending',
    ...overrides,
  })
  return id
}

async function createContact(overrides: Partial<typeof schema.contacts.$inferInsert> = {}) {
  const id = generateId('contact')
  await db.insert(schema.contacts).values({
    id,
    email: `${id}@example.com`,
    ...overrides,
  })
  return id
}

describe('handleSendCampaign', () => {
  it('throws when campaignId is missing', async () => {
    await expect(handleSendCampaign(db, config, {})).rejects.toThrow('Missing campaignId')
  })

  it('throws when campaign does not exist', async () => {
    await expect(
      handleSendCampaign(db, config, { campaignId: 'cmp_nonexistent', contactIds: [] }),
    ).rejects.toThrow('not found')
  })

  it('skips processing for cancelled campaigns', async () => {
    const id = await createCampaign({ status: 'cancelled' })
    await handleSendCampaign(db, config, { campaignId: id, contactIds: ['ctc_fake'] })
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1)
    expect(campaign.status).toBe('cancelled')
  })

  it('skips processing for paused campaigns', async () => {
    const id = await createCampaign({ status: 'paused' })
    await handleSendCampaign(db, config, { campaignId: id, contactIds: ['ctc_fake'] })
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1)
    expect(campaign.status).toBe('paused')
  })

  it('marks campaign as sent after processing all contacts', async () => {
    const contactId = await createContact()
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.status).toBe('sent')
    expect(campaign.completedAt).toBeTruthy()
  })

  it('creates email records for each contact', async () => {
    const c1 = await createContact()
    const c2 = await createContact()
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [c1, c2] })

    const allEmails = await db.select().from(schema.emails)
    const campaignEmails = allEmails.filter((e) => (e.tags as string[])?.includes(campaignId))
    expect(campaignEmails.length).toBe(2)
  })

  it('tags emails with campaign ID', async () => {
    const contactId = await createContact()
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const allEmails = await db.select().from(schema.emails)
    const campaignEmails = allEmails.filter((e) => (e.tags as string[])?.includes(campaignId))
    expect(campaignEmails[0].tags).toContain('campaign')
    expect(campaignEmails[0].tags).toContain(campaignId)
  })

  it('increments sent stats for successful sends', async () => {
    const c1 = await createContact()
    const c2 = await createContact()
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [c1, c2] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.sent).toBe(2)
  })

  it('increments failed stats for unsubscribed contacts', async () => {
    const contactId = await createContact({ unsubscribed: true })
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.failed).toBe(1)
    expect(campaign.stats.sent).toBe(0)
  })

  it('increments failed stats for bounced contacts', async () => {
    const contactId = await createContact({ bounced: true })
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.failed).toBe(1)
  })

  it('increments failed stats for complained contacts', async () => {
    const contactId = await createContact({ complained: true })
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.failed).toBe(1)
  })

  it('increments failed stats for nonexistent contact IDs', async () => {
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: ['ctc_deleted'] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.failed).toBe(1)
  })

  it('handles mix of valid, unsubscribed, and nonexistent contacts', async () => {
    const valid = await createContact()
    const unsub = await createContact({ unsubscribed: true })
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, {
      campaignId,
      contactIds: [valid, unsub, 'ctc_gone'],
    })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.stats.sent).toBe(1)
    expect(campaign.stats.failed).toBe(2)
  })

  it('processes empty contactIds list gracefully', async () => {
    const campaignId = await createCampaign()

    await handleSendCampaign(db, config, { campaignId, contactIds: [] })

    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1)
    expect(campaign.status).toBe('sent')
    expect(campaign.stats.sent).toBe(0)
  })

  it('uses template subject and body when templateId is set', async () => {
    const tplId = generateId('template')
    await db.insert(schema.templates).values({
      id: tplId,
      slug: `tpl-${Date.now()}`,
      name: 'Campaign Template',
      subject: 'Template Subject',
      body: '<p>Hello {{name}}</p>',
    })

    const contactId = await createContact()
    const campaignId = await createCampaign({
      templateId: tplId,
      templateData: { name: 'World' },
      subject: null,
    })

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const allEmails = await db.select().from(schema.emails)
    const sent = allEmails.filter((e) => (e.tags as string[])?.includes(campaignId))
    expect(sent[0].subject).toBe('Template Subject')
  })

  it('throws when template does not exist', async () => {
    const contactId = await createContact()
    const campaignId = await createCampaign({ templateId: 'tpl_nonexistent' })

    await expect(
      handleSendCampaign(db, config, { campaignId, contactIds: [contactId] }),
    ).rejects.toThrow('Template')
  })

  it('uses campaign fromEmail over config default', async () => {
    const contactId = await createContact()
    const campaignId = await createCampaign({ fromEmail: 'custom@example.com' })

    await handleSendCampaign(db, config, { campaignId, contactIds: [contactId] })

    const allEmails = await db.select().from(schema.emails)
    const sent = allEmails.filter((e) => (e.tags as string[])?.includes(campaignId))
    expect(sent[0].from).toBe('custom@example.com')
  })
})
