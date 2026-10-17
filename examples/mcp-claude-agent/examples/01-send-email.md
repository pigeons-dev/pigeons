# Send a Welcome Email

Example conversation showing how an AI agent sends a transactional email through Pigeons.

---

**You:** Send a welcome email to alice@example.com. Her name is Alice Chen and she just signed up for the Pro plan.

**Claude:** I'll send a welcome email to Alice right away.

_Uses tool: `send_email`_

```json
{
  "to": "alice@example.com",
  "subject": "Welcome to Pro, Alice!",
  "html": "<h1>Welcome aboard, Alice!</h1><p>Thanks for signing up for the Pro plan. You now have access to:</p><ul><li>Unlimited email sends</li><li>Priority delivery</li><li>Advanced analytics</li></ul><p>If you have any questions, just reply to this email.</p><p>Cheers,<br>The Team</p>",
  "text": "Welcome aboard, Alice!\n\nThanks for signing up for the Pro plan. You now have access to:\n- Unlimited email sends\n- Priority delivery\n- Advanced analytics\n\nIf you have any questions, just reply to this email.\n\nCheers,\nThe Team",
  "tags": ["welcome", "pro-plan"]
}
```

_Response:_

```json
{
  "id": "msg_a1b2c3d4",
  "to": ["alice@example.com"],
  "subject": "Welcome to Pro, Alice!",
  "status": "queued",
  "tags": ["welcome", "pro-plan"],
  "createdAt": "2025-01-15T10:30:00Z"
}
```

The welcome email is queued and will be delivered shortly. I sent it to alice@example.com with a summary of her Pro plan features. The email ID is `msg_a1b2c3d4` if you want to check on its delivery status later.

---

**You:** Did it deliver?

**Claude:** Let me check the delivery status.

_Uses tool: `get_email`_

```json
{
  "emailId": "msg_a1b2c3d4"
}
```

_Response:_

```json
{
  "id": "msg_a1b2c3d4",
  "to": ["alice@example.com"],
  "subject": "Welcome to Pro, Alice!",
  "status": "delivered",
  "tags": ["welcome", "pro-plan"],
  "sentAt": "2025-01-15T10:30:02Z",
  "deliveredAt": "2025-01-15T10:30:04Z"
}
```

Yes, it delivered successfully. The email was sent at 10:30:02 and confirmed delivered to alice@example.com two seconds later at 10:30:04.

---

## Tools used

| Tool | Purpose |
|------|---------|
| `send_email` | Queue a transactional email for delivery |
| `get_email` | Check delivery status by email ID |
