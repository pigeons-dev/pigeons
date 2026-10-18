# Pigeons Examples

Runnable examples covering every feature of Pigeons  - from sending your first email to building an autonomous AI support agent.

Each example is a self-contained project. Pick one, set your `.env`, and run it.

## Prerequisites

All examples assume a running Pigeons instance. The fastest way to get one:

```bash
docker run -d \
  -e PIGEONS_AWS_ACCESS_KEY_ID=... \
  -e PIGEONS_AWS_SECRET_ACCESS_KEY=... \
  -e PIGEONS_AWS_REGION=us-east-1 \
  -e PIGEONS_FROM_EMAIL=hi@yourapp.com \
  -v pigeons-data:/app/packages/core/data \
  -p 3891:3891 \
  ghcr.io/pigeons-dev/pigeons:latest
```

Or run locally from source:

```bash
cd packages/core && pnpm dev
```

## Quick Starts

| Example | Stack | Description |
|---|---|---|
| [with-typescript](with-typescript/) | TypeScript | Send an email, check delivery status, list emails |
| [with-python](with-python/) | Python | Same flow in Python |
| [with-curl](with-curl/) | Shell | Raw HTTP calls  - language-agnostic reference |

## Transactional Email

| Example | Stack | Description |
|---|---|---|
| [nextjs-authentication-emails](nextjs-authentication-emails/) | Next.js | Welcome, email verification, password reset, magic link |
| [express-order-emails](express-order-emails/) | Express | Order confirmation, shipping update, invoice  - with idempotency |
| [fastapi-notifications](fastapi-notifications/) | FastAPI | Signup notification, activity digest, system alert  - scheduling and batch send |

## Templates

| Example | Stack | Description |
|---|---|---|
| [email-templates](email-templates/) | TypeScript | Template library including Stripe-style welcome  - create, preview, send with variables |

## Inbound Email & Agent Inboxes

| Example | Stack | Description |
|---|---|---|
| [inbound-webhook-handler](inbound-webhook-handler/) | Express | Receive inbound emails via webhook, parse, auto-reply |
| [helpdesk-inbox](helpdesk-inbox/) | FastAPI | Multi-inbox routing, auto-label, thread management |
| [ai-support-agent](ai-support-agent/) | Python | LLM reads inbound emails and sends autonomous replies |

## AI / MCP Agent

| Example | Stack | Description |
|---|---|---|
| [mcp-claude-agent](mcp-claude-agent/) | MCP config | Claude Desktop/Code config with example conversations |
| [ai-outreach-agent](ai-outreach-agent/) | Python | LLM-personalized outreach with drip sequences |
| [langchain-email-tools](langchain-email-tools/) | Python + LangChain | Pigeons as LangChain tools for any agent framework |

## Marketing & Campaigns

| Example | Stack | Description |
|---|---|---|
| [campaign-send](campaign-send/) | TypeScript | Import contacts, segment, create campaign, send, monitor |
| [drip-sequence](drip-sequence/) | TypeScript | 3-step onboarding sequence with enrollment and monitoring |
| [subscription-topics](subscription-topics/) | TypeScript | Per-topic unsubscribe  - marketing vs product updates vs changelog |

## Webhooks & Monitoring

| Example | Stack | Description |
|---|---|---|
| [webhook-event-handler](webhook-event-handler/) | Express | Handle delivery, bounce, complaint, open events |
| [delivery-monitor](delivery-monitor/) | TypeScript | Poll stats API, track warmup phase, flag high bounce rates |

## Full-Stack Reference

| Example | Stack | Description |
|---|---|---|
| [nextjs-saas-complete](nextjs-saas-complete/) | Next.js | Complete reference app  - auth emails, campaigns, webhooks, unsubscribe page, stats |
