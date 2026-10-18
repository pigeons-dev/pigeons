/**
 * Express Order Emails
 *
 * An Express server demonstrating e-commerce transactional email flows
 * using the Pigeons TypeScript SDK. Covers:
 *
 *   1. Order confirmation with idempotency
 *   2. Shipping notification with tracking info
 *   3. Invoice/receipt via a stored template
 *   4. Delivery status polling
 *
 * Run: npx tsx src/index.ts
 */

import express, { type Request, type Response } from 'express'
import { Pigeons, PigeonsError } from '@pigeons/pigeons-ts'

// ── Pigeons client ──────────────────────────────────────────────────────────
// The client reads PIGEONS_URL and PIGEONS_API_KEY from the environment.
// In production, set these via your deployment's secret management.

const pigeons = new Pigeons()

// ── Express app ─────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// ── POST /orders/:id/confirm ────────────────────────────────────────────────
// Sends an order confirmation email.
//
// Idempotency: the key "order-{id}-confirm" ensures that retrying this
// request (e.g. after a network timeout) will not send duplicate emails.
// Pigeons stores the idempotency key for 24 hours. If the key already
// exists, the server returns the original response without re-sending.

interface ConfirmBody {
  email: string
  name: string
  orderId: string
  items: Array<{ name: string; qty: number; price: number }>
  total: number
}

