"""
Pigeons email tools for LangChain agents.

Wraps the Pigeons Python SDK as LangChain tools so any agent framework
can send, receive, and manage email.

Usage:
    from tools import pigeons_tools

    # Pass to any LangChain agent:
    agent = create_react_agent(llm, pigeons_tools)
"""

from __future__ import annotations

import json
import os
from typing import Optional

from langchain_core.tools import tool
from pigeons import Pigeons

# Initialize the Pigeons client once, reused across all tool calls.
# Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables.
_client = Pigeons()


# ── Outbound email tools ───────────────────────────────────────────────────


@tool
def send_email(
    to: str,
    subject: str,
    html: Optional[str] = None,
    text: Optional[str] = None,
) -> str:
    """Send an email through Pigeons.

    Use this to send transactional or notification emails.
    You must provide at least one of html or text body content.

    Args:
        to: Recipient email address.
        subject: Email subject line.
        html: HTML body content. Optional if text is provided.
        text: Plain-text body content. Optional if html is provided.

    Returns:
        The email ID and its delivery status.
    """
    params: dict = {"to": to, "subject": subject}
    if html:
        params["html"] = html
    if text:
        params["text"] = text

    email = _client.emails.send(params)
    return json.dumps({
        "id": email["id"],
        "status": email["status"],
        "to": email["to"],
        "subject": email["subject"],
    })


@tool
def list_emails(
    status: Optional[str] = None,
    limit: Optional[int] = None,
) -> str:
    """List recent emails sent through Pigeons.

    Use this to check what emails have been sent and their delivery status.
    Optionally filter by status: queued, sending, sent, delivered, bounced,
    complained, or failed.

    Args:
        status: Filter by delivery status. Optional.
        limit: Maximum number of emails to return (default 20). Optional.

    Returns:
        A list of emails with their IDs, subjects, and statuses.
    """
    params: dict = {}
    if status:
        params["status"] = status
    if limit:
        params["limit"] = limit

    result = _client.emails.list(params)
    emails = [
        {
            "id": e["id"],
            "subject": e["subject"],
            "status": e["status"],
            "to": e["to"],
            "created_at": e["createdAt"],
        }
        for e in result["data"]
    ]
    return json.dumps({"emails": emails, "has_more": result["has_more"]})


@tool
def get_email_status(email_id: str) -> str:
    """Check the delivery status of a specific email.

    Use this to look up whether an email was delivered, bounced, or is
    still queued.

    Args:
        email_id: The email ID (starts with msg_).

    Returns:
        The email's current status and metadata.
    """
    email = _client.emails.get(email_id)
    return json.dumps({
        "id": email["id"],
        "status": email["status"],
        "to": email["to"],
        "subject": email["subject"],
        "ses_message_id": email.get("sesMessageId"),
        "created_at": email["createdAt"],
        "updated_at": email["updatedAt"],
    })


# ── Inbox tools ────────────────────────────────────────────────────────────


@tool
def list_inbox_messages(inbox_id: str) -> str:
    """List messages in a Pigeons inbox.

    Use this to read incoming emails or see the conversation history
    for a specific inbox.

    Args:
        inbox_id: The inbox ID (starts with inb_).

    Returns:
        A list of messages with sender, subject, and content.
    """
    result = _client.inboxes.messages.list(inbox_id)
    messages = [
        {
            "id": m["id"],
            "direction": m["direction"],
            "from": m["from"],
            "to": m["to"],
            "subject": m["subject"],
            "text": m.get("extractedText") or m.get("text"),
            "thread_id": m["threadId"],
            "created_at": m["createdAt"],
        }
        for m in result["data"]
    ]
    return json.dumps({"messages": messages, "has_more": result["has_more"]})


@tool
def reply_to_message(
    inbox_id: str,
    to: str,
    subject: str,
    text: str,
    in_reply_to: Optional[str] = None,
) -> str:
    """Send a reply from a Pigeons inbox.

    Use this to respond to an incoming email. If you provide in_reply_to,
    the reply will be threaded with the original message.

    Args:
        inbox_id: The inbox ID to send from (starts with inb_).
        to: Recipient email address.
        subject: Email subject line.
        text: Plain-text body of the reply.
        in_reply_to: Message ID to reply to for threading. Optional.

    Returns:
        The sent message ID and thread ID.
    """
    params: dict = {"to": to, "subject": subject, "text": text}
    if in_reply_to:
        params["inReplyTo"] = in_reply_to

    message = _client.inboxes.messages.create(inbox_id, params)
    return json.dumps({
        "id": message["id"],
        "thread_id": message["threadId"],
        "direction": message["direction"],
        "subject": message["subject"],
    })


# ── Contact tools ──────────────────────────────────────────────────────────


@tool
def create_contact(
    email: str,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    tags: Optional[list[str]] = None,
) -> str:
    """Create a new contact in Pigeons.

    Use this to add a person to your contact list so you can send them
    emails later or track their engagement.

    Args:
        email: The contact's email address.
        first_name: First name. Optional.
        last_name: Last name. Optional.
        tags: List of tags for segmentation (e.g. ["vip", "beta"]). Optional.

    Returns:
        The created contact's ID and details.
    """
    params: dict = {"email": email}
    if first_name:
        params["firstName"] = first_name
    if last_name:
        params["lastName"] = last_name
    if tags:
        params["tags"] = tags

    contact = _client.contacts.create(params)
    return json.dumps({
        "id": contact["id"],
        "email": contact["email"],
        "first_name": contact.get("firstName"),
        "last_name": contact.get("lastName"),
        "tags": contact.get("tags", []),
    })


@tool
def list_contacts(tag: Optional[str] = None) -> str:
    """List contacts in Pigeons, optionally filtered by tag.

    Use this to look up contacts or find all contacts with a specific tag
    like 'vip' or 'newsletter'.

    Args:
        tag: Filter contacts by this tag. Optional.

    Returns:
        A list of contacts with their email, name, and tags.
    """
    params: dict = {}
    if tag:
        params["tag"] = tag

    result = _client.contacts.list(params)
    contacts = [
        {
            "id": c["id"],
            "email": c["email"],
            "first_name": c.get("firstName"),
            "last_name": c.get("lastName"),
            "tags": c.get("tags", []),
            "unsubscribed": c["unsubscribed"],
        }
        for c in result["data"]
    ]
    return json.dumps({"contacts": contacts, "has_more": result["has_more"]})


# ── Exported tool list ─────────────────────────────────────────────────────

pigeons_tools: list = [
    send_email,
    list_emails,
    get_email_status,
    list_inbox_messages,
    reply_to_message,
    create_contact,
    list_contacts,
]
