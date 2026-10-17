import { z } from 'zod'

const configSchema = z.object({
  port: z.coerce.number().default(3891),
  databaseUrl: z.string().optional(),
  aws: z.object({
    accessKeyId: z.string().min(1, 'PIGEONS_AWS_ACCESS_KEY_ID is required'),
    secretAccessKey: z.string().min(1, 'PIGEONS_AWS_SECRET_ACCESS_KEY is required'),
    region: z.string().min(1, 'PIGEONS_AWS_REGION is required'),
  }),
  fromEmail: z.string().email('PIGEONS_FROM_EMAIL must be a valid email'),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
  workerPollInterval: z.coerce.number().default(1000),
  configurationSet: z.string().optional(),
  inboundS3Bucket: z.string().optional(),
  inboundS3KeyPrefix: z.string().optional(),
  rateLimits: z.object({
    emails: z.number(),
    domains: z.number(),
    apiKeys: z.number(),
    templates: z.number(),
    contacts: z.number(),
    inboxes: z.number(),
    webhooks: z.number(),
    campaigns: z.number(),
    sequences: z.number(),
    topics: z.number(),
  }).optional(),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  const result = configSchema.safeParse({
    port: process.env.PIGEONS_PORT,
    databaseUrl: process.env.PIGEONS_DATABASE_URL,
    aws: {
      accessKeyId: process.env.PIGEONS_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.PIGEONS_AWS_SECRET_ACCESS_KEY,
      region: process.env.PIGEONS_AWS_REGION,
    },
    fromEmail: process.env.PIGEONS_FROM_EMAIL,
    apiKey: process.env.PIGEONS_API_KEY,
    webhookSecret: process.env.PIGEONS_WEBHOOK_SECRET,
    workerPollInterval: process.env.PIGEONS_WORKER_POLL_INTERVAL,
    configurationSet: process.env.PIGEONS_CONFIGURATION_SET,
    inboundS3Bucket: process.env.PIGEONS_INBOUND_S3_BUCKET,
    inboundS3KeyPrefix: process.env.PIGEONS_INBOUND_S3_KEY_PREFIX,
  })

  if (!result.success) {
    const errors = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    console.error('Configuration errors:\n' + errors.join('\n'))
    process.exit(1)
  }

  return result.data
}
