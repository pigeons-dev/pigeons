# FastAPI Notifications

User notifications with scheduling and batch send, powered by Pigeons.

## What you'll learn

- Create contacts to store recipients for future emails
- Send a single transactional email (welcome, activity notification)
- Batch send to multiple recipients in one API call (weekly digest)
- Schedule emails for future delivery with `scheduledAt`
- Handle Pigeons errors (`ValidationError`, `NotFoundError`, `PigeonsError`)

## Prerequisites

- Python 3.10+
- A running Pigeons instance (local or Docker)
- An API key with `emails:send` and `contacts:write` scopes

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your instance URL and API key:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
```

## Run

```bash
uvicorn main:app --reload
```

The server starts at `http://localhost:8000`. FastAPI's interactive docs are available at `http://localhost:8000/docs`.

## Try it out

### Signup  - create a contact and send a welcome email

```bash
curl -X POST http://localhost:8000/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "name": "Alice Smith"
  }'
```

```json
{
  "contact_id": "ctc_abc123",
  "email_id": "msg_def456",
  "message": "Contact created and welcome email queued."
}
```

### Activity notification  - single send

```bash
curl -X POST http://localhost:8000/notify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "name": "Alice",
    "actor_name": "Bob",
    "action": "commented on your post",
    "preview": "Looks great! I love the new design.",
    "action_url": "https://app.example.com/posts/42"
  }'
```

```json
{
  "email_id": "msg_ghi789",
  "status": "queued",
  "message": "Notification email queued."
}
```

### Weekly digest  - batch send

```bash
curl -X POST http://localhost:8000/digest \
  -H "Content-Type: application/json" \
  -d '{
    "emails": [
      "alice@example.com",
      "bob@example.com",
      "carol@example.com"
    ]
  }'
```

```json
{
  "sent": 3,
  "email_ids": ["msg_aaa", "msg_bbb", "msg_ccc"],
  "message": "Digest queued for 3 recipients."
}
```

### Scheduled email  - future delivery

```bash
curl -X POST http://localhost:8000/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "name": "Alice",
    "subject": "Your trial expires tomorrow",
    "html": "<p>Hi Alice, your free trial ends tomorrow. <a href=\"https://app.example.com/billing\">Upgrade now</a> to keep your data.</p>",
    "scheduled_at": "2025-01-15T09:00:00Z"
  }'
```

```json
{
  "email_id": "msg_jkl012",
  "scheduled_at": "2025-01-15T09:00:00+00:00",
  "status": "scheduled",
  "message": "Email scheduled for future delivery."
}
```

## Code walkthrough

### Pigeons client

The `Pigeons` client is initialized once at module level. It reads `PIGEONS_URL` and `PIGEONS_API_KEY` from environment variables automatically  - no config files needed.

```python
from pigeons import Pigeons

pigeons = Pigeons()
```

### Contacts

`pigeons.contacts.create()` stores a recipient in your Pigeons instance. Contacts are the foundation for audience management  - they track subscription status, bounce history, and custom tags. The `/signup` endpoint creates a contact before sending the welcome email so the recipient is available for future campaigns and sequences.

### Single send

`pigeons.emails.send()` queues one email for delivery. The response comes back immediately with status `queued`. The background worker picks it up, hands it to SES, and the status progresses through `sending` → `sent` → `delivered`. Both `/signup` and `/notify` use this pattern.

### Batch send

`pigeons.emails.batch()` queues multiple emails in a single API call. This is more efficient than calling `send()` in a loop  - fewer round trips, no rate-limit concerns, and atomic queueing (all succeed or all fail). The `/digest` endpoint uses this to send a weekly digest to a list of recipients.

### Scheduled send

Passing `scheduledAt` (ISO 8601 string) to `emails.send()` tells Pigeons to hold the email until the specified time. The email stays in `scheduled` status and can be cancelled with `pigeons.emails.cancel(id)` before delivery. The `/schedule` endpoint uses this for time-sensitive notifications like trial expiry reminders.

### Error handling

The Pigeons SDK raises typed exceptions that map to HTTP status codes:

| Exception | Status | When |
|---|---|---|
| `ValidationError` | 400 | Missing/invalid fields in the request |
| `AuthError` | 401 | Bad or missing API key |
| `NotFoundError` | 404 | Resource doesn't exist (e.g., unverified domain) |
| `RateLimitError` | 429 | Too many requests  - back off and retry |
| `PigeonsError` | varies | Base class for all Pigeons errors |

Each endpoint catches these and converts them to appropriate FastAPI `HTTPException` responses.

## Next steps

- [ai-support-agent](../ai-support-agent/)  - LLM reads inbound emails and sends autonomous replies
- [helpdesk-inbox](../helpdesk-inbox/)  - Multi-inbox routing, auto-label, thread management
- [delivery-monitor](../delivery-monitor/)  - Poll stats API, track warmup phase, flag high bounce rates
