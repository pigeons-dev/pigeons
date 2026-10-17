import { v4 as uuidv4 } from 'uuid'

const PREFIXES = {
  email: 'msg',
  domain: 'dom',
  apiKey: 'key',
  job: 'job',
  inbox: 'inb',
  inboxMessage: 'imsg',
  thread: 'thr',
  contact: 'ctc',
  template: 'tpl',
  campaign: 'cmp',
  sequence: 'seq',
  subscriptionTopic: 'top',
  sequenceStep: 'stp',
  sequenceEnrollment: 'enr',
  webhook: 'whk',
  webhookDelivery: 'wdl',
} as const

type EntityType = keyof typeof PREFIXES

export function generateId(type: EntityType): string {
  return `${PREFIXES[type]}_${uuidv4().replace(/-/g, '')}`
}
