import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from './schema.js'
import type { Config } from '../config.js'

export type DB = LibSQLDatabase<typeof schema>

export function createDatabase(config: Config): DB {
  if (config.databaseUrl && config.databaseUrl.startsWith('postgres')) {
    throw new Error(
      'PostgreSQL support is not yet implemented. Omit PIGEONS_DATABASE_URL to use SQLite.',
    )
  }

  const url = config.databaseUrl ?? 'file:data/pigeons.db'

  const client = createClient({ url })

  return drizzle(client, { schema })
}
