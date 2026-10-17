# Reply to a Thread

Example conversation showing how an AI agent reads an inbound message, composes a reply, and updates the thread status.

---

**You:** Check the support inbox for new messages and reply to anything you can handle.

**Claude:** Let me check for new messages.

_Uses tool: `get_inbox_messages`_

```json
{
  "inboxId": "inb_k9m2n4p6",
  "direction": "inbound",
  "limit": 5
}
```

_Response:_

```json
{
  "data": [
    {
      "id": "inm_d7e8f9",
      "threadId": "thr_g1h2i3",
      "from": "dana@startup.co",
      "subject": "How do I add a custom domain?",
      "textBody": "Hi there,\n\nI just signed up and want to send from my own domain (startup.co) instead of the shared one. What do I need to do?\n\nThanks,\nDana",
      "direction": "inbound",
      "receivedAt": "2025-01-15T14:20:00Z"
    }
  ],
  "pagination": {
    "hasMore": false
  }
}
```

There's one new message from Dana at startup.co asking about custom domain setup. This is a standard onboarding question I can answer. Let me send a reply.

_Uses tool: `reply_to_message`_

```json
{
  "inboxId": "inb_k9m2n4p6",
  "to": "dana@startup.co",
  "subject": "Re: How do I add a custom domain?",
  "inReplyTo": "inm_d7e8f9",
  "text": "Hi Dana,\n\nGreat question! Here's how to set up startup.co as your sending domain:\n\n1. Go to your dashboard and click Domains > Add Domain\n2. Enter \"startup.co\" as the domain name\n3. You'll get three DNS records to add:\n   - A DKIM record (TXT) for email signing\n   - An SPF record (TXT) to authorize sending\n   - An MX record if you want to receive email too\n4. Add these records at your DNS provider (Cloudflare, Route 53, etc.)\n5. Come back and click Verify — it usually takes a few minutes for DNS to propagate\n\nOnce verified, you can send from any address @startup.co.\n\nLet me know if you run into any issues with the DNS setup!\n\nBest,\nSupport",
  "html": "<p>Hi Dana,</p><p>Great question! Here's how to set up startup.co as your sending domain:</p><ol><li>Go to your dashboard and click <strong>Domains > Add Domain</strong></li><li>Enter \"startup.co\" as the domain name</li><li>You'll get three DNS records to add:<ul><li>A DKIM record (TXT) for email signing</li><li>An SPF record (TXT) to authorize sending</li><li>An MX record if you want to receive email too</li></ul></li><li>Add these records at your DNS provider (Cloudflare, Route 53, etc.)</li><li>Come back and click <strong>Verify</strong> — it usually takes a few minutes for DNS to propagate</li></ol><p>Once verified, you can send from any address @startup.co.</p><p>Let me know if you run into any issues with the DNS setup!</p><p>Best,<br>Support</p>"
}
```

_Response:_

```json
{
  "id": "inm_j4k5l6",
  "threadId": "thr_g1h2i3",
  "to": ["dana@startup.co"],
  "subject": "Re: How do I add a custom domain?",
  "direction": "outbound",
  "status": "queued",
  "createdAt": "2025-01-15T14:22:00Z"
}
```

Reply sent. Now I'll mark this thread as closed since the question is answered.

_Uses tool: `update_thread_status`_

```json
{
  "inboxId": "inb_k9m2n4p6",
  "threadId": "thr_g1h2i3",
  "status": "closed",
  "metadata": {
    "resolution": "answered",
    "category": "onboarding"
  }
}
```

_Response:_

```json
{
  "id": "thr_g1h2i3",
  "subject": "How do I add a custom domain?",
  "status": "closed",
  "messageCount": 2,
  "metadata": {
    "resolution": "answered",
    "category": "onboarding"
  }
}
```

Done. I replied to Dana with step-by-step instructions for adding a custom domain and closed the thread. If she follows up, the thread will reopen automatically with her new message.

---

## Tools used

| Tool | Purpose |
|------|---------|
| `get_inbox_messages` | Check for new inbound messages |
| `reply_to_message` | Send a reply in the same thread |
| `update_thread_status` | Close the thread after resolving |
