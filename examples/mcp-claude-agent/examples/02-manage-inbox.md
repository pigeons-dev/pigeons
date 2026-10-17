# Manage an Agent Inbox

Example conversation showing how an AI agent creates an inbox and reads incoming messages.

---

**You:** Set up a support inbox for our app. The domain is acme.dev.

**Claude:** I'll create a support inbox on your acme.dev domain.

_Uses tool: `create_inbox`_

```json
{
  "name": "support",
  "emailAddress": "support@acme.dev",
  "description": "Customer support inbox for Acme"
}
```

_Response:_

```json
{
  "id": "inb_k9m2n4p6",
  "name": "support",
  "emailAddress": "support@acme.dev",
  "description": "Customer support inbox for Acme",
  "status": "active",
  "createdAt": "2025-01-15T11:00:00Z"
}
```

Done. The support inbox is live at **support@acme.dev** (ID: `inb_k9m2n4p6`). Anyone who emails that address will have their messages routed here.

---

**You:** Are there any messages yet?

**Claude:** Let me check.

_Uses tool: `get_inbox_messages`_

```json
{
  "inboxId": "inb_k9m2n4p6",
  "limit": 10
}
```

_Response:_

```json
{
  "data": [
    {
      "id": "inm_x1y2z3",
      "threadId": "thr_q7w8e9",
      "from": "bob@gmail.com",
      "subject": "Can't reset my password",
      "textBody": "Hi, I've been trying to reset my password but the link expired. Can you help?",
      "direction": "inbound",
      "receivedAt": "2025-01-15T11:05:30Z"
    },
    {
      "id": "inm_a4b5c6",
      "threadId": "thr_r1t2u3",
      "from": "carol@company.io",
      "subject": "Billing question about annual plan",
      "textBody": "Hey, I was charged monthly instead of the annual rate. Order #4821. Can you look into this?",
      "direction": "inbound",
      "receivedAt": "2025-01-15T11:12:15Z"
    }
  ],
  "pagination": {
    "hasMore": false
  }
}
```

Two messages so far:

1. **Bob** (bob@gmail.com) -- Can't reset his password. The reset link expired.
2. **Carol** (carol@company.io) -- Billing question. She was charged monthly instead of the annual rate. References order #4821.

Both are in separate threads. Want me to respond to either of them?

---

**You:** Show me the full thread for Bob's issue.

**Claude:** _Uses tool: `get_thread`_

```json
{
  "inboxId": "inb_k9m2n4p6",
  "threadId": "thr_q7w8e9"
}
```

_Response:_

```json
{
  "id": "thr_q7w8e9",
  "subject": "Can't reset my password",
  "status": "open",
  "messageCount": 1,
  "messages": [
    {
      "id": "inm_x1y2z3",
      "from": "bob@gmail.com",
      "subject": "Can't reset my password",
      "textBody": "Hi, I've been trying to reset my password but the link expired. Can you help?",
      "direction": "inbound",
      "receivedAt": "2025-01-15T11:05:30Z"
    }
  ],
  "createdAt": "2025-01-15T11:05:30Z",
  "updatedAt": "2025-01-15T11:05:30Z"
}
```

Just the one message from Bob so far. The thread is open and waiting for a reply. The password reset link expired and he needs a new one. Want me to draft a response?

---

## Tools used

| Tool | Purpose |
|------|---------|
| `create_inbox` | Create an agent inbox with a real email address |
| `get_inbox_messages` | List messages received in the inbox |
| `get_thread` | View a full conversation thread |
