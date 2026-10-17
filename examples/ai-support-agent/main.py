"""
AI Support Agent — Autonomous email support powered by LLM + Pigeons.

Receives inbound emails via Pigeons webhooks, loads the full thread
for context, generates a reply using Claude, and sends it back through
Pigeons — all without human intervention.

Run:
    uvicorn main:app --port 8000

Then register the webhook in Pigeons:
    curl -X POST http://localhost:3891/v1/webhooks \
      -H "x-api-key: $PIGEONS_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "url": "http://localhost:8000/webhooks/inbound",
        "events": ["inbox.message.received"]
      }'
"""

from __future__ import annotations

import logging
import os
from typing import Any

import anthropic
from fastapi import FastAPI, HTTPException, Request
from pigeons import Pigeons

# ── Configuration ────────────────────────────────────────────────────────────
# All values come from environment variables. Copy .env.example to .env
# and fill in your values before starting the server.

PIGEONS_URL: str = os.environ.get("PIGEONS_URL", "http://localhost:3891")
PIGEONS_API_KEY: str = os.environ.get("PIGEONS_API_KEY", "")
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
INBOX_ID: str = os.environ.get("INBOX_ID", "")
COMPANY_NAME: str = os.environ.get("COMPANY_NAME", "Acme Inc")

# ── Clients ──────────────────────────────────────────────────────────────────

