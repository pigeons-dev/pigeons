import { NextResponse } from 'next/server'
import { pigeons } from '@/lib/pigeons'

// POST /api/auth/magic-link
//
// Sends a magic link email for passwordless authentication.
// The user clicks the link and is logged in without a password.
//
// Security notes for production:
// - Generate a one-time-use, cryptographically random token
// - Set a short expiry (e.g. 10 minutes)
// - Bind the token to the requesting IP or device fingerprint
// - Invalidate the token immediately after use
// - Rate-limit per email address to prevent abuse
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email } = body as { email: string }

    if (!email) {
      return NextResponse.json(
        { error: 'email is required' },
        { status: 400 },
      )
    }

    // In production, generate a secure one-time token and store it
    // with a short expiry. This dummy token is for demonstration only.
    const magicToken = 'mlk_demo_token_replace_me'
    const magicUrl = `https://yourapp.com/auth/callback?token=${encodeURIComponent(magicToken)}`

    // Send the magic link email with inline HTML.
    // You could also use a template here for consistent branding.
    const sent = await pigeons.emails.send({
      to: email,
      subject: 'Your login link',
      html: `
        <h2>Sign in to YourApp</h2>
        <p>Click the link below to log in. No password needed.</p>
        <p><a href="${magicUrl}">Sign in to YourApp</a></p>
        <p>This link expires in 10 minutes and can only be used once.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
      text: [
        'Sign in to YourApp',
        '',
        'Visit the link below to log in. No password needed.',
        magicUrl,
        '',
        'This link expires in 10 minutes and can only be used once.',
        '',
        "If you didn't request this, you can safely ignore this email.",
      ].join('\n'),
      tags: ['auth', 'magic-link'],
    })

    return NextResponse.json({
      message: 'Magic link sent',
      emailId: sent.id,
      status: sent.status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
