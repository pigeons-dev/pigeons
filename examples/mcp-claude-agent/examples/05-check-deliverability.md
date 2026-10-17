# Check Deliverability

Example conversation showing how an AI agent checks domain health and interprets delivery metrics. This example uses the `pigeons://domains` MCP resource rather than a tool call.

---

**You:** How's our email deliverability looking? We started sending from acme.dev last week.

**Claude:** Let me pull up your domain stats.

_Reads resource: `pigeons://domains`_

```json
{
  "data": [
    {
      "id": "dom_v1w2x3",
      "domain": "acme.dev",
      "status": "verified",
      "dkimStatus": "verified",
      "spfStatus": "verified",
      "dmarcStatus": "verified",
      "stats": {
        "totalSent": 342,
        "delivered": 331,
        "bounced": 8,
        "complained": 3,
        "deliveryRate": 96.8,
        "bounceRate": 2.3,
        "complaintRate": 0.9
      },
      "createdAt": "2025-01-08T10:00:00Z"
    }
  ]
}
```

Here's the rundown for **acme.dev** after one week of sending:

**Authentication:** All green. DKIM, SPF, and DMARC are all verified. This is the foundation for good deliverability.

**Volume:** 342 emails sent, 331 delivered.

**Delivery rates:**

| Metric | Value | Assessment |
|--------|-------|------------|
| Delivery rate | 96.8% | Good |
| Bounce rate | 2.3% | Needs attention |
| Complaint rate | 0.9% | Warning |

**Two things to watch:**

1. **Bounce rate (2.3%)** -- Above the 2% threshold that most providers consider healthy. You likely have some stale or invalid addresses in your list. I'd recommend cleaning your contact list and removing addresses that have hard-bounced.

2. **Complaint rate (0.9%)** -- This is close to the danger zone. AWS SES flags accounts above 0.1% and may suspend sending above 0.5%. At 0.9% you're well above that. You should:
   - Verify recipients have opted in to your emails
   - Add a clear unsubscribe link if missing
   - Consider a re-permission campaign for older contacts

The authentication setup is solid -- that's the hard part. The delivery issues are almost certainly about list quality, not infrastructure.

---

**You:** Can you find the contacts who bounced so I can clean them up?

**Claude:** Let me search for recently sent emails that bounced.

_Uses tool: `list_emails`_

```json
{
  "status": "bounced",
  "limit": 25
}
```

_Response:_

```json
{
  "data": [
    {
      "id": "msg_b1c2d3",
      "to": ["old-employee@partner.com"],
      "subject": "January Newsletter",
      "status": "bounced",
      "sentAt": "2025-01-12T15:00:00Z"
    },
    {
      "id": "msg_e4f5g6",
      "to": ["typo@gmial.com"],
      "subject": "Welcome to Acme",
      "status": "bounced",
      "sentAt": "2025-01-10T09:30:00Z"
    },
    {
      "id": "msg_h7i8j9",
      "to": ["noreply@defunct-startup.io"],
      "subject": "January Newsletter",
      "status": "bounced",
      "sentAt": "2025-01-12T15:00:00Z"
    }
  ],
  "pagination": {
    "hasMore": true
  }
}
```

Here are the first bounced addresses:

| Address | Likely cause |
|---------|-------------|
| old-employee@partner.com | Mailbox no longer exists |
| typo@gmial.com | Typo in domain (should be gmail.com) |
| noreply@defunct-startup.io | Domain is dead |

There are more -- should I page through all of them? Once we have the full list, I can update each contact to remove them from future sends, or you can do a bulk cleanup.

---

## Tools used

| Tool / Resource | Purpose |
|-----------------|---------|
| `pigeons://domains` resource | Read domain verification and delivery stats |
| `list_emails` | Find bounced emails to identify bad addresses |
