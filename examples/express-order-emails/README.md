# Express Order Emails

E-commerce transactional email flows with idempotency, powered by the Pigeons TypeScript SDK.

## What you'll learn

- **Idempotency keys**  - prevent duplicate emails when clients retry failed requests
- **Template-based sends**  - use stored templates with dynamic variables instead of inline HTML
- **Delivery status polling**  - check email delivery state by ID (and when to use webhooks instead)

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with `emails:send` and `templates:read` scopes

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your instance URL and API key:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
PORT=4000
```

### Create the receipt template

The `/orders/:id/invoice` route uses a stored template with the slug `receipt`. Create it before testing that route:

```bash
curl -X POST http://localhost:3891/v1/templates \
  -H "x-api-key: pgn_..." \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "receipt",
    "name": "Order Receipt",
    "subject": "Receipt for Order #{{orderId}}",
    "body": "<h1>Receipt</h1><p>Hi {{name}},</p><p>Here is your receipt for order <strong>#{{orderId}}</strong>.</p><p><strong>Total: ${{total}}</strong></p><p>Thank you for your purchase!</p>"
  }'
```

## Run

```bash
npm start
```

The server starts on `http://localhost:4000` (or the port in your `.env`).

## Code walkthrough

### POST /orders/:id/confirm

Sends an order confirmation email with an HTML table of line items and a plain-text fallback.

**Idempotency key:** `order-{id}-confirm`. If your checkout flow retries the confirmation request after a timeout, Pigeons recognizes the duplicate key and returns the original email object without sending again. Keys are stored for 24 hours.

```bash
curl -X POST http://localhost:4000/orders/42/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "name": "Alice",
    "orderId": "42",
    "items": [
      { "name": "Widget", "qty": 2, "price": 9.99 },
      { "name": "Gadget", "qty": 1, "price": 24.99 }
    ],
    "total": 44.97
  }'
```

### POST /orders/:id/shipped

Sends a shipping notification with a tracking number and link. No idempotency key by default since tracking info can change if the carrier reassigns packages.

```bash
curl -X POST http://localhost:4000/orders/42/shipped \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "name": "Alice",
    "trackingNumber": "1Z999AA10123456784",
    "trackingUrl": "https://track.example.com/1Z999AA10123456784"
  }'
```

### POST /orders/:id/invoice

Sends a receipt email using a stored Pigeons template. The template is looked up by slug (`receipt`), then the email is sent with template variables.

**Idempotency key:** `order-{id}-invoice`. Invoices should only be sent once per order.

```bash
curl -X POST http://localhost:4000/orders/42/invoice \
  -H "Content-Type: application/json" \
  -d '{
    "email": "customer@example.com",
    "name": "Alice",
    "orderId": "42",
    "items": [
      { "name": "Widget", "qty": 2, "price": 9.99 },
      { "name": "Gadget", "qty": 1, "price": 24.99 }
    ],
    "total": 44.97
  }'
```

### GET /orders/:id/status

Checks the current delivery status of an email by its ID.

The email status progresses through: `queued` -> `sending` -> `sent` -> `delivered`. Failures land at `bounced`, `complained`, or `failed`.

```bash
curl "http://localhost:4000/orders/42/status?emailId=msg_abc123"
```

In production, use webhooks instead of polling. Pigeons fires events for `email.delivered`, `email.bounced`, and `email.complained` in real-time.

## Next steps

- [with-typescript](../with-typescript/)  - Minimal SDK quick start
- [email-templates](../email-templates/)  - Manage and preview templates
- [with-curl](../with-curl/)  - Raw HTTP calls without an SDK
