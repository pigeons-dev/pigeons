# Quick Start  - curl

Send your first email using raw HTTP calls. No SDK required  - works from any language that can make HTTP requests.

## What you'll learn

- Authenticate with the `x-api-key` header
- Send a transactional email via `POST /v1/emails`
- Check delivery status via `GET /v1/emails/:id`
- List emails with pagination via `GET /v1/emails`

## Prerequisites

- `curl` and `bash`
- A running Pigeons instance (local or Docker)
- An API key

## Setup

```bash
cp .env.example .env
```

Edit `.env` with your instance URL and API key:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
```

## Run

```bash
chmod +x send.sh
./send.sh
```

## API reference

### Authentication

All requests use the `x-api-key` header:

```bash
curl -H "x-api-key: pgn_..." https://mail.yourapp.com/v1/emails
```

### Send an email

```bash
curl -X POST http://localhost:3891/v1/emails \
  -H "Content-Type: application/json" \
  -H "x-api-key: pgn_..." \
  -d '{
    "to": "user@example.com",
    "subject": "Hello",
    "html": "<h1>Hi</h1>"
  }'
```

### Get email status

```bash
curl http://localhost:3891/v1/emails/msg_abc123 \
  -H "x-api-key: pgn_..."
```

### List emails

```bash
curl "http://localhost:3891/v1/emails?limit=10&status=delivered" \
  -H "x-api-key: pgn_..."
```

### Idempotency

For safe retries, pass an `Idempotency-Key` header on mutating requests:

```bash
curl -X POST http://localhost:3891/v1/emails \
  -H "Content-Type: application/json" \
  -H "x-api-key: pgn_..." \
  -H "Idempotency-Key: order-4821-receipt" \
  -d '{"to": "user@example.com", "subject": "Receipt", "html": "..."}'
```

## Next steps

- [with-typescript](../with-typescript/)  - Same flow using the TypeScript SDK
- [with-python](../with-python/)  - Same flow using the Python SDK
- [webhook-event-handler](../webhook-event-handler/)  - Receive delivery events via webhooks instead of polling
