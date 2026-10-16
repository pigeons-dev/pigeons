import { describe, it, expect } from 'vitest'
import { generateId } from '../utils/id.js'

describe('generateId', () => {
  it('prefixes email ids with msg_', () => {
    expect(generateId('email')).toMatch(/^msg_[a-f0-9]{32}$/)
  })

  it('prefixes domain ids with dom_', () => {
    expect(generateId('domain')).toMatch(/^dom_[a-f0-9]{32}$/)
  })

  it('prefixes apiKey ids with key_', () => {
    expect(generateId('apiKey')).toMatch(/^key_[a-f0-9]{32}$/)
  })

  it('prefixes job ids with job_', () => {
    expect(generateId('job')).toMatch(/^job_[a-f0-9]{32}$/)
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('email')))
    expect(ids.size).toBe(100)
  })
})
