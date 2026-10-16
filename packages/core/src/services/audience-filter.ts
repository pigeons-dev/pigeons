interface Contact {
  tags: string[] | null
  properties: Record<string, unknown> | null
  unsubscribed: boolean
  bounced: boolean
  complained: boolean
  [key: string]: unknown
}

export function matchAudienceFilter(
  contact: Contact,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === 'tags' && typeof condition === 'object' && condition !== null) {
      const tags = contact.tags ?? []
      const cond = condition as Record<string, unknown>
      if (cond.contains && !tags.includes(cond.contains as string)) return false
      if (cond.containsAny) {
        const any = cond.containsAny as string[]
        if (!any.some((t) => tags.includes(t))) return false
      }
      if (cond.containsAll) {
        const all = cond.containsAll as string[]
        if (!all.every((t) => tags.includes(t))) return false
      }
      continue
    }

    if (key === 'properties' && typeof condition === 'object' && condition !== null) {
      const props = contact.properties ?? {}
      for (const [propKey, propVal] of Object.entries(condition as Record<string, unknown>)) {
        if (props[propKey] !== propVal) return false
      }
      continue
    }

    if ((contact as Record<string, unknown>)[key] !== condition) return false
  }

  return true
}
