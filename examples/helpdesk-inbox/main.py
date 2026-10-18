"""
Helpdesk Inbox  - Pigeons + FastAPI

A multi-inbox helpdesk system that demonstrates:
  - Creating dedicated inboxes for support, billing, and sales
  - Receiving inbound emails via webhook
  - Auto-labeling messages by keyword detection
  - Sending context-aware auto-replies per inbox
  - Thread lifecycle management (open / closed / snoozed)

Run: uvicorn main:app --reload --port 8000
"""

import os
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from pigeons import Pigeons
from pydantic import BaseModel

# ── Configuration ──────────────────────────────────────────────────────────────
# The SDK reads PIGEONS_URL and PIGEONS_API_KEY from environment variables.
# DOMAIN is used to construct inbox email addresses (e.g. support@example.com).

DOMAIN = os.environ.get("DOMAIN", "example.com")

pigeons = Pigeons()

app = FastAPI(
    title="Helpdesk Inbox",
    description="Multi-inbox helpdesk with auto-labeling and thread management",
)


# ── Pydantic Models ───────────────────────────────────────────────────────────
# Request/response shapes for our API endpoints.


class InboxIds(BaseModel):
    """Response from POST /setup with the three created inbox IDs."""

    support: str
    billing: str
    sales: str


class InboxWebhookPayload(BaseModel):
    """Webhook payload that Pigeons sends for inbox.message.received events.

    Pigeons fires this when an inbound email arrives at one of your inboxes.
    The payload includes IDs so you can fetch the full message and thread.
    """

    event: str
    data: dict  # contains inbox_id, message_id, thread_id


class ThreadStatus(str, Enum):
    """Valid thread statuses for the PATCH endpoint."""

    open = "open"
    closed = "closed"
    snoozed = "snoozed"


class UpdateThreadRequest(BaseModel):
    """Request body for updating a thread's status."""

    status: ThreadStatus
    metadata: Optional[dict] = None


class InboxSummary(BaseModel):
    """Per-inbox thread count breakdown by status."""

    inbox_id: str
    inbox_name: str
    email_address: str
    threads: dict  # { "open": int, "closed": int, "snoozed": int }


class DashboardResponse(BaseModel):
    """Dashboard summary across all helpdesk inboxes."""

    inboxes: list[InboxSummary]
    total_threads: int


# ── Inbox Configuration ───────────────────────────────────────────────────────
# Each inbox has a name, email address prefix, description, and an auto-reply
# template. In production you'd store this in a database  - here we keep it
# simple with a module-level dict.

INBOX_CONFIGS: dict[str, dict] = {
    "support": {
        "name": "Support",
        "prefix": "support",
        "description": "General customer support inquiries",
        "auto_reply_subject": "We received your support request",
        "auto_reply_html": (
            "<p>Hi there,</p>"
            "<p>Thanks for reaching out to our support team. We've received your "
            "message and a team member will get back to you within 24 hours.</p>"
            "<p>In the meantime, check our <a href='https://docs.example.com'>docs</a> "
            "for answers to common questions.</p>"
            "<p>Best,<br>Support Team</p>"
        ),
    },
    "billing": {
        "name": "Billing",
        "prefix": "billing",
        "description": "Payment, invoices, and subscription questions",
        "auto_reply_subject": "Your billing inquiry has been received",
        "auto_reply_html": (
            "<p>Hi there,</p>"
            "<p>We've received your billing inquiry and our finance team is on it. "
            "You can expect a response within 1 business day.</p>"
            "<p>For immediate help, visit your "
            "<a href='https://app.example.com/billing'>billing dashboard</a>.</p>"
            "<p>Best,<br>Billing Team</p>"
        ),
    },
    "sales": {
        "name": "Sales",
        "prefix": "sales",
        "description": "Pricing, demos, and partnership inquiries",
        "auto_reply_subject": "Thanks for your interest!",
        "auto_reply_html": (
            "<p>Hi there,</p>"
            "<p>Thanks for reaching out to our sales team! We'd love to learn more "
            "about your needs. A team member will follow up within a few hours.</p>"
            "<p>Want to see Pigeons in action right away? "
            "<a href='https://cal.example.com/demo'>Book a demo</a>.</p>"
            "<p>Best,<br>Sales Team</p>"
        ),
    },
}


# ── Label Detection Rules ─────────────────────────────────────────────────────
# Keyword-based auto-labeling. Each rule maps keywords found in the subject or
# body to a label. When an inbound message matches, the label is attached to
# the message for easy filtering and routing.
#
# In a production system you might use an LLM classifier here instead of
# keyword matching  - see the ai-support-agent example for that approach.

