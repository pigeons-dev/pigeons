import { NextRequest, NextResponse } from 'next/server'
import { PigeonsError } from '@pigeons/pigeons-ts'
import { pigeons } from '@/lib/pigeons'

// GET /api/campaigns
//
// Lists campaigns with their send stats. Each campaign object includes
// a stats block with total, sent, delivered, opened, bounced, complained,
// and failed counts  - everything you need for a campaigns dashboard.
//
// Query params:
//   - status: filter by campaign status (draft, scheduled, sending, paused, sent, cancelled)
//   - limit: page size
//   - cursor: pagination cursor from a previous response
//
// Example: GET /api/campaigns?status=sent&limit=10
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as
      | 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled'
      | undefined
    const limit = searchParams.get('limit')
      ? Number(searchParams.get('limit'))
      : undefined
    const cursor = searchParams.get('cursor') ?? undefined

    const result = await pigeons.campaigns.list({ status, limit, cursor })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to list campaigns'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/campaigns
//
// Creates a campaign and immediately sends it. A campaign targets an
// audience (defined by tag filter) and renders a template for each
// matching contact.
//
// Required fields:
//   - name: human-readable campaign name for your dashboard
//   - templateId: slug or ID of the template to render for each recipient
//
// Optional fields:
//   - audienceTag: contacts with this tag will receive the campaign.
//     Maps to Pigeons' audienceFilter: { tags: { contains: "..." } }.
//   - templateData: variables passed to the template (same for all recipients)
//   - fromName / fromEmail: override the default sender identity
//   - subject: override the template's subject line
//   - scheduledAt: ISO 8601 timestamp to schedule for later instead of sending now
//
// Flow:
//   1. Create the campaign in draft status
//   2. If no scheduledAt, immediately send it
//   3. Return the campaign with initial stats
//
// To schedule for later, pass scheduledAt as an ISO string:
//   { "scheduledAt": "2025-01-15T09:00:00Z" }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      templateId,
      audienceTag,
      templateData,
      fromName,
      fromEmail,
      subject,
      scheduledAt,
    } = body as {
      name: string
      templateId: string
      audienceTag?: string
      templateData?: Record<string, unknown>
      fromName?: string
      fromEmail?: string
      subject?: string
      scheduledAt?: string
    }

    if (!name || !templateId) {
      return NextResponse.json(
        { error: 'name and templateId are required' },
        { status: 400 },
      )
    }

    // Step 1: Create the campaign in draft status.
    // The audienceFilter determines which contacts receive the campaign.
    // Using { tags: { contains: "..." } } sends to all contacts with that tag.
    const campaign = await pigeons.campaigns.create({
      name,
      templateId,
      templateData,
      fromName,
      fromEmail,
      subject,
      scheduledAt,
      audienceFilter: audienceTag ? { tags: { contains: audienceTag } } : undefined,
    })

    // Step 2: Send immediately if not scheduled for later.
    // campaigns.send() transitions the campaign from "draft" to "sending".
    // Pigeons will then deliver to each matching contact asynchronously.
    if (!scheduledAt) {
      const sent = await pigeons.campaigns.send(campaign.id)
      return NextResponse.json(sent, { status: 201 })
    }

    // If scheduled, return the draft with the scheduled timestamp.
    // Pigeons will send it automatically at the specified time.
    return NextResponse.json(campaign, { status: 201 })
  } catch (err) {
    if (err instanceof PigeonsError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      )
    }
    const message = err instanceof Error ? err.message : 'Failed to create campaign'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
