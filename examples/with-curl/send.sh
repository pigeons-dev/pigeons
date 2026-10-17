#!/usr/bin/env bash
#
# Pigeons Quick Start — curl
#
# Demonstrates the three most common API calls using curl:
#   1. Send a transactional email
#   2. Check delivery status by ID
#   3. List recent emails
#
# Usage: ./send.sh
# Requires: PIGEONS_URL and PIGEONS_API_KEY environment variables

set -euo pipefail

# ── Load environment ─────────────────────────────────────────────────────────
# Source .env file if it exists (for local development)
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

: "${PIGEONS_URL:?Set PIGEONS_URL to your Pigeons instance URL}"
: "${PIGEONS_API_KEY:?Set PIGEONS_API_KEY to your API key}"

BASE="${PIGEONS_URL}/v1"

# ── 1. Send an email ────────────────────────────────────────────────────────
# POST /v1/emails
# Auth via x-api-key header. Returns the email object with status "queued".

echo "Sending email..."
echo

RESPONSE=$(curl -s -X POST "${BASE}/emails" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${PIGEONS_API_KEY}" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Hello from Pigeons",
    "html": "<h1>Welcome!</h1><p>Your Pigeons instance is working.</p>",
    "text": "Welcome! Your Pigeons instance is working."
  }')

EMAIL_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
STATUS=$(echo "$RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "  Email sent!"
echo "  ID:     ${EMAIL_ID}"
echo "  Status: ${STATUS}"
echo

# ── 2. Check delivery status ────────────────────────────────────────────────
# GET /v1/emails/:id
# Poll to see the current delivery status.

echo "Waiting 3 seconds for delivery..."
sleep 3

echo "Checking delivery status..."
echo

UPDATED=$(curl -s "${BASE}/emails/${EMAIL_ID}" \
  -H "x-api-key: ${PIGEONS_API_KEY}")

CURRENT_STATUS=$(echo "$UPDATED" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  Current status: ${CURRENT_STATUS}"
echo

# ── 3. List recent emails ───────────────────────────────────────────────────
# GET /v1/emails?limit=5
# Returns a paginated list. Use cursor for next page.

echo "Listing recent emails..."
echo

curl -s "${BASE}/emails?limit=5" \
  -H "x-api-key: ${PIGEONS_API_KEY}" | python3 -m json.tool

echo
echo "Done!"