LABEL_RULES: list[dict] = [
    # Billing-related keywords
    {"keywords": ["refund", "charge", "invoice", "payment", "subscription", "receipt"], "label": "billing"},
    # Technical / bug-related keywords
    {"keywords": ["bug", "error", "crash", "broken", "not working", "issue", "debug"], "label": "technical"},
    # Sales-related keywords
    {"keywords": ["pricing", "demo", "enterprise", "quote", "trial", "plan", "upgrade"], "label": "sales"},
    # Urgency markers
    {"keywords": ["urgent", "asap", "emergency", "critical", "immediately"], "label": "urgent"},
    # Feature requests
    {"keywords": ["feature request", "suggestion", "would be nice", "wishlist"], "label": "feature-request"},
]

# In-memory store mapping inbox email addresses to inbox IDs.
# Populated by POST /setup. In production, you'd query Pigeons directly
# or maintain this in your own database.
inbox_registry: dict[str, str] = {}


# ── Helper Functions ───────────────────────────────────────────────────────────


def detect_labels(subject: str, body: str) -> list[str]:
    """Scan the subject and body for keywords and return matching labels.

    Uses simple case-insensitive substring matching. Each rule is evaluated
    independently, so a single message can receive multiple labels
    (e.g. both "billing" and "urgent" if it mentions a refund urgently).
    """
    text = f"{subject} {body}".lower()
    labels: list[str] = []

    for rule in LABEL_RULES:
        for keyword in rule["keywords"]:
            if keyword in text:
                labels.append(rule["label"])
                break  # One match per rule is enough

    return labels


def get_inbox_type(inbox_id: str) -> Optional[str]:
    """Look up the inbox type (support/billing/sales) by inbox ID.

    Reverse-lookup from the registry. Returns None if not found.
    """
    for email_addr, stored_id in inbox_registry.items():
        if stored_id == inbox_id:
            # Extract the prefix before the @ sign
            prefix = email_addr.split("@")[0]
            if prefix in INBOX_CONFIGS:
                return prefix
    return None


# ── Routes ─────────────────────────────────────────────────────────────────────


@app.post("/setup", response_model=InboxIds)
async def setup_inboxes() -> InboxIds:
    """Create the three helpdesk inboxes: support, billing, and sales.

    Each inbox gets:
    - A dedicated email address (e.g. support@example.com)
    - A description for team reference
    - Auto-reply disabled (we handle replies manually in the webhook handler)

    Call this once when setting up the helpdesk. Calling it again will create
    duplicate inboxes  - in production you'd add idempotency checks.
    """
    ids: dict[str, str] = {}

    for key, config in INBOX_CONFIGS.items():
        email_address = f"{config['prefix']}@{DOMAIN}"

        # Create the inbox via the Pigeons API.
        # emailAddress ties this inbox to a specific address on your domain.
        # Pigeons routes inbound emails to the matching inbox automatically.
        inbox = pigeons.inboxes.create({
            "name": f"Helpdesk  - {config['name']}",
            "emailAddress": email_address,
            "description": config["description"],
            "autoReplyEnabled": False,  # We send our own auto-replies below
        })

        ids[key] = inbox["id"]
        inbox_registry[email_address] = inbox["id"]

    return InboxIds(**ids)


@app.post("/webhooks/inbound")
async def handle_inbound_webhook(payload: InboxWebhookPayload) -> dict:
    """Receive and process inbound email webhook events from Pigeons.

    This endpoint should be registered as a Pigeons webhook for the
    `inbox.message.received` event. When someone emails one of your inboxes,
    Pigeons stores the message and fires this webhook.

    Processing steps:
      1. Verify the event type is inbox.message.received
      2. Fetch the full message from Pigeons (webhook only includes IDs)
      3. Detect labels from subject + body keywords
      4. Determine which inbox received the email (support/billing/sales)
      5. Send an auto-reply appropriate for that inbox type
      6. Return a summary of what was processed

    Webhook payload shape from Pigeons:
      {
        "event": "inbox.message.received",
        "data": {
          "inbox_id": "inb_...",
          "message_id": "inm_...",
          "thread_id": "thr_..."
        }
      }
    """
    # Step 1: Only process inbound message events. Pigeons can send other
    # event types to the same URL if configured, so we filter here.
    if payload.event != "inbox.message.received":
        return {"processed": False, "reason": "not_inbound_event"}

    inbox_id: str = payload.data["inbox_id"]
    message_id: str = payload.data["message_id"]
    thread_id: str = payload.data["thread_id"]

    # Step 2: Fetch the full message. The webhook payload only contains IDs
    # to keep payloads small and avoid sending email content over the wire
    # unnecessarily. We fetch the message to read its subject and body.
    message = pigeons.inboxes.messages.get(inbox_id, message_id)

    subject: str = message.get("subject", "")
    body: str = message.get("text", "") or message.get("extractedText", "") or ""
    sender: str = message.get("from", "unknown")

    # Step 3: Auto-label the message based on keyword detection.
    # Labels help with filtering, reporting, and routing to specialized agents.
    labels = detect_labels(subject, body)

    # Step 4: Determine which inbox type received this email.
    # The inbox type drives which auto-reply template we use.
    inbox_type = get_inbox_type(inbox_id)

    # Step 5: Send an auto-reply. We use the inbox's messages.create() method
    # which sends a reply from the inbox's email address. Setting inReplyTo
    # threads the reply into the same conversation.
    auto_reply_sent = False

    if inbox_type and inbox_type in INBOX_CONFIGS:
        config = INBOX_CONFIGS[inbox_type]

        # Send the auto-reply as an outbound message on the same inbox.
        # inReplyTo links it to the original message so it appears in the
        # same thread in the sender's email client.
        pigeons.inboxes.messages.create(inbox_id, {
            "to": sender,
            "subject": f"Re: {subject}",
            "html": config["auto_reply_html"],
            "inReplyTo": message_id,
            "labels": labels,  # Carry the detected labels onto the reply too
        })
        auto_reply_sent = True

    return {
        "processed": True,
        "inbox_id": inbox_id,
        "message_id": message_id,
        "thread_id": thread_id,
        "labels_detected": labels,
        "inbox_type": inbox_type,
        "auto_reply_sent": auto_reply_sent,
    }


