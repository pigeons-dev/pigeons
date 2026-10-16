import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator'
import type { DB } from './index.js'
import type { Config } from '../config.js'

export async function migrate(db: DB, _config: Config): Promise<void> {
  try {
    await drizzleMigrate(db, { migrationsFolder: 'drizzle' })
    console.log('Database migrations applied')
  } catch (err) {
    console.error('Migration failed:', err)
    throw err
  }
}
