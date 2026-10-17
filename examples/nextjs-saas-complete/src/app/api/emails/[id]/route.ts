import { NextRequest, NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// GET /api/emails/:id
//
// Returns the current delivery status of a sent email.
// Useful for:
//   - Showing send status in your UI after a user triggers an email
//   - Polling for delivery confirmation (though webhooks are preferred)
//   - Debugging delivery issues in an admin panel
//
// Status progression: queued -> sending -> sent -> delivered
// Error states: bounced, complained, failed
//
// The response includes the email's current status and metadata.
// Check the status field to determine where the email is in the
// delivery pipeline.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { error: 'email id is required' },
        { status: 400 },
      )
    }

    const email = await pigeons.emails.get(id)

    return NextResponse.json({
      id: email.id,
      to: email.to,
      subject: email.subject,
      status: email.status,
      tags: email.tags,
      createdAt: email.createdAt,
      updatedAt: email.updatedAt,
    })
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to get email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
