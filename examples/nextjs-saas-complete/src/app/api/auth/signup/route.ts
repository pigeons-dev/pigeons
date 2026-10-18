import { NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// POST /api/auth/signup
//
// Sends a welcome email after a new user registers.
// Uses a pre-created template with slug "welcome" and passes
// the user's name and a login link as template variables.
//
// In a real app you would:
//   1. Validate the input (email format, password strength, etc.)
//   2. Create the user in your database
//   3. Create a contact in Pigeons for future campaigns
//   4. Send the welcome email as a side effect
//
// The contact creation and email send are shown here. Wire in
// your own user creation logic before them.
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Step 1: Create a contact so this user is part of your audience
    // for future campaigns and sequences. Tags let you segment later.
    // If the contact already exists, the SDK will return a 409  -
    // that's fine, we catch it and continue to send the email.
    try {
      await pigeons.contacts.create({
        email,
        firstName: name,
        tags: ['user', 'signup'],
      })
    } catch (err) {
      // 409 = contact already exists  - safe to ignore
      if (err instanceof PigeonsError && err.statusCode === 409) {
        // Contact already exists  - continue to send the email
      } else {
        throw err
      }
    }

    // Step 2: Send the welcome email using a template.
    // The template "welcome" should exist in your Pigeons instance
    // with variables like {{name}} and {{loginUrl}}.
    const sent = await pigeons.emails.send({
      to: email,
      templateId: 'welcome',
      data: {
        name,
        loginUrl: `${appUrl}/login`,
      },
      tags: ['auth', 'signup'],
    })

    return NextResponse.json({
      message: 'Welcome email sent',
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
    const message = err instanceof Error ? err.message : 'Signup email failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