@app.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard() -> DashboardResponse:
    """Return a summary of all helpdesk inboxes with thread counts by status.

    Iterates over each registered inbox and counts threads in each state:
    - open: needs attention from the team
    - closed: resolved, no further action needed
    - snoozed: deferred, will resurface later

    This gives a quick overview of helpdesk load and backlog.
    """
    summaries: list[InboxSummary] = []
    total = 0

    for email_addr, inbox_id in inbox_registry.items():
        # Fetch inbox metadata for the display name
        inbox = pigeons.inboxes.get(inbox_id)

        # Count threads per status. We fetch each status separately because
        # the Pigeons API filters by status on the server side, giving us
        # accurate counts without client-side filtering.
        thread_counts: dict[str, int] = {}

        for status in ["open", "closed", "snoozed"]:
            threads = pigeons.inboxes.threads.list(inbox_id, {"status": status})
            # Use len(data) as a count. For large inboxes you'd paginate through
            # all pages or use a dedicated stats endpoint.
            thread_counts[status] = len(threads["data"])

        inbox_total = sum(thread_counts.values())
        total += inbox_total

        summaries.append(InboxSummary(
            inbox_id=inbox_id,
            inbox_name=inbox["name"],
            email_address=email_addr,
            threads=thread_counts,
        ))

    return DashboardResponse(inboxes=summaries, total_threads=total)


@app.patch("/threads/{inbox_id}/{thread_id}")
async def update_thread(
    inbox_id: str,
    thread_id: str,
    body: UpdateThreadRequest,
) -> dict:
    """Update a thread's status (close, snooze, or reopen).

    Thread lifecycle in a helpdesk:
      - open:    New or active  - needs a response from the team.
      - closed:  Resolved  - the customer's issue has been handled.
      - snoozed: Deferred  - will be revisited later (e.g. waiting on customer).

    You can also attach arbitrary metadata to threads for your own use
    (e.g. assigned agent, priority level, SLA deadline).
    """
    # Build the update payload. Only include fields that were provided.
    update_params: dict = {"status": body.status.value}
    if body.metadata is not None:
        update_params["metadata"] = body.metadata

    # Update via the Pigeons SDK. This calls PATCH /v1/inboxes/:id/threads/:id
    # on the Pigeons server and returns the updated thread object.
    thread = pigeons.inboxes.threads.update(inbox_id, thread_id, update_params)

    return {
        "thread_id": thread["id"],
        "inbox_id": thread["inboxId"],
        "status": thread["status"],
        "subject": thread["subject"],
        "message_count": thread["messageCount"],
        "participants": thread["participants"],
        "updated_at": thread["updatedAt"],
    }


@app.get("/threads/{inbox_id}")
async def list_threads(
    inbox_id: str,
    status: Optional[ThreadStatus] = None,
    limit: int = 25,
    cursor: Optional[str] = None,
) -> dict:
    """List threads for a specific inbox, optionally filtered by status.

    Supports cursor-based pagination for large inboxes. Pass the `next_cursor`
    value from a previous response as the `cursor` query parameter to fetch
    the next page.

    Examples:
      GET /threads/inb_abc123                        - all threads
      GET /threads/inb_abc123?status=open             - only open threads
      GET /threads/inb_abc123?status=snoozed&limit=5  - 5 snoozed threads
    """
    # Build query parameters, omitting any that weren't provided.
    params: dict = {"limit": limit}
    if status is not None:
        params["status"] = status.value
    if cursor is not None:
        params["cursor"] = cursor

    result = pigeons.inboxes.threads.list(inbox_id, params)

    return {
        "inbox_id": inbox_id,
        "threads": result["data"],
        "has_more": result["has_more"],
        "next_cursor": result["next_cursor"],
    }
