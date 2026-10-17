# AI Support Agent

Autonomous email support powered by LLM + Pigeons. Inbound emails hit your Pigeons inbox, the agent loads the full thread for context, generates a reply with Claude, and sends it back through Pigeons — no human in the loop.

## What you'll learn

- Receive inbound emails via Pigeons webhooks
- Load full thread context (all messages in a conversation)
- Integrate an LLM to generate contextual replies
- Send autonomous replies threaded onto the original conversation
- Manage thread lifecycle (open, escalated, closed)

## Prerequisites

- Python 3.10+
- A running Pigeons instance with **inbound email configured** (SES receipt rule, S3 bucket, SNS topic — see the [Pigeons inbound setup guide](https://pigeons.dev/docs/inbound))
- A Pigeons inbox created for support emails
- A webhook registered to forward `inbox.message.received` events
- An [Anthropic API key](https://console.anthropic.com/)

## Architecture

```
Customer sends email
        │
        ▼
   Amazon SES (inbound)
        │
        ▼
  Pigeons processes email
  ├── Parses MIME, extracts reply text
  ├── Routes to inbox, resolves thread
  └── Fires webhook ─────────────────┐
                                     │
        ┌────────────────────────────┘
        ▼
  AI Support Agent (this app)
  ├── POST /webhooks/inbound receives event
  ├── Fetches full thread history from Pigeons
  ├── Builds conversation prompt
  ├── Calls Claude API for a reply
  ├── Detects escalation signals
  └── Sends reply via Pigeons ───────┐
                                     │
        ┌────────────────────────────┘
        ▼
  Pigeons sends reply
  ├── Threads onto original conversation
  ├── Sets In-Reply-To / References headers
  └── Delivers through SES
        │
        ▼
  Customer receives reply
```

## Setup

```bash
cd examples/ai-support-agent

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

Edit `.env` with your values:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_your_api_key
ANTHROPIC_API_KEY=sk-ant-your_key
INBOX_ID=inb_your_inbox_id
COMPANY_NAME=Acme Inc
```

### Create the inbox and webhook

If you haven't already, create an inbox and register the webhook:

```bash
# Create an inbox
curl -X POST http://localhost:3891/v1/inboxes \
  -H "x-api-key: $PIGEONS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"address": "support@yourdomain.com", "name": "Support"}'

# Register the webhook
curl -X POST http://localhost:3891/v1/webhooks \
  -H "x-api-key: $PIGEONS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:8000/webhooks/inbound",
    "events": ["inbox.message.received"]
  }'
```

## Run

```bash
uvicorn main:app --port 8000
```

The agent is now listening. Send an email to your inbox address and watch the logs — you'll see the full pipeline: webhook received, thread loaded, LLM called, reply sent.

## How to test

1. Send an email to the address configured on your Pigeons inbox (e.g. `support@yourdomain.com`).
2. Watch the agent logs — you'll see each step of the pipeline.
3. Check your email — the reply should arrive threaded under your original message.
4. Reply again — the agent will see the full conversation history and respond accordingly.
5. Monitor threads at `GET http://localhost:8000/threads`.

For local testing without a real email, you can simulate the webhook:

```bash
curl -X POST http://localhost:8000/webhooks/inbound \
  -H "Content-Type: application/json" \
  -d '{
    "event": "inbox.message.received",
    "data": {
      "inbox_id": "inb_your_inbox_id",
      "message_id": "inm_some_message_id",
      "thread_id": "thr_some_thread_id"
    }
  }'
```

## Code walkthrough

### Webhook handler (`POST /webhooks/inbound`)

Pigeons sends a POST when a new email arrives. The payload includes the inbox, message, and thread IDs. The handler:

1. Validates the event type is `inbox.message.received`
2. Checks the message is inbound (not our own outbound reply — prevents infinite loops)
3. Delegates to the core agent loop

### Agent loop (`handle_inbound_message`)

The heart of the agent. For each inbound message:

1. **Loads thread context** — Calls `pigeons.inboxes.threads.get()` for metadata and `pigeons.inboxes.messages.list()` with a `threadId` filter to get the full conversation history.

2. **Builds the LLM prompt** — Converts the thread into Anthropic message format. Inbound messages become `user` turns, outbound messages become `assistant` turns. Uses `extractedText` when available to avoid duplicating quoted text.

3. **Generates a reply** — Calls the Claude API with the system prompt (company persona, guidelines) and the full conversation. If the API call fails, the error is logged but the server stays running.

4. **Detects escalation** — Scans the reply for phrases like "I don't have that information" or "human agent will follow up." If found, updates the thread metadata with an `escalated: true` flag so a human dashboard can filter for threads that need attention.

5. **Sends the reply** — Calls `pigeons.inboxes.messages.create()` with `inReplyTo` set to the last inbound message ID. Pigeons handles threading headers (`In-Reply-To`, `References`) and delivers through SES.

### Monitoring endpoints

- `GET /threads` — List threads with optional status filter (`open`, `closed`, `snoozed`). Useful for building a dashboard.
- `POST /threads/{thread_id}/close` — Mark a resolved thread as closed.
- `GET /health` — Health check for load balancers and uptime monitors.

## Customization

### Swap the LLM

Replace the `claude.messages.create()` call with any LLM provider. The prompt structure (system + conversation history) works with any chat-completion API.

### Add RAG for knowledge base

Before calling the LLM, search your documentation or FAQ database for relevant articles. Append the results to the system prompt:

```python
docs = search_knowledge_base(thread_messages[-1]["text"])
augmented_system = SYSTEM_PROMPT + f"\n\nRelevant documentation:\n{docs}"
```

### Route by topic

Use the LLM to classify the email before replying. Route billing questions to one handler, technical support to another:

```python
classification = classify_email(thread_messages[-1])
if classification == "billing":
    # Escalate billing to human immediately
    pigeons.inboxes.threads.update(inbox_id, thread_id, {
        "metadata": {"category": "billing", "escalated": True}
    })
```

### Add webhook signature verification

For production, verify the `X-Pigeons-Signature` header to ensure the webhook came from your Pigeons instance:

```python
import hashlib
import hmac

def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### Rate limiting

Add a cooldown to avoid replying too rapidly to the same thread. A simple approach: check `thread["lastMessageAt"]` and skip if the last message was sent by the agent within the past few minutes.

## Next steps

- [helpdesk-inbox](../helpdesk-inbox/) — Multi-inbox routing, auto-labeling, thread management
- [ai-outreach-agent](../ai-outreach-agent/) — LLM-personalized outbound campaigns with drip sequences
- [webhook-event-handler](../webhook-event-handler/) — Handle delivery, bounce, complaint, and open events
