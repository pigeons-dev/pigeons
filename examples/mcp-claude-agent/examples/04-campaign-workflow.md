# Campaign Workflow

Example conversation showing how an AI agent creates contacts, builds a campaign, and sends it.

---

**You:** I need to send a product launch announcement to our beta testers. Here are the recipients:

- emma@example.com (Emma Liu)
- frank@example.com (Frank Russo)
- grace@example.com (Grace Kim)

The product is called "Relay" and it launches next Monday.

**Claude:** I'll set this up step by step: create the contacts, build the campaign, and send it. Let me start by adding the contacts.

_Uses tool: `create_contact`_

```json
{
  "email": "emma@example.com",
  "firstName": "Emma",
  "lastName": "Liu",
  "tags": ["beta-tester", "relay-launch"]
}
```

_Uses tool: `create_contact`_

```json
{
  "email": "frank@example.com",
  "firstName": "Frank",
  "lastName": "Russo",
  "tags": ["beta-tester", "relay-launch"]
}
```

_Uses tool: `create_contact`_

```json
{
  "email": "grace@example.com",
  "firstName": "Grace",
  "lastName": "Kim",
  "tags": ["beta-tester", "relay-launch"]
}
```

_Responses:_

```
ctc_e1m2m3 — emma@example.com
ctc_f4r5a6 — frank@example.com
ctc_g7k8i9 — grace@example.com
```

All three contacts created with the `relay-launch` tag. Now I'll create the campaign targeting that tag.

_Uses tool: `create_campaign`_

```json
{
  "name": "Relay Product Launch",
  "subject": "Relay is live! You get early access.",
  "fromName": "The Relay Team",
  "audienceFilter": {
    "tags": ["relay-launch"]
  },
  "templateData": {
    "productName": "Relay",
    "launchDate": "Monday, January 20"
  }
}
```

_Response:_

```json
{
  "id": "cmp_p1q2r3",
  "name": "Relay Product Launch",
  "subject": "Relay is live! You get early access.",
  "status": "draft",
  "audienceCount": 3,
  "createdAt": "2025-01-15T15:00:00Z"
}
```

Campaign created in draft. It matched 3 contacts from the `relay-launch` tag. Here's a summary before I send:

- **Campaign:** Relay Product Launch
- **Subject:** "Relay is live! You get early access."
- **Recipients:** 3 (Emma, Frank, Grace)
- **Status:** Draft

Should I send it now or schedule it for Monday?

---

**You:** Schedule it for Monday at 9am EST.

**Claude:** _Uses tool: `send_campaign`_

```json
{
  "campaignId": "cmp_p1q2r3",
  "scheduledAt": "2025-01-20T14:00:00Z"
}
```

_Response:_

```json
{
  "id": "cmp_p1q2r3",
  "name": "Relay Product Launch",
  "status": "scheduled",
  "scheduledAt": "2025-01-20T14:00:00Z",
  "audienceCount": 3
}
```

Scheduled for **Monday, January 20 at 9:00 AM EST** (14:00 UTC). All 3 beta testers will receive the launch announcement then. You can cancel it anytime before that if plans change.

---

**You:** Actually, let me see all our campaigns to make sure nothing else is going out Monday.

**Claude:** _Uses tool: `list_campaigns`_

```json
{
  "status": "scheduled"
}
```

_Response:_

```json
{
  "data": [
    {
      "id": "cmp_p1q2r3",
      "name": "Relay Product Launch",
      "status": "scheduled",
      "scheduledAt": "2025-01-20T14:00:00Z",
      "audienceCount": 3
    },
    {
      "id": "cmp_w4x5y6",
      "name": "January Newsletter",
      "status": "scheduled",
      "scheduledAt": "2025-01-21T15:00:00Z",
      "audienceCount": 1250
    }
  ],
  "pagination": {
    "hasMore": false
  }
}
```

Two campaigns scheduled:

| Campaign | Date | Time (EST) | Recipients |
|----------|------|------------|------------|
| Relay Product Launch | Mon, Jan 20 | 9:00 AM | 3 |
| January Newsletter | Tue, Jan 21 | 10:00 AM | 1,250 |

No conflicts -- the newsletter goes out Tuesday, a day after the launch email. You're clear.

---

## Tools used

| Tool | Purpose |
|------|---------|
| `create_contact` | Add contacts with tags for targeting |
| `create_campaign` | Build a draft campaign with audience filter |
| `send_campaign` | Schedule the campaign for a future date |
| `list_campaigns` | Review all scheduled campaigns |
