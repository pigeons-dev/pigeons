import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createDatabase } from './db/index.js'
import { migrate } from './db/migrate.js'
import { ensureApiKey } from './services/api-key-service.js'
import { createWorker } from './workers/queue.js'

async function main() {
  const config = loadConfig()

  const db = createDatabase(config)
  await migrate(db, config)

  const apiKeyInfo = await ensureApiKey(db)
  if (apiKeyInfo.created) {
    console.log('')
    console.log('='.repeat(60))
    console.log("  Your API key (save this — it won't be shown again):")
    console.log(`  ${apiKeyInfo.key}`)
    console.log('='.repeat(60))
    console.log('')
  }

  const app = createApp(db, config)

  const worker = createWorker(db, config)
  worker.start()

  const server = app.listen(config.port, () => {
    console.log(`Pigeons is running on port ${config.port}`)
  })

  const shutdown = () => {
    console.log('Shutting down...')
    worker.stop()
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Failed to start Pigeons:', err)
  process.exit(1)
})
