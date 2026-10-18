# Pigeons

Open source, self-hosted email infrastructure for developers and AI agents.

Send transactional email, receive inbound mail into agent inboxes, run campaigns and sequences, manage contacts and templates. All from one Docker container on your own infrastructure.

[Docs](https://pigeons.dev/docs) | [Examples](examples/) | [TypeScript SDK](https://github.com/pigeons-dev/pigeons-sdks) | [Python SDK](https://github.com/pigeons-dev/pigeons-sdks/tree/main/packages/python)

## Quick Start

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

On first run, Pigeons prints your API key to stdout. Save it.

## Send Your First Email

### TypeScript SDK

```bash
npm install @pigeons/pigeons-ts
```

```typescript
import { Pigeons } from '@pigeons/pigeons-ts'

const pigeons = new Pigeons({
  baseUrl: 'http://localhost:3891',
  apiKey: 'pgn_...',
})

await pigeons.emails.send({
  to: 'user@example.com',
  subject: 'Welcome aboard',
  html: '<h1>Welcome!</h1>',
})
```

### Python SDK

```bash
pip install pigeons-py
```

```python
from pigeons import Pigeons

pigeons = Pigeons(
    base_url="http://localhost:3891",
    api_key="pgn_...",
)

email = pigeons.emails.send(
    to="user@example.com",
    subject="Welcome aboard",
    html="<h1>Welcome!</h1>",
)
```

### CLI

```bash
npx @pigeons/cli login --url http://localhost:3891
npx @pigeons/cli send --to user@example.com --subject "Hello" --html "<h1>Hi</h1>"
```

### curl

```bash
curl -X POST http://localhost:3891/v1/emails \
  -H "x-api-key: pgn_..." \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "subject": "Hello", "html": "<h1>Hi</h1>"}'
```

## Features

**Transactional email** - send via API or SDK with delivery tracking, bounce/complaint handling, and open tracking.

**Agent inboxes** - give your AI agents their own email address. Inbound mail is parsed, threaded, and delivered to your app via webhooks.

**Campaigns** - import contacts, segment by tags, send one-off campaigns with unsubscribe handling.

**Sequences** - multi-step drip sequences with delays, conditions, and per-topic subscription management.

**Templates** - create reusable email templates with variable interpolation. Preview and test before sending.

**Contacts** - manage contacts with tags and custom fields. Import in bulk, query by tag.

**Webhooks** - receive real-time events for delivery, bounce, complaint, open, inbound, and more.

**Domains** - add sending domains, verify DNS (DKIM, SPF, DMARC), track deliverability stats.

**MCP server** - connect AI agents (Claude, GPT, etc.) to Pigeons. Agents can send email, read inboxes, manage contacts, and run campaigns through natural language.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PIGEONS_AWS_ACCESS_KEY_ID` | Yes | | AWS access key |
| `PIGEONS_AWS_SECRET_ACCESS_KEY` | Yes | | AWS secret key |
| `PIGEONS_AWS_REGION` | Yes | | AWS region (e.g., `us-east-1`) |
| `PIGEONS_FROM_EMAIL` | Yes | | Default sender email |
| `PIGEONS_PORT` | No | `3891` | Server port |
| `PIGEONS_DATABASE_URL` | No | SQLite | LibSQL/Turso connection string |
| `PIGEONS_API_KEY` | No | Auto-generated | Pre-set API key |
| `PIGEONS_CONFIGURATION_SET` | No | | SES configuration set name for event tracking |
| `PIGEONS_OPEN_TRACKING` | No | `false` | Enable email open tracking |
| `PIGEONS_INBOUND_S3_BUCKET` | No | | S3 bucket for inbound email storage |

Full configuration reference: [Self-Hosting docs](https://pigeons.dev/docs/self-hosting)

## Examples

Ready-to-run examples covering every feature:

| Example | Description |
|---|---|
| [with-typescript](examples/with-typescript/) | Send, check status, list emails |
| [with-python](examples/with-python/) | Same flow in Python |
| [with-curl](examples/with-curl/) | Raw HTTP calls |
| [nextjs-authentication-emails](examples/nextjs-authentication-emails/) | Welcome, verification, password reset, magic link |
| [express-order-emails](examples/express-order-emails/) | Order confirmation, shipping, invoice with idempotency |
| [ai-support-agent](examples/ai-support-agent/) | LLM reads inbound emails and sends autonomous replies |
| [mcp-claude-agent](examples/mcp-claude-agent/) | Claude Desktop/Code MCP configuration |
| [campaign-send](examples/campaign-send/) | Import contacts, segment, send campaign |
| [drip-sequence](examples/drip-sequence/) | Multi-step onboarding sequence |
| [nextjs-saas-complete](examples/nextjs-saas-complete/) | Full reference app with auth, campaigns, webhooks |

[See all examples](examples/)

## Packages

| Package | Description | License |
|---|---|---|
| [`@pigeons/core`](packages/core) | API server | Apache 2.0 |
| [`@pigeons/cli`](packages/cli) | CLI tool | MIT |
| [`@pigeons/mcp`](packages/mcp) | MCP server for AI agents | MIT |

SDKs live in the [pigeons-sdks](https://github.com/pigeons-dev/pigeons-sdks) repo:

| Package | Description | License |
|---|---|---|
| [`@pigeons/pigeons-ts`](https://github.com/pigeons-dev/pigeons-sdks/tree/main/packages/typescript) | TypeScript SDK | MIT |
| [`pigeons-py`](https://github.com/pigeons-dev/pigeons-sdks/tree/main/packages/python) | Python SDK | MIT |

## Development

```bash
git clone https://github.com/pigeons-dev/pigeons.git
cd pigeons
pnpm install
pnpm build
pnpm dev        # start dev server with hot reload
pnpm test       # run unit tests
pnpm typecheck  # type check all packages
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

Core server is [Apache 2.0](LICENSE). CLI and MCP server are MIT.
