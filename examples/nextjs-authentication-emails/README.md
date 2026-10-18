# Next.js Authentication Emails

Send authentication emails (welcome, verification, password reset, magic link) from Next.js API routes using the Pigeons TypeScript SDK.

## What you'll learn

- Initialize the Pigeons client as a singleton for use across API routes
- Send transactional emails using templates and template variables
- Send emails with inline HTML and plain text fallbacks
- Tag emails for filtering and analytics
- Structure authentication email flows in Next.js App Router

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key with `emails:send` scope
- (Optional) Pre-created templates with slugs `welcome` and `password-reset`

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` with your instance URL and API key:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
```

### Create templates (optional)

The signup and forgot-password routes use templates. Create them in your Pigeons instance:

**welcome** template:
```json
{
  "slug": "welcome",
  "name": "Welcome Email",
  "subject": "Welcome to YourApp, {{name}}!",
  "body": "<h2>Welcome, {{name}}!</h2><p>Your account is ready. <a href=\"{{loginUrl}}\">Log in now</a>.</p>"
}
```

**password-reset** template:
```json
{
  "slug": "password-reset",
  "name": "Password Reset",
  "subject": "Reset your password",
  "body": "<h2>Hi {{name}},</h2><p>Click below to reset your password:</p><p><a href=\"{{resetUrl}}\">Reset password</a></p><p>This link expires in {{expiresIn}}.</p>"
}
```

You can create these via the SDK, CLI, or API:

```bash
curl -X POST http://localhost:3891/v1/templates \
  -H "x-api-key: pgn_..." \
  -H "Content-Type: application/json" \
  -d '{"slug": "welcome", "name": "Welcome Email", "subject": "Welcome, {{name}}!", "body": "<h2>Welcome, {{name}}!</h2>"}'
```

## Run

```bash
npm run dev
```

The app starts at `http://localhost:3000`. Hit the API routes with curl:

```bash
# Welcome email after signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice"}'

# Email verification with token
curl -X POST http://localhost:3000/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice", "token": "abc123"}'

# Password reset
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice"}'

# Magic link login
curl -X POST http://localhost:3000/api/auth/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

Each response includes the email ID and initial status:

```json
{
  "message": "Welcome email sent",
  "emailId": "msg_abc123",
  "status": "queued"
}
```

## Code walkthrough

### Client initialization (`src/lib/pigeons.ts`)

Creates a singleton `Pigeons` client that reads `PIGEONS_URL` and `PIGEONS_API_KEY` from environment variables. The client is imported by each API route. The SDK handles auth headers (`x-api-key`) automatically.

### Signup route (`src/app/api/auth/signup/route.ts`)

Sends a welcome email using the `welcome` template. Passes the user's name and a login URL as template variables via the `data` field. Tags the email with `auth` and `signup` for filtering.

### Verify email route (`src/app/api/auth/verify-email/route.ts`)

Sends a verification email with inline HTML and a plain text fallback. Embeds the verification token in a URL. In production, generate a secure token and store it with an expiry.

### Forgot password route (`src/app/api/auth/forgot-password/route.ts`)

Sends a password reset email using the `password-reset` template. Passes a reset URL with a dummy token and an expiry string as template variables. Includes security notes about enumeration prevention and rate limiting.

### Magic link route (`src/app/api/auth/magic-link/route.ts`)

Sends a passwordless login link with inline HTML. The magic link contains a one-time token. In production, bind the token to the requesting session and set a short expiry (10 minutes).

## Next steps

- [with-typescript](../with-typescript/)  - Basic SDK usage: send, get, list
- [email-templates](../email-templates/)  - Build templates with React Email
- [with-curl](../with-curl/)  - Raw HTTP calls for any language
