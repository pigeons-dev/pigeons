import { describe, it, expect } from 'vitest'
import { matchAudienceFilter } from '../services/audience-filter.js'

function contact(overrides: Partial<Parameters<typeof matchAudienceFilter>[0]> = {}) {
  return {
    tags: null,
    properties: null,
    unsubscribed: false,
    bounced: false,
    complained: false,
    ...overrides,
  }
}

describe('matchAudienceFilter', () => {
  it('matches when filter is empty', () => {
    expect(matchAudienceFilter(contact(), {})).toBe(true)
  })

  describe('tags.contains', () => {
    it('matches when tag is present', () => {
      expect(matchAudienceFilter(contact({ tags: ['dev', 'trial'] }), { tags: { contains: 'dev' } })).toBe(true)
    })

    it('rejects when tag is absent', () => {
      expect(matchAudienceFilter(contact({ tags: ['dev'] }), { tags: { contains: 'enterprise' } })).toBe(false)
    })

    it('rejects when tags is null', () => {
      expect(matchAudienceFilter(contact({ tags: null }), { tags: { contains: 'dev' } })).toBe(false)
    })
  })

  describe('tags.containsAny', () => {
    it('matches when any tag is present', () => {
      expect(matchAudienceFilter(contact({ tags: ['dev'] }), { tags: { containsAny: ['dev', 'enterprise'] } })).toBe(true)
    })

    it('rejects when none match', () => {
      expect(matchAudienceFilter(contact({ tags: ['free'] }), { tags: { containsAny: ['dev', 'enterprise'] } })).toBe(false)
    })
  })

  describe('tags.containsAll', () => {
    it('matches when all tags present', () => {
      expect(matchAudienceFilter(contact({ tags: ['dev', 'trial', 'active'] }), { tags: { containsAll: ['dev', 'trial'] } })).toBe(true)
    })

    it('rejects when some are missing', () => {
      expect(matchAudienceFilter(contact({ tags: ['dev'] }), { tags: { containsAll: ['dev', 'trial'] } })).toBe(false)
    })
  })

  describe('properties', () => {
    it('matches property equality', () => {
      expect(matchAudienceFilter(contact({ properties: { plan: 'pro' } }), { properties: { plan: 'pro' } })).toBe(true)
    })

    it('rejects mismatched property', () => {
      expect(matchAudienceFilter(contact({ properties: { plan: 'free' } }), { properties: { plan: 'pro' } })).toBe(false)
    })

    it('rejects when properties is null', () => {
      expect(matchAudienceFilter(contact({ properties: null }), { properties: { plan: 'pro' } })).toBe(false)
    })

    it('matches multiple properties', () => {
      expect(matchAudienceFilter(
        contact({ properties: { plan: 'pro', region: 'us' } }),
        { properties: { plan: 'pro', region: 'us' } },
      )).toBe(true)
    })
  })

  describe('direct field match', () => {
    it('matches a top-level field', () => {
      expect(matchAudienceFilter(contact({ unsubscribed: false }), { unsubscribed: false })).toBe(true)
    })

    it('rejects mismatched field', () => {
      expect(matchAudienceFilter(contact({ unsubscribed: true }), { unsubscribed: false })).toBe(false)
    })
  })

  describe('combined filters', () => {
    it('requires all conditions to match', () => {
      const c = contact({ tags: ['dev'], properties: { plan: 'pro' } })
      expect(matchAudienceFilter(c, { tags: { contains: 'dev' }, properties: { plan: 'pro' } })).toBe(true)
      expect(matchAudienceFilter(c, { tags: { contains: 'dev' }, properties: { plan: 'free' } })).toBe(false)
    })

    it('combines tag and direct field filter', () => {
      expect(matchAudienceFilter(
        contact({ tags: ['dev'], unsubscribed: false }),
        { tags: { contains: 'dev' }, unsubscribed: false },
      )).toBe(true)
      expect(matchAudienceFilter(
        contact({ tags: ['dev'], unsubscribed: true }),
        { tags: { contains: 'dev' }, unsubscribed: false },
      )).toBe(false)
    })

    it('combines properties and tags', () => {
      const c = contact({ tags: ['active', 'trial'], properties: { plan: 'free', region: 'us' } })
      expect(matchAudienceFilter(c, {
        tags: { containsAll: ['active', 'trial'] },
        properties: { plan: 'free', region: 'us' },
      })).toBe(true)
      expect(matchAudienceFilter(c, {
        tags: { containsAll: ['active', 'trial'] },
        properties: { plan: 'free', region: 'eu' },
      })).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('empty tags array has no tags', () => {
      expect(matchAudienceFilter(contact({ tags: [] }), { tags: { contains: 'anything' } })).toBe(false)
    })

    it('containsAll with single tag', () => {
      expect(matchAudienceFilter(contact({ tags: ['a'] }), { tags: { containsAll: ['a'] } })).toBe(true)
    })

    it('containsAny with all matching', () => {
      expect(matchAudienceFilter(contact({ tags: ['a', 'b'] }), { tags: { containsAny: ['a', 'b'] } })).toBe(true)
    })

    it('handles numeric property values', () => {
      expect(matchAudienceFilter(contact({ properties: { age: 25 } }), { properties: { age: 25 } })).toBe(true)
      expect(matchAudienceFilter(contact({ properties: { age: 25 } }), { properties: { age: 30 } })).toBe(false)
    })

    it('handles boolean property values', () => {
      expect(matchAudienceFilter(contact({ properties: { verified: true } }), { properties: { verified: true } })).toBe(true)
      expect(matchAudienceFilter(contact({ properties: { verified: false } }), { properties: { verified: true } })).toBe(false)
    })

    it('extra properties on contact do not cause mismatch', () => {
      expect(matchAudienceFilter(
        contact({ properties: { plan: 'pro', region: 'us', extra: 'data' } }),
        { properties: { plan: 'pro' } },
      )).toBe(true)
    })

    it('extra tags on contact do not cause mismatch', () => {
      expect(matchAudienceFilter(
        contact({ tags: ['a', 'b', 'c'] }),
        { tags: { contains: 'b' } },
      )).toBe(true)
    })

    it('multiple tag operators applied simultaneously', () => {
      expect(matchAudienceFilter(
        contact({ tags: ['a', 'b', 'c'] }),
        { tags: { contains: 'a', containsAll: ['b', 'c'] } },
      )).toBe(true)
      expect(matchAudienceFilter(
        contact({ tags: ['a', 'b'] }),
        { tags: { contains: 'a', containsAll: ['b', 'c'] } },
      )).toBe(false)
    })
  })
})
