# Pigeons

Open-source, self-hosted email infrastructure for developers and AI agents.

Transactional email, marketing email, and agent inboxes — unified under one platform, deployed on your own infrastructure.

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

### Using the SDK

```typescript
import { Pigeons } from '@pigeons/sdk'

const pigeons = new Pigeons({
  baseUrl: 'https://mail.yourapp.com',
  apiKey: 'pgn_...',
})

await pigeons.emails.send({
  to: 'user@example.com',
  subject: 'Welcome aboard',
  html: '<h1>Welcome!</h1>',
})
```

### Using the CLI

```bash
npx @pigeons/cli login --url https://mail.yourapp.com
npx @pigeons/cli send --to user@example.com --subject "Hello" --html "<h1>Hi</h1>"
```

### Using curl

```bash
curl -X POST https://mail.yourapp.com/api/v1/emails \
  -H "Authorization: Bearer pgn_..." \
  -H "Content-Type: application/json" \
  -d '{"to": "user@example.com", "subject": "Hello", "html": "<h1>Hi</h1>"}'
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PIGEONS_AWS_ACCESS_KEY_ID` | Yes | — | AWS access key |
| `PIGEONS_AWS_SECRET_ACCESS_KEY` | Yes | — | AWS secret key |
| `PIGEONS_AWS_REGION` | Yes | — | AWS region (e.g., `us-east-1`) |
| `PIGEONS_FROM_EMAIL` | Yes | — | Default sender email |
| `PIGEONS_PORT` | No | `3891` | Server port |
| `PIGEONS_DATABASE_URL` | No | SQLite | PostgreSQL connection string |
| `PIGEONS_API_KEY` | No | Auto-generated | Pre-set API key |

## Packages

| Package | Description |
|---|---|
| `@pigeons/core` | API server ([Apache 2.0](LICENSE)) |
| `@pigeons/cli` | CLI tool (MIT) |
| `@pigeons/mcp` | MCP server for AI agents (MIT) |
| [`@pigeons/sdk`](https://github.com/pigeons-dev/pigeons-sdks) | TypeScript SDK (MIT) |

## Development

```bash
pnpm install
pnpm build
pnpm dev  # starts the server with hot reload
```

## License

Apache 2.0 — see [LICENSE](LICENSE).
