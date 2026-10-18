import { NextRequest, NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// GET /api/contacts/:id
//
// Returns a single contact by ID or email address.
// The Pigeons SDK accepts either format  - pass "ctc_abc123" or
// "alice@example.com" and it will resolve correctly.
//
// Useful for:
//   - Displaying a contact's profile in your admin panel
//   - Checking subscription/bounce/complaint status before sending
//   - Verifying a contact exists before enrolling in a sequence
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const contact = await pigeons.contacts.get(id)

    return NextResponse.json(contact)
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to get contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH /api/contacts/:id
//
// Updates a contact's mutable fields: firstName, lastName, tags, properties.
// The email address is immutable  - to change it, delete and recreate.
//
// Tags are replaced wholesale (not merged). If you want to add a tag
// without removing existing ones, fetch the contact first, merge the
// tag arrays, then send the update.
//
// Properties follow the same replacement semantics  - send the full
// properties object you want the contact to have.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { firstName, lastName, tags, properties } = body as {
      firstName?: string
      lastName?: string
      tags?: string[]
      properties?: Record<string, unknown>
    }

    const contact = await pigeons.contacts.update(id, {
      firstName,
      lastName,
      tags,
      properties,
    })

    return NextResponse.json(contact)
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to update contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE /api/contacts/:id
//
// Permanently removes a contact. This is irreversible  - the contact's
// email history is preserved in the emails table, but the contact
// record and its tags/properties are deleted.
//
// Use this for GDPR data deletion requests or when a user closes
// their account. For unsubscribes (where you want to keep the record
// but stop sending), use pigeons.contacts.unsubscribe() instead.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const result = await pigeons.contacts.delete(id)

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to delete contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
