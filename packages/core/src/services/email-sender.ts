import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import type { Config } from '../config.js'

let client: SESv2Client | null = null

function getClient(config: Config): SESv2Client {
  if (!client) {
    client = new SESv2Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    })
  }
  return client
}

interface SendParams {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  html?: string
  text?: string
  headers?: Record<string, string>
}

export interface SendResult {
  messageId: string
}

export async function sendEmail(
  config: Config,
  params: SendParams & { configurationSet?: string },
): Promise<SendResult> {
  const ses = getClient(config)

  const destination: Record<string, string[]> = { ToAddresses: params.to }
  if (params.cc?.length) destination.CcAddresses = params.cc
  if (params.bcc?.length) destination.BccAddresses = params.bcc

  const content: Record<string, any> = {
    Simple: {
      Subject: { Data: params.subject, Charset: 'UTF-8' },
      Body: {},
    },
  }

  if (params.html) {
    content.Simple.Body.Html = { Data: params.html, Charset: 'UTF-8' }
  }
  if (params.text) {
    content.Simple.Body.Text = { Data: params.text, Charset: 'UTF-8' }
  }

  const emailHeaders = params.headers
    ? Object.entries(params.headers).map(([Name, Value]) => ({ Name, Value }))
    : undefined

  const configSet = params.configurationSet ?? config.configurationSet

  const command = new SendEmailCommand({
    FromEmailAddress: params.from,
    Destination: destination,
    Content: content,
    ...(configSet ? { ConfigurationSetName: configSet } : {}),
    ...(emailHeaders ? { Headers: emailHeaders } : {}),
  })

  const response = await ses.send(command)

  if (!response.MessageId) {
    throw new Error('SES did not return a MessageId')
  }

  return { messageId: response.MessageId }
}