pigeons = Pigeons(base_url=PIGEONS_URL, api_key=PIGEONS_API_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

app = FastAPI(title="AI Support Agent")
logger = logging.getLogger("ai-support-agent")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")


# ── LLM prompt construction ─────────────────────────────────────────────────

SYSTEM_PROMPT: str = f"""\
You are a friendly and knowledgeable customer-support agent for {COMPANY_NAME}.

Guidelines:
- Be professional, empathetic, and concise.
- If you can answer the question confidently, do so.
- If you are unsure or the request is outside your scope (billing disputes,
  account deletion, legal matters), say so honestly and tell the customer
  a human agent will follow up.
- Never fabricate information. If you don't know, say "I don't have that
  information" and offer to escalate.
- Keep replies under 200 words unless a longer explanation is genuinely needed.
- Do not include a subject line — only the reply body.
- Sign off with "Best,\\nThe {COMPANY_NAME} Team".
"""

# Keywords that signal the LLM wants to escalate to a human.
ESCALATION_MARKERS: list[str] = [
    "human agent will follow up",
    "escalate this",
    "I don't have that information",
    "outside my scope",
]


def build_messages(
    thread_messages: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Convert a Pigeons thread into Anthropic message-API format.

    Each inbound message becomes a "user" turn. Each outbound message
    becomes an "assistant" turn. This gives the LLM full conversation
    context so its reply is coherent with everything said so far.
    """
    messages: list[dict[str, str]] = []

    for msg in thread_messages:
        # Use the plain-text extracted reply when available so the LLM
        # doesn't see quoted text from earlier messages.
        body: str = (
            msg.get("extractedText")
            or msg.get("text")
            or msg.get("extractedHtml")
            or msg.get("html")
            or ""
        )

        role: str = "user" if msg["direction"] == "inbound" else "assistant"
        messages.append({"role": role, "content": body.strip()})

    return messages


def needs_escalation(reply_text: str) -> bool:
    """Check whether the LLM reply contains language indicating it
    cannot handle the request and wants to pass it to a human."""
    lower = reply_text.lower()
    return any(marker.lower() in lower for marker in ESCALATION_MARKERS)


# ── Core agent loop ─────────────────────────────────────────────────────────

async def handle_inbound_message(
    inbox_id: str,
    message_id: str,
    thread_id: str,
) -> dict[str, Any]:
    """Process a single inbound message end-to-end.

    Steps:
      1. Fetch the thread and its full message history.
      2. Build an LLM prompt from the conversation.
      3. Call Claude to generate a reply.
      4. If the LLM signals it can't help, mark the thread for escalation.
      5. Send the reply back through Pigeons (threaded).
      6. Return a summary of what happened.
    """

    # ── 1. Load thread context ───────────────────────────────────────────
    # Fetch the thread metadata (subject, status, participants) and the
    # full ordered list of messages so the LLM sees the entire conversation.

    logger.info("Loading thread %s for message %s", thread_id, message_id)

    thread: dict[str, Any] = pigeons.inboxes.threads.get(inbox_id, thread_id)
    messages_response: dict[str, Any] = pigeons.inboxes.messages.list(
        inbox_id, {"threadId": thread_id, "limit": 50}
    )
    thread_messages: list[dict[str, Any]] = messages_response["data"]

    # Messages come newest-first from the API; reverse so the LLM sees
    # the conversation in chronological order.
    thread_messages.reverse()

    logger.info(
        "Thread '%s' — %d messages, %s",
        thread["subject"],
        len(thread_messages),
        [m["direction"] for m in thread_messages],
    )

    # ── 2. Build the LLM prompt ─────────────────────────────────────────
    # The system prompt defines the agent's persona and rules.
    # The conversation history provides context for a coherent reply.

    conversation = build_messages(thread_messages)

    if not conversation:
        logger.warning("Thread %s has no message content — skipping", thread_id)
        return {"action": "skipped", "reason": "empty thread"}

    # ── 3. Generate a reply with Claude ──────────────────────────────────
    # Call the Anthropic API with the full conversation. If the API call
    # fails, we log the error but don't crash — the customer just won't
    # get an immediate auto-reply.

    logger.info("Generating reply for thread '%s'...", thread["subject"])

    try:
        response = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=conversation,
        )
        reply_text: str = response.content[0].text
    except anthropic.APIError as exc:
        logger.error("Anthropic API error: %s", exc)
        return {"action": "error", "reason": f"LLM call failed: {exc}"}

    logger.info("Generated reply (%d chars)", len(reply_text))

    # ── 4. Check for escalation ──────────────────────────────────────────
    # If the LLM says it can't handle the request, flag the thread's
    # metadata so a human dashboard can filter for escalated threads.

    escalated: bool = needs_escalation(reply_text)

    if escalated:
        logger.info("Thread %s flagged for escalation", thread_id)
        pigeons.inboxes.threads.update(inbox_id, thread_id, {
            "metadata": {
                **(thread.get("metadata") or {}),
                "escalated": True,
                "escalation_reason": "LLM indicated it cannot resolve this request",
            }
        })

    # ── 5. Send the reply through Pigeons ────────────────────────────────
    # Use inReplyTo to chain the reply onto the existing thread.
    # Pigeons handles the email threading headers (In-Reply-To, References)
    # and sends through SES.

    # Find the last inbound message to reply to directly.
    last_inbound: dict[str, Any] | None = None
    for msg in reversed(thread_messages):
        if msg["direction"] == "inbound":
            last_inbound = msg
            break

    reply_to_id: str = last_inbound["id"] if last_inbound else message_id

    sent_message: dict[str, Any] = pigeons.inboxes.messages.create(inbox_id, {
        "to": last_inbound["from"] if last_inbound else thread["participants"][0],
        "html": reply_text.replace("\n", "<br>"),
        "text": reply_text,
        "inReplyTo": reply_to_id,
    })

    logger.info(
        "Reply sent: %s → %s (escalated: %s)",
        sent_message["id"],
        sent_message.get("to"),
        escalated,
    )

    return {
        "action": "replied",
        "message_id": sent_message["id"],
        "thread_id": thread_id,
        "escalated": escalated,
        "reply_length": len(reply_text),
    }


# ── Webhook endpoint ────────────────────────────────────────────────────────

@app.post("/webhooks/inbound")
async def webhook_inbound(request: Request) -> dict[str, Any]:
    """Receive inbound email events from Pigeons.

    Pigeons sends a POST with:
        {
            "event": "inbox.message.received",
            "data": {
                "inbox_id": "inb_...",
                "message_id": "inm_...",
                "thread_id": "thr_..."
            }
        }

    The agent processes the message and returns a summary.
    """
    body: dict[str, Any] = await request.json()

    event: str = body.get("event", "")
    data: dict[str, Any] = body.get("data", {})

    if event != "inbox.message.received":
        logger.info("Ignoring event: %s", event)
        return {"status": "ignored", "event": event}

    inbox_id: str = data.get("inbox_id", "")
    message_id: str = data.get("message_id", "")
    thread_id: str = data.get("thread_id", "")

    if not all([inbox_id, message_id, thread_id]):
        logger.warning("Webhook payload missing required fields: %s", data)
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Only process messages for our configured inbox.
    if inbox_id != INBOX_ID:
        logger.info("Ignoring message for inbox %s (not %s)", inbox_id, INBOX_ID)
        return {"status": "ignored", "reason": "different inbox"}

    # Fetch the message to check direction — only reply to inbound messages.
    # This prevents infinite loops where the agent replies to its own outbound
    # messages.
    message: dict[str, Any] = pigeons.inboxes.messages.get(inbox_id, message_id)
    if message["direction"] != "inbound":
        logger.info("Skipping outbound message %s", message_id)
        return {"status": "skipped", "reason": "outbound message"}

    result: dict[str, Any] = await handle_inbound_message(
        inbox_id, message_id, thread_id
    )

    return {"status": "ok", **result}


# ── Monitoring endpoints ────────────────────────────────────────────────────

@app.get("/threads")
async def list_threads(
    status: str | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """List recent threads for monitoring.

    Query params:
        status — Filter by thread status: open, closed, snoozed
        limit  — Number of threads to return (default 25)
    """
    params: dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status

    result: dict[str, Any] = pigeons.inboxes.threads.list(INBOX_ID, params)
    return result


@app.post("/threads/{thread_id}/close")
async def close_thread(thread_id: str) -> dict[str, Any]:
    """Close a resolved thread.

    Mark a thread as closed once the issue is resolved. Closed threads
    won't appear in the default open-threads view.
    """
    thread: dict[str, Any] = pigeons.inboxes.threads.update(
        INBOX_ID, thread_id, {"status": "closed"}
    )

    logger.info("Thread %s closed", thread_id)
    return {"status": "closed", "thread": thread}


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict[str, str]:
    """Health check for monitoring and load balancers."""
    return {"status": "ok", "service": "ai-support-agent"}
