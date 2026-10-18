import { NextRequest, NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// GET /api/contacts
//
// Lists contacts with pagination and optional tag filtering.
// Contacts are the audience for campaigns and sequences  - every
// user who should receive marketing or lifecycle emails should
// have a corresponding contact record.
//
// Query params:
//   - tag: filter contacts by tag (e.g. "beta", "enterprise")
//   - limit: page size (default varies by Pigeons instance config)
//   - cursor: pagination cursor from a previous response's next_cursor
//
// Example: GET /api/contacts?tag=beta&limit=20
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tag = searchParams.get('tag') ?? undefined
    const limit = searchParams.get('limit')
      ? Number(searchParams.get('limit'))
      : undefined
    const cursor = searchParams.get('cursor') ?? undefined

    const result = await pigeons.contacts.list({ tag, limit, cursor })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to list contacts'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/contacts
//
// Creates a new contact. Contacts store subscriber information and
// are the building blocks for audience segmentation:
//
//   - email: required, the contact's email address
//   - firstName / lastName: used in template personalization (e.g. "Hi {{firstName}}")
//   - tags: string array for segmentation (e.g. ["beta", "enterprise", "product-updates"])
//   - properties: arbitrary key-value pairs for custom data (e.g. plan, company, signupSource)
//
// Tags are the primary mechanism for targeting campaigns. When you
// create a campaign, you set an audienceFilter like { tags: { contains: "beta" } }
// to send only to contacts with that tag.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, firstName, lastName, tags, properties } = body as {
      email: string
      firstName?: string
      lastName?: string
      tags?: string[]
      properties?: Record<string, unknown>
    }

    if (!email) {
      return NextResponse.json(
        { error: 'email is required' },
        { status: 400 },
      )
    }

    const contact = await pigeons.contacts.create({
      email,
      firstName,
      lastName,
      tags,
      properties,
    })

    return NextResponse.json(contact, { status: 201 })
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to create contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