app.post('/orders/:id/confirm', async (req: Request, res: Response) => {
  const { id } = req.params
  const { email, name, orderId, items, total } = req.body as ConfirmBody

  if (!email || !name || !orderId || !items || total == null) {
    res.status(400).json({ error: 'Missing required fields: email, name, orderId, items, total' })
    return
  }

  // Build an HTML table of line items for the confirmation email.
  const itemRows = items
    .map((i) => `<tr><td>${i.name}</td><td>${i.qty}</td><td>$${i.price.toFixed(2)}</td></tr>`)
    .join('\n')

  const html = `
    <h1>Order Confirmed</h1>
    <p>Hi ${name}, thanks for your order!</p>
    <p><strong>Order #${orderId}</strong></p>
    <table border="1" cellpadding="8" cellspacing="0">
      <thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p><strong>Total: $${total.toFixed(2)}</strong></p>
    <p>We'll notify you when your order ships.</p>
  `.trim()

  // Plain text fallback for email clients that don't render HTML.
  const itemLines = items.map((i) => `  - ${i.name} x${i.qty}  - $${i.price.toFixed(2)}`).join('\n')
  const text = [
    `Order Confirmed`,
    ``,
    `Hi ${name}, thanks for your order!`,
    ``,
    `Order #${orderId}`,
    itemLines,
    ``,
    `Total: $${total.toFixed(2)}`,
    ``,
    `We'll notify you when your order ships.`,
  ].join('\n')

  try {
    // The idempotency key ties this send to the specific order + action.
    // If a network failure causes the client to retry, Pigeons returns
    // the original email object instead of creating a duplicate.
    const confirmation = await pigeons.emails.send(
      {
        to: email,
        subject: `Order #${orderId} Confirmed`,
        html,
        text,
        tags: ['order-confirmation'],
      },
      { idempotencyKey: `order-${id}-confirm` },
    )

    // The email is queued immediately. Status progresses through:
    //   queued -> sending -> sent -> delivered
    // Failures land at: bounced, complained, or failed.
    res.status(201).json({
      message: 'Order confirmation email queued',
      emailId: confirmation.id,
      status: confirmation.status,
    })
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── POST /orders/:id/shipped ────────────────────────────────────────────────
// Sends a shipping notification with tracking details.
//
// No idempotency key here  - shipping updates can be re-sent if tracking
// info changes (e.g. carrier reassignment). Add one if your workflow
// requires exactly-once delivery.

interface ShippedBody {
  email: string
  name: string
  trackingNumber: string
  trackingUrl: string
}

app.post('/orders/:id/shipped', async (req: Request, res: Response) => {
  const { id } = req.params
  const { email, name, trackingNumber, trackingUrl } = req.body as ShippedBody

  if (!email || !name || !trackingNumber || !trackingUrl) {
    res.status(400).json({ error: 'Missing required fields: email, name, trackingNumber, trackingUrl' })
    return
  }

  const html = `
    <h1>Your Order Has Shipped!</h1>
    <p>Hi ${name},</p>
    <p>Great news  - your order <strong>#${id}</strong> is on its way.</p>
    <p>
      <strong>Tracking Number:</strong> ${trackingNumber}<br/>
      <a href="${trackingUrl}">Track your package</a>
    </p>
    <p>You'll receive a delivery confirmation once it arrives.</p>
  `.trim()

  const text = [
    `Your Order Has Shipped!`,
    ``,
    `Hi ${name},`,
    ``,
    `Great news  - your order #${id} is on its way.`,
    ``,
    `Tracking Number: ${trackingNumber}`,
    `Track your package: ${trackingUrl}`,
    ``,
    `You'll receive a delivery confirmation once it arrives.`,
  ].join('\n')

  try {
    const notification = await pigeons.emails.send({
      to: email,
      subject: `Order #${id} Shipped  - Track Your Package`,
      html,
      text,
      tags: ['shipping-notification'],
    })

    res.status(201).json({
      message: 'Shipping notification email queued',
      emailId: notification.id,
      status: notification.status,
    })
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── POST /orders/:id/invoice ────────────────────────────────────────────────
// Sends an invoice/receipt email using a stored Pigeons template.
//
// Templates live in Pigeons and are referenced by slug (e.g. "receipt").
// You create them once via the API or CLI, then reference them in sends.
// Template variables are passed in the `data` field.
//
// This route uses an idempotency key because an invoice should only be
// sent once per order  - retries must not produce duplicate receipts.

interface InvoiceBody {
  email: string
  name: string
  orderId: string
  items: Array<{ name: string; qty: number; price: number }>
  total: number
}

app.post('/orders/:id/invoice', async (req: Request, res: Response) => {
  const { id } = req.params
  const { email, name, orderId, items, total } = req.body as InvoiceBody

  if (!email || !name || !orderId || !items || total == null) {
    res.status(400).json({ error: 'Missing required fields: email, name, orderId, items, total' })
    return
  }

  try {
    // Look up the template by slug. The template's subject and body use
    // Handlebars-style variables like {{name}}, {{orderId}}, etc.
    // If you haven't created this template yet, see the README for setup.
    const template = await pigeons.templates.get('receipt')

    // Send using the template. Pigeons renders the template server-side
    // with the provided data, then queues the email for delivery.
    const invoice = await pigeons.emails.send(
      {
        to: email,
        templateId: template.id,
        data: { name, orderId, items, total },
        tags: ['invoice'],
      },
      { idempotencyKey: `order-${id}-invoice` },
    )

    res.status(201).json({
      message: 'Invoice email queued',
      emailId: invoice.id,
      status: invoice.status,
    })
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── GET /orders/:id/status ──────────────────────────────────────────────────
// Checks the delivery status of the order confirmation email.
//
// In production, prefer webhooks over polling. Pigeons fires webhook
// events for delivery, bounce, and complaint  - see the
// webhook-event-handler example. This endpoint is useful for on-demand
// status checks in admin dashboards.

app.get('/orders/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params
  const emailId = req.query.emailId as string | undefined

  if (!emailId) {
    res.status(400).json({ error: 'Query parameter "emailId" is required' })
    return
  }

  try {
    // Fetch the email by the ID returned from the send call.
    // The status field reflects the current delivery state:
    //
    //   queued      - accepted by Pigeons, waiting for the background worker
    //   sending     - worker picked it up, handing to SES
    //   sent        - SES accepted the message
    //   delivered   - SES confirmed delivery to the recipient's mail server
    //   bounced     - recipient's server rejected the message
    //   complained  - recipient marked it as spam
    //   failed      - Pigeons could not send (bad address, config error, etc.)
    const email = await pigeons.emails.get(emailId)

    res.json({
      orderId: id,
      emailId: email.id,
      status: email.status,
      subject: email.subject,
      to: email.to,
      createdAt: email.createdAt,
      updatedAt: email.updatedAt,
    })
  } catch (err) {
    handlePigeonsError(res, err)
  }
})

// ── Error handling helper ───────────────────────────────────────────────────
// The SDK throws typed errors for common HTTP failures. Map them to
// appropriate HTTP status codes for the API consumer.

function handlePigeonsError(res: Response, err: unknown): void {
  if (err instanceof PigeonsError) {
    // PigeonsError includes the upstream status code, so we can forward it.
    // Common cases:
    //   401  - invalid or missing API key
    //   404  - email or template not found
    //   429  - rate limit exceeded (Pigeons enforces per-route limits)
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    })
    return
  }

  console.error('Unexpected error:', err)
  res.status(500).json({ error: 'Internal server error' })
}

// ── Start ───────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT) || 4000

app.listen(port, () => {
  console.log(`Order emails server listening on http://localhost:${port}`)
})
