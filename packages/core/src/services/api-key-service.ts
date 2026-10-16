import { eq } from 'drizzle-orm'
import { apiKeys } from '../db/schema.js'
import { generateApiKey, hashApiKey } from '../utils/crypto.js'
import { generateId } from '../utils/id.js'
import { NotFoundError } from '../utils/errors.js'
import type { DB } from '../db/index.js'

export async function ensureApiKey(db: DB): Promise<{ key: string; created: boolean }> {
  const existing = await db.select().from(apiKeys).limit(1)
  if (existing.length > 0) {
    return { key: '', created: false }
  }

  const { full, prefix, hash } = generateApiKey()

  await db.insert(apiKeys).values({
    id: generateId('apiKey'),
    name: 'Default API Key',
    prefix,
    hash,
    scopes: null,
  })

  return { key: full, created: true }
}

export async function createApiKeyRecord(
  db: DB,
  params: { name: string; scopes?: string[]; expiresAt?: string },
) {
  const { full, prefix, hash } = generateApiKey()
  const id = generateId('apiKey')

  await db.insert(apiKeys).values({
    id,
    name: params.name,
    prefix,
    hash,
    scopes: params.scopes ?? null,
    expiresAt: params.expiresAt ?? null,
  })

  return { id, key: full, prefix, name: params.name, scopes: params.scopes ?? null }
}

export async function listApiKeys(db: DB) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
}

export async function revokeApiKey(db: DB, id: string) {
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1)
  if (!key) throw new NotFoundError('API key', id)
  await db.delete(apiKeys).where(eq(apiKeys.id, id))
  return { id, deleted: true }
}
