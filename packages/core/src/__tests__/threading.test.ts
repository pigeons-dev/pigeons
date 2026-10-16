import { describe, it, expect } from 'vitest'
import {
  generateMessageId,
  buildReferences,
  foldReferencesHeader,
  generateThreadIndex,
  stripSubjectPrefix,
  extractThreadIdFromMessageId,
} from '../services/threading.js'

describe('generateMessageId', () => {
  it('generates valid message IDs with angle brackets', () => {
    const id = generateMessageId('example.com')
    expect(id).toMatch(/^<[^@]+@example\.com>$/)
  })

  it('embeds thread ID when provided', () => {
    const id = generateMessageId('example.com', 'thr_abc123')
    expect(id).toContain('tid.')
    expect(id).toMatch(/@example\.com>$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateMessageId('example.com')))
    expect(ids.size).toBe(100)
  })
})

describe('extractThreadIdFromMessageId', () => {
  it('extracts thread ID from tid. format', () => {
    const threadId = 'thr_abc123'
    const msgId = generateMessageId('example.com', threadId)
    const extracted = extractThreadIdFromMessageId(msgId)
    expect(extracted).toBe(threadId)
  })

  it('returns null for non-tid message IDs', () => {
    const msgId = generateMessageId('example.com')
    expect(extractThreadIdFromMessageId(msgId)).toBeNull()
  })

  it('returns null for SES-style message IDs', () => {
    expect(
      extractThreadIdFromMessageId('<0100017c3d@us-east-1.amazonses.com>'),
    ).toBeNull()
  })
})

describe('buildReferences', () => {
  it('appends parent ID to chain', () => {
    const refs = buildReferences(['<a@ex.com>'], '<b@ex.com>')
    expect(refs).toEqual(['<a@ex.com>', '<b@ex.com>'])
  })

  it('truncates to keep root + last 19 when exceeding 20', () => {
    const chain = Array.from({ length: 25 }, (_, i) => `<msg${i}@ex.com>`)
    const refs = buildReferences(chain, '<new@ex.com>')
    expect(refs.length).toBe(20)
    expect(refs[0]).toBe('<msg0@ex.com>')
    expect(refs[refs.length - 1]).toBe('<new@ex.com>')
  })

  it('preserves short chains unchanged', () => {
    const refs = buildReferences([], '<root@ex.com>')
    expect(refs).toEqual(['<root@ex.com>'])
  })
})

describe('foldReferencesHeader', () => {
  it('returns empty string for empty array', () => {
    expect(foldReferencesHeader([])).toBe('')
  })

  it('folds long chains at message ID boundaries', () => {
    const refs = Array.from({ length: 5 }, (_, i) => `<msg${i}.longid12345@example.com>`)
    const folded = foldReferencesHeader(refs)
    expect(folded).toContain('<msg0')
    expect(folded).toContain('<msg4')
  })
})

describe('generateThreadIndex', () => {
  it('generates 22-byte base for new threads', () => {
    const index = generateThreadIndex()
    const buf = Buffer.from(index, 'base64')
    expect(buf.length).toBe(22)
  })

  it('appends 5-byte block for replies', () => {
    const parent = generateThreadIndex()
    const child = generateThreadIndex(parent)
    const parentBuf = Buffer.from(parent, 'base64')
    const childBuf = Buffer.from(child, 'base64')
    expect(childBuf.length).toBe(parentBuf.length + 5)
  })

  it('nests multiple reply levels', () => {
    const root = generateThreadIndex()
    const reply1 = generateThreadIndex(root)
    const reply2 = generateThreadIndex(reply1)
    const buf = Buffer.from(reply2, 'base64')
    expect(buf.length).toBe(22 + 5 + 5)
  })
})

describe('stripSubjectPrefix', () => {
  it('strips Re: prefix', () => {
    expect(stripSubjectPrefix('Re: Hello')).toBe('Hello')
  })

  it('strips Fwd: prefix', () => {
    expect(stripSubjectPrefix('Fwd: Hello')).toBe('Hello')
  })

  it('strips international prefixes', () => {
    expect(stripSubjectPrefix('AW: Termin')).toBe('Termin')
    expect(stripSubjectPrefix('SV: Møde')).toBe('Møde')
    expect(stripSubjectPrefix('TR: Document')).toBe('Document')
  })

  it('is case insensitive', () => {
    expect(stripSubjectPrefix('RE: Test')).toBe('Test')
    expect(stripSubjectPrefix('re: Test')).toBe('Test')
  })

  it('leaves subjects without prefix unchanged', () => {
    expect(stripSubjectPrefix('Hello World')).toBe('Hello World')
  })
})
