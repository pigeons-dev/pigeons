import { NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// POST /api/auth/forgot-password
//
// Sends a password reset email with a time-limited reset link.
// Uses a pre-created template with slug "password-reset".
//
// Security notes for production:
//   - Always return a generic success message even if the email doesn't
//     exist in your database. This prevents account enumeration attacks.
//   - Generate a cryptographically random token with a short expiry
//     (e.g. 1 hour). crypto.randomUUID() or crypto.getRandomValues()
//     are good options.
//   - Store the hashed token in your database and verify on the reset page.
//   - Invalidate the token after a single use.
//   - Rate-limit this endpoint per IP and per email address.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, name } = body as { email: string; name?: string }

    if (!email) {
      return NextResponse.json(
        { error: 'email is required' },
        { status: 400 },
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // In production, look up the user in your database and generate a
    // cryptographically secure token. This placeholder is for demo only.
    const resetToken = crypto.randomUUID()
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}`

    // Send the reset email. The template "password-reset" should exist
    // in your Pigeons instance with variables like {{name}}, {{resetUrl}},
    // and {{expiresIn}}.
    const sent = await pigeons.emails.send({
      to: email,
      templateId: 'password-reset',
      data: {
        name: name || 'there',
        resetUrl,
        expiresIn: '1 hour',
      },
      tags: ['auth', 'password-reset'],
    })

    // Always return the same shape regardless of whether the user exists.
    // The emailId is useful for debugging but you may want to omit it
    // in a truly hardened production endpoint.
    return NextResponse.json({
      message: 'If that email is in our system, a reset link has been sent',
      emailId: sent.id,
      status: sent.status,
    })
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Password reset failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
