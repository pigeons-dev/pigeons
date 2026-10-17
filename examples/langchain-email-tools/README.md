# LangChain Email Tools

Wrap Pigeons as LangChain tools so any LLM agent can send, receive, and manage email through natural language.

## What you'll learn

- Define LangChain tools that wrap the Pigeons Python SDK
- Build a ReAct agent that can send emails, check delivery status, and manage contacts
- Import the tools into your own agent projects

## Prerequisites

- Python 3.10+
- A running Pigeons instance (local or Docker)
- A Pigeons API key
- An Anthropic API key

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` with your credentials:

```
PIGEONS_URL=http://localhost:3891
PIGEONS_API_KEY=pgn_...
ANTHROPIC_API_KEY=sk-ant-...
```

## Run

```bash
python main.py
```

The demo agent processes three example prompts:

1. Sends a welcome email to `user@example.com`
2. Checks the delivery status of a specific email
3. Lists all contacts tagged "vip"

## Available tools

| Tool | Description | Key args |
|---|---|---|
| `send_email` | Send a transactional email | `to`, `subject`, `html`, `text` |
| `list_emails` | List recent emails with optional filters | `status`, `limit` |
| `get_email_status` | Check delivery status by email ID | `email_id` |
| `list_inbox_messages` | List messages in an inbox | `inbox_id` |
| `reply_to_message` | Send a threaded reply from an inbox | `inbox_id`, `to`, `subject`, `text`, `in_reply_to` |
| `create_contact` | Add a contact to your list | `email`, `first_name`, `last_name`, `tags` |
| `list_contacts` | List contacts, optionally filtered by tag | `tag` |

## Example agent prompts

```
Send a confirmation email to alice@example.com with the order number #1234.
What's the status of email msg_abc123?
List all delivered emails from the last batch.
Show me the latest messages in inbox inb_support.
Reply to message inm_xyz in inbox inb_support saying we're looking into it.
Create a contact for bob@example.com tagged as 'enterprise' and 'trial'.
List all contacts tagged 'newsletter'.
```

## How to add to your own agent

Import the tool list and pass it to any LangChain-compatible agent:

```python
from tools import pigeons_tools

# With LangGraph ReAct agent:
from langgraph.prebuilt import create_react_agent

agent = create_react_agent(llm, pigeons_tools)

# Or import individual tools:
from tools import send_email, list_contacts

agent = create_react_agent(llm, [send_email, list_contacts])
```

The tools work with any LangChain-compatible LLM, not just Anthropic. Swap `ChatAnthropic` for `ChatOpenAI`, `ChatGoogleGenerativeAI`, or any other provider.

## Next steps

- [with-python](../with-python/) -- Pigeons Python SDK basics
- [fastapi-notifications](../fastapi-notifications/) -- Build a notification service with FastAPI
- [mcp-claude-agent](../mcp-claude-agent/) -- Use Pigeons as an MCP server with Claude
