import { NextRequest, NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// POST /api/emails/send
//
// Generic transactional email endpoint. Supports two modes:
//
//   1. Template-based: pass `templateId` and `data` to render a
//      pre-created template with dynamic variables.
//
//   2. Inline HTML: pass `subject` and `html` (and optionally `text`)
//      for one-off emails that don't need a template.
//
// Idempotency: Pass an `Idempotency-Key` header to prevent duplicate
// sends. Pigeons will return the cached response for repeated requests
// with the same key. Use deterministic keys like "order-{id}-receipt"
// to make retries safe.
//
// Tags: Include tags to categorize emails for filtering and analytics.
// For example, ["transactional", "order-receipt"] lets you filter by
// email type in the dashboard.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, html, text, templateId, data, tags } = body as {
      to: string | string[]
      subject?: string
      html?: string
      text?: string
      templateId?: string
      data?: Record<string, unknown>
      tags?: string[]
    }

    if (!to) {
      return NextResponse.json(
        { error: 'to is required' },
        { status: 400 },
      )
    }

    // Require either a template or inline content
    if (!templateId && !html) {
      return NextResponse.json(
        { error: 'either templateId or html is required' },
        { status: 400 },
      )
    }

    // Forward the idempotency key from the client request to Pigeons.
    // This ensures that if the client retries (e.g. network timeout),
    // Pigeons won't send the email twice.
    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined

    const sent = await pigeons.emails.send(
      {
        to,
        subject,
        html,
        text,
        templateId,
        data,
        tags: tags || ['transactional'],
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    )

    return NextResponse.json({
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
    const message = err instanceof Error ? err.message : 'Failed to send email'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
