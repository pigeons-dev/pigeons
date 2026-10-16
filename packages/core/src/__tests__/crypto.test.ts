import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey } from '../utils/crypto.js'

describe('generateApiKey', () => {
  it('returns a key with pgn_ prefix', () => {
    const { full } = generateApiKey()
    expect(full).toMatch(/^pgn_/)
  })

  it('returns a prefix that is the first 12 chars of the full key', () => {
    const { full, prefix } = generateApiKey()
    expect(prefix).toBe(full.slice(0, 12))
  })

  it('returns a hash that matches hashing the full key', () => {
    const { full, hash } = generateApiKey()
    expect(hash).toBe(hashApiKey(full))
  })

  it('generates unique keys', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.full).not.toBe(b.full)
  })
})

describe('hashApiKey', () => {
  it('produces a 64-char hex string', () => {
    const hash = hashApiKey('pgn_test')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic', () => {
    const a = hashApiKey('pgn_test')
    const b = hashApiKey('pgn_test')
    expect(a).toBe(b)
  })

  it('produces different hashes for different inputs', () => {
    const a = hashApiKey('pgn_aaa')
    const b = hashApiKey('pgn_bbb')
    expect(a).not.toBe(b)
  })
})
