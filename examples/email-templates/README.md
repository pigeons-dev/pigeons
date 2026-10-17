# Email Templates

A library of 6 production-quality React Email templates, demonstrating the full template lifecycle: create, preview, and send with variables.

Includes a **Stripe-style welcome email** — showing that any design you can build with React Email works out of the box as a Pigeons template.

## What you'll learn

- Create templates from React Email components via the API
- Preview templates with sample data (renders without sending)
- Send emails referencing a template slug with dynamic variables
- Build a reusable template library for your application

## Templates included

| Slug | Description | Variables |
|---|---|---|
| `stripe-welcome` | Polished Stripe-style welcome email | `companyName`, `dashboardUrl`, `docsUrl` |
| `welcome` | Minimal new-user welcome | `name`, `companyName`, `loginUrl` |
| `password-reset` | Password reset with time-limited link | `name`, `companyName`, `resetUrl`, `expiresIn` |
| `receipt` | Payment receipt with line items | `customerName`, `companyName`, `invoiceNumber`, `total`, `date`, ... |
| `notification` | Activity notification (comments, mentions) | `name`, `actorName`, `action`, `preview`, `actionUrl` |
| `team-invite` | Team/workspace collaboration invite | `inviterName`, `teamName`, `inviteUrl` |

## Prerequisites

- Node.js 20+
- A running Pigeons instance (local or Docker)
- An API key

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your instance URL and API key.

## Run

```bash
npx tsx src/index.ts
```

Expected output:

```
Creating templates...

  + stripe-welcome (tpl_abc123)
  + welcome (tpl_def456)
  + password-reset (tpl_ghi789)
  + receipt (tpl_jkl012)
  + notification (tpl_mno345)
  + team-invite (tpl_pqr678)

Previewing stripe-welcome template...

  Subject: You're now ready to go live with Pigeons!
  HTML:    2847 characters
  Text:    Thanks for submitting your account information...

Template library:

  stripe-welcome       v1  "You're now ready to go live with {{companyName}}!"
  welcome              v1  "Welcome to {{companyName}}, {{name}}!"
  password-reset       v1  "Reset your {{companyName}} password"
  receipt              v1  "Your receipt from {{companyName}} — {{invoiceNumber}}"
  notification         v1  "{{actorName}} {{action}}"
  team-invite          v1  "{{inviterName}} invited you to join {{teamName}}"

Sending email with receipt template...

  Sent! msg_xyz789 (status: queued)

Done!
```

## How Pigeons templates work

1. **Store once** — Create a template with a React Email component as the body. Pigeons stores it with a slug you can reference later.

2. **Render server-side** — When you send an email with `templateId`, the server renders the React component with your data. No React runtime needed in your app.

3. **Version tracked** — Each update increments the version number. You always know which version was used for a sent email.

4. **Any design works** — If you can build it with React Email components (Html, Button, Container, Section, Text, Link, Img, Hr, etc.), it works as a Pigeons template. The Stripe-style template in this example demonstrates production-quality design.

## Next steps

- [nextjs-authentication-emails](../nextjs-authentication-emails/) — Use these templates in a real Next.js auth flow
- [campaign-send](../campaign-send/) — Send a campaign using a template to a list of contacts
- [mcp-claude-agent](../mcp-claude-agent/) — Let an AI agent preview and send templates
