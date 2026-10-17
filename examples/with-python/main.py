"""
Pigeons Quick Start — Python

Demonstrates the three most common operations:
  1. Send a transactional email
  2. Check delivery status by ID
  3. List recent emails with filters

Run: python main.py
"""

import time

from pigeons import Pigeons

# Initialize the client.
# Reads PIGEONS_URL and PIGEONS_API_KEY from environment variables,
# or pass them explicitly: Pigeons(base_url="...", api_key="...")
pigeons = Pigeons()

# ── 1. Send an email ────────────────────────────────────────────────────────
# The SDK returns the full email object immediately. The email is queued
# for delivery — status will be "queued" until the background worker
# picks it up and hands it to SES.

print("Sending email...\n")

email = pigeons.emails.send({
    "to": "recipient@example.com",
    "subject": "Hello from Pigeons",
    "html": "<h1>Welcome!</h1><p>Your Pigeons instance is working.</p>",
    "text": "Welcome! Your Pigeons instance is working.",
})

print(f"  Email sent!")
print(f"  ID:     {email['id']}")
print(f"  Status: {email['status']}")
print(f"  To:     {', '.join(email['to'])}\n")

# ── 2. Check delivery status ────────────────────────────────────────────────
# Poll the email by ID to see its current status. In production you'd
# use webhooks instead of polling — see the webhook-event-handler example.

print("Checking delivery status...\n")

# Wait a moment for the background worker to process the job
time.sleep(3)

updated = pigeons.emails.get(email["id"])

print(f"  Current status: {updated['status']}")
if updated.get("sesMessageId"):
    print(f"  SES Message ID: {updated['sesMessageId']}")
print()

# ── 3. List recent emails ───────────────────────────────────────────────────
# Fetch the most recent emails, optionally filtering by status.
# The response includes cursor-based pagination.

print("Listing recent emails...\n")

result = pigeons.emails.list({"limit": 5})

for e in result["data"]:
    print(f"  {e['id']}  {e['status']:<10}  {e['subject']}")

if result["has_more"]:
    print(f"\n  More emails available (cursor: {result['next_cursor']})")

print("\nDone!")
