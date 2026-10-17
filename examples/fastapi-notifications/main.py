"""
FastAPI Notifications — Pigeons Example

A notification service built with FastAPI and the Pigeons Python SDK.
Demonstrates four patterns:
  1. Signup flow — create a contact and send a welcome email
  2. Activity notification — single transactional send
  3. Weekly digest — batch send to multiple recipients
  4. Scheduled email — queue an email for future delivery

Run: uvicorn main:app --reload
"""

from __future__ import annotations

from datetime import datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr

from pigeons import Pigeons, PigeonsError, ValidationError, NotFoundError

# ---------------------------------------------------------------------------
# Pigeons client — initialized once at module level.
# Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables.
# You can also pass them explicitly:
#   pigeons = Pigeons(base_url="http://localhost:3891", api_key="pgn_...")
# ---------------------------------------------------------------------------
pigeons = Pigeons()

app = FastAPI(
    title="FastAPI Notifications",
    description="User notifications with scheduling and batch send, powered by Pigeons.",
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SignupRequest(BaseModel):
    """New user signup payload."""
    email: EmailStr
    name: str


class SignupResponse(BaseModel):
    """Returned after a successful signup."""
    contact_id: str
    email_id: str
    message: str


class NotifyRequest(BaseModel):
    """Activity notification payload."""
    email: EmailStr
    name: str
    actor_name: str
    action: str
    preview: str
    action_url: str


class NotifyResponse(BaseModel):
    """Returned after sending an activity notification."""
    email_id: str
    status: str
    message: str


class DigestRequest(BaseModel):
    """Weekly digest payload — sends to multiple recipients at once."""
    emails: list[EmailStr]


class DigestResponse(BaseModel):
    """Returned after a batch digest send."""
    sent: int
    email_ids: list[str]
    message: str


class ScheduleRequest(BaseModel):
    """Scheduled email payload."""
    email: EmailStr
    name: str
    subject: str
    html: str
    scheduled_at: datetime


class ScheduleResponse(BaseModel):
    """Returned after scheduling an email."""
    email_id: str
    scheduled_at: str
    status: str
    message: str


# ---------------------------------------------------------------------------
# POST /signup — Create a contact and send a welcome email
# ---------------------------------------------------------------------------


@app.post("/signup", response_model=SignupResponse)
def signup(body: SignupRequest) -> SignupResponse:
    """
    Register a new user.

    This endpoint demonstrates two Pigeons operations in sequence:
      1. Create a contact — stores the user in your Pigeons instance so you
         can reference them later in campaigns, sequences, and analytics.
      2. Send a welcome email — a single transactional send using inline HTML.

    The contact is tagged "signup" so you can segment signups later.
    """
    try:
        # Step 1: Create a contact in Pigeons.
        # Contacts are the foundation for audience management. Every recipient
        # you intend to email more than once should be stored as a contact.
        # The "tags" field lets you segment contacts for campaigns.
        first_name, _, last_name = body.name.partition(" ")
        contact = pigeons.contacts.create({
            "email": body.email,
            "firstName": first_name,
            "lastName": last_name,
            "tags": ["signup"],
        })

        # Step 2: Send a welcome email.
        # pigeons.emails.send() queues the email and returns immediately.
        # The background worker picks it up and delivers via SES.
        # Status starts as "queued" and progresses to "delivered".
        email = pigeons.emails.send({
            "to": body.email,
            "subject": f"Welcome to the app, {first_name}!",
            "html": (
                f"<h1>Welcome, {first_name}!</h1>"
                "<p>Thanks for signing up. Your account is ready.</p>"
                "<p>If you have any questions, just reply to this email.</p>"
            ),
            "text": (
                f"Welcome, {first_name}!\n\n"
                "Thanks for signing up. Your account is ready.\n"
                "If you have any questions, just reply to this email."
            ),
            # Tags on the email are separate from contact tags — they help
            # you filter and search emails in the Pigeons dashboard and API.
            "tags": ["welcome"],
        })

        return SignupResponse(
            contact_id=contact["id"],
            email_id=email["id"],
            message="Contact created and welcome email queued.",
        )

    except ValidationError as exc:
        # Pigeons returns a 400 when required fields are missing or invalid.
        raise HTTPException(status_code=400, detail=str(exc))
    except PigeonsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /notify — Send an activity notification (single send)
# ---------------------------------------------------------------------------


@app.post("/notify", response_model=NotifyResponse)
def notify(body: NotifyRequest) -> NotifyResponse:
    """
    Send an activity notification email.

    This endpoint demonstrates a single transactional send — the most common
    Pigeons operation. Each call to `pigeons.emails.send()` queues one email.

    Use this pattern for real-time notifications like "Alice commented on
    your post" or "Your build succeeded".
    """
    try:
        email = pigeons.emails.send({
            "to": body.email,
            "subject": f"{body.actor_name} {body.action}",
            "html": (
                f"<p><strong>{body.actor_name}</strong> {body.action}</p>"
                f"<p>{body.preview}</p>"
                f'<p><a href="{body.action_url}">View in app</a></p>'
            ),
            "text": (
                f"{body.actor_name} {body.action}\n\n"
                f"{body.preview}\n\n"
                f"View in app: {body.action_url}"
            ),
            "tags": ["notification"],
        })

        return NotifyResponse(
            email_id=email["id"],
            status=email["status"],
            message="Notification email queued.",
        )

    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PigeonsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /digest — Send a weekly digest to multiple recipients (batch send)
# ---------------------------------------------------------------------------


@app.post("/digest", response_model=DigestResponse)
def digest(body: DigestRequest) -> DigestResponse:
    """
    Send a weekly digest email to multiple recipients in one API call.

    This endpoint demonstrates `pigeons.emails.batch()` — the batch send API.
    Instead of calling `send()` in a loop, you pass a list of email payloads
    and Pigeons queues them all atomically. This is faster, avoids rate-limit
    issues, and guarantees that either all emails are queued or none are.

    Use this pattern for digests, announcements, or any broadcast to a
    known list of recipients that doesn't warrant a full campaign.
    """
    try:
        # Build one email payload per recipient. In a real app you'd
        # personalize the HTML with each user's activity feed.
        email_payloads = [
            {
                "to": addr,
                "subject": "Your weekly digest",
                "html": (
                    "<h2>Your Weekly Digest</h2>"
                    "<p>Here's what happened this week:</p>"
                    "<ul>"
                    "<li>3 new followers</li>"
                    "<li>12 post views</li>"
                    "<li>1 comment on your project</li>"
                    "</ul>"
                    "<p>See you next week!</p>"
                ),
                "text": (
                    "Your Weekly Digest\n\n"
                    "Here's what happened this week:\n"
                    "- 3 new followers\n"
                    "- 12 post views\n"
                    "- 1 comment on your project\n\n"
                    "See you next week!"
                ),
                "tags": ["digest"],
            }
            for addr in body.emails
        ]

        # pigeons.emails.batch() sends all emails in a single request.
        # Returns a list of email objects, one per payload.
        results = pigeons.emails.batch(email_payloads)

        return DigestResponse(
            sent=len(results),
            email_ids=[e["id"] for e in results],
            message=f"Digest queued for {len(results)} recipients.",
        )

    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PigeonsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


# ---------------------------------------------------------------------------
# POST /schedule — Schedule an email for future delivery
# ---------------------------------------------------------------------------


@app.post("/schedule", response_model=ScheduleResponse)
def schedule(body: ScheduleRequest) -> ScheduleResponse:
    """
    Schedule an email for future delivery.

    This endpoint demonstrates the `scheduledAt` parameter on `emails.send()`.
    When `scheduledAt` is set, Pigeons holds the email in "scheduled" status
    and delivers it at the specified time. You can cancel a scheduled email
    with `pigeons.emails.cancel(id)` any time before delivery.

    Use this for reminder emails, trial-expiry notices, or any email that
    should go out at a specific time rather than immediately.
    """
    try:
        # scheduledAt expects an ISO 8601 string.
        # The datetime from Pydantic is already parsed; we convert back to
        # ISO format for the Pigeons API.
        email = pigeons.emails.send({
            "to": body.email,
            "subject": body.subject,
            "html": body.html,
            "scheduledAt": body.scheduled_at.isoformat(),
            "tags": ["scheduled"],
        })

        return ScheduleResponse(
            email_id=email["id"],
            scheduled_at=email.get("scheduledAt", body.scheduled_at.isoformat()),
            status=email["status"],
            message="Email scheduled for future delivery.",
        )

    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except NotFoundError as exc:
        # NotFoundError can occur if the from-address domain isn't verified.
        raise HTTPException(status_code=404, detail=str(exc))
    except PigeonsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
