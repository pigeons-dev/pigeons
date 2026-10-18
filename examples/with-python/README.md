# Quick Start  - Python

Send your first email with the Pigeons Python SDK in under 5 minutes.

## What you'll learn

- Initialize the `Pigeons` client with environment variables
- Send a transactional email
- Check delivery status by email ID
- List recent emails with cursor-based pagination

## Prerequisites

- Python 3.10+
- A running Pigeons instance (local or Docker)
- An API key

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
python main.py
```

Expected output:

```
Sending email...

  Email sent!
  ID:     msg_abc123
  Status: queued
  To:     recipient@example.com

Checking delivery status...

  Current status: delivered
  SES Message ID: 0100018a...

Listing recent emails...

  msg_abc123  delivered   Hello from Pigeons

Done!
```

## Code walkthrough

The example covers three SDK methods:

1. **`pigeons.emails.send()`**  - Queues an email for delivery. Returns immediately with the email dict (status: `queued`). The background worker picks it up and sends it through SES.

2. **`pigeons.emails.get(id)`**  - Fetches the current state of an email by ID. Status progresses through: `queued` → `sending` → `sent` → `delivered`. If something goes wrong: `bounced`, `complained`, or `failed`.

3. **`pigeons.emails.list()`**  - Returns a paginated list of emails. Supports filtering by `status`, `limit`, and `cursor` for pagination.

## Next steps

- [with-typescript](../with-typescript/)  - Same flow in TypeScript
- [with-curl](../with-curl/)  - Raw HTTP calls without an SDK
- [email-templates](../email-templates/)  - Use React Email templates instead of inline HTML
- [fastapi-notifications](../fastapi-notifications/)  - Build a notification system with FastAPI
