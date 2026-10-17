import { NextResponse } from 'next/server'
import { pigeons } from '@/lib/pigeons'

// POST /api/auth/forgot-password
//
// Sends a password reset email with a time-limited reset link.
// Uses a pre-created template with slug "password-reset".
//
// Security notes for production:
// - Always return 200 even if the email doesn't exist (prevent enumeration)
// - Generate a cryptographically random token with a short expiry (e.g. 1 hour)
// - Invalidate the token after use
// - Rate-limit this endpoint per IP and per email
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, name } = body as { email: string; name: string }

    if (!email) {
      return NextResponse.json(
        { error: 'email is required' },
        { status: 400 },
      )
    }

    // In production, look up the user, generate a secure token,
    // and store it with an expiry. This dummy token is for demonstration only.
    const resetToken = 'rst_demo_token_replace_me'
    const resetUrl = `https://yourapp.com/reset-password?token=${encodeURIComponent(resetToken)}`

    // Send the password reset email using a template.
    // The template "password-reset" should exist in your Pigeons instance.
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

    return NextResponse.json({
      message: 'Password reset email sent',
      emailId: sent.id,
      status: sent.status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
