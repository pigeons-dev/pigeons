# MCP Claude Agent

Configure Pigeons as an MCP server for Claude Desktop and Claude Code, giving your AI agent full email infrastructure: send, receive, reply, run campaigns, and manage contacts through natural conversation.

## What you'll learn

- How to configure the `@pigeons/mcp` server for Claude Desktop and Claude Code
- The full set of 29 MCP tools available to the agent
- Practical workflows: sending email, managing inboxes, replying to threads, running campaigns, and monitoring deliverability

## Prerequisites

- A running Pigeons instance (local or Docker)
- An API key with the scopes your workflow needs
- [Claude Desktop](https://claude.ai/download) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- `npx` (comes with Node.js 18+)

## Setup for Claude Desktop

1. Open Claude Desktop settings (gear icon or `Cmd+,` / `Ctrl+,`)
2. Go to **Developer > Edit Config**
3. This opens `claude_desktop_config.json`. Add the Pigeons server:

```json
{
  "mcpServers": {
    "pigeons": {
      "command": "npx",
      "args": [
        "@pigeons/mcp",
        "--url",
        "http://localhost:3891",
        "--api-key",
        "pgn_your_api_key_here"
      ]
    }
  }
}
```

4. Save and restart Claude Desktop
5. You should see "pigeons" in the MCP tools list (hammer icon)

See [claude-desktop-config.json](./claude-desktop-config.json) for the full config file.

## Setup for Claude Code

1. Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "pigeons": {
      "command": "npx",
      "args": ["@pigeons/mcp"],
      "env": {
        "PIGEONS_URL": "http://localhost:3891",
        "PIGEONS_API_KEY": "pgn_your_api_key_here"
      }
    }
  }
}
```

2. Start Claude Code in that directory. It will auto-detect the MCP server.

See [claude-code-config.json](./claude-code-config.json) for the full config file.

> **Tip:** Claude Code uses environment variables instead of CLI flags. You can also set `PIGEONS_URL` and `PIGEONS_API_KEY` in your shell environment and omit the `env` block.

## Available tools

### Email

| Tool | Description |
|------|-------------|
| `send_email` | Send a transactional email with HTML/text body or a template |
| `get_email` | Get email details and delivery status by ID |
| `list_emails` | List sent emails with optional status and tag filtering |

### Inboxes

| Tool | Description |
|------|-------------|
| `create_inbox` | Create an agent inbox with a real email address |
| `list_inboxes` | List all agent inboxes |
| `get_inbox_messages` | Get messages for an inbox, optionally filtered by thread or direction |
| `get_thread` | Get a full conversation thread with all messages |
| `reply_to_message` | Send a reply from an inbox, maintaining the thread |
| `update_thread_status` | Update thread status (open, closed, snoozed) |

### Contacts

| Tool | Description |
|------|-------------|
| `create_contact` | Create or update a contact (upserts on email address) |
| `search_contacts` | List contacts with tag, email, or subscription filtering |
| `update_contact` | Update a contact's properties, tags, or name |

### Templates

| Tool | Description |
|------|-------------|
| `list_templates` | List available email templates |
| `preview_template` | Render a template with sample data and return HTML output |

### Campaigns

| Tool | Description |
|------|-------------|
| `create_campaign` | Create a draft email campaign with audience targeting |
| `list_campaigns` | List campaigns with optional status filter |
| `get_campaign` | Get campaign details and statistics |
| `send_campaign` | Send or schedule a campaign |
| `cancel_campaign` | Cancel a sending or scheduled campaign |

### Sequences

| Tool | Description |
|------|-------------|
| `create_sequence` | Create a multi-step email sequence |
| `list_sequences` | List email sequences |
| `get_sequence` | Get sequence details with steps and stats |
| `activate_sequence` | Activate a draft or paused sequence |
| `pause_sequence` | Pause an active sequence |
| `enroll_in_sequence` | Enroll a contact in an active sequence |

### Topics

| Tool | Description |
|------|-------------|
| `create_topic` | Create a subscription topic for per-topic unsubscribe |
| `list_topics` | List subscription topics |
| `get_topic` | Get topic details |
| `delete_topic` | Delete a subscription topic |

### Resources

The MCP server also exposes three read-only resources that Claude can access for context:

| Resource URI | Description |
|-------------|-------------|
| `pigeons://inboxes` | All agent inboxes and their email addresses |
| `pigeons://templates` | Available templates with slugs and variable schemas |
| `pigeons://domains` | Verified sending domains, authentication status, and delivery stats |

## Example conversations

Each example reads like a natural conversation between a human and Claude, showing the exact tool calls the agent makes.

### [01  - Send a welcome email](./examples/01-send-email.md)

Send a transactional email to a new user and check delivery status. Demonstrates `send_email` and `get_email`.

### [02  - Manage an inbox](./examples/02-manage-inbox.md)

Create an agent inbox, list incoming messages, and view a conversation thread. Demonstrates `create_inbox`, `get_inbox_messages`, and `get_thread`.

### [03  - Reply to a thread](./examples/03-reply-to-thread.md)

Read an inbound support question, compose a helpful reply, and close the thread. Demonstrates `get_inbox_messages`, `reply_to_message`, and `update_thread_status`.

### [04  - Campaign workflow](./examples/04-campaign-workflow.md)

Create contacts, build a targeted campaign, and schedule it. Demonstrates `create_contact`, `create_campaign`, `send_campaign`, and `list_campaigns`.

### [05  - Check deliverability](./examples/05-check-deliverability.md)

Check domain authentication, delivery rates, and bounce/complaint health. Demonstrates the `pigeons://domains` resource and `list_emails`.

## Next steps

- [ai-support-agent](../ai-support-agent/)  - Build an autonomous support agent that triages and responds to email
- [ai-outreach-agent](../ai-outreach-agent/)  - Build an outreach agent that personalizes campaigns per recipient
- [langchain-email-tools](../langchain-email-tools/)  - Use Pigeons as a LangChain tool for multi-agent workflows
