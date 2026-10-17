import { NextResponse } from 'next/server'
import { pigeons } from '@/lib/pigeons'

// POST /api/auth/signup
//
// Sends a welcome email after a new user registers.
// Uses a pre-created template with slug "welcome" and passes
// the user's name as a template variable.
//
// In a real app, you'd create the user in your database first,
// then send the welcome email as a side effect.
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, name } = body as { email: string; name: string }

    if (!email || !name) {
      return NextResponse.json(
        { error: 'email and name are required' },
        { status: 400 },
      )
    }

    // Send the welcome email using a template.
    // The template "welcome" should exist in your Pigeons instance.
    // Template variables are passed via the `data` field.
    const sent = await pigeons.emails.send({
      to: email,
      templateId: 'welcome',
      data: {
        name,
        loginUrl: 'https://yourapp.com/login',
      },
      tags: ['auth', 'signup'],
    })

    return NextResponse.json({
      message: 'Welcome email sent',
      emailId: sent.id,
      status: sent.status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
