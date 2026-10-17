export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Pigeons SaaS Complete</h1>
      <p>
        A comprehensive Next.js example showing every email integration pattern
        you need in a production SaaS app: authentication emails, transactional
        sends, contact management, campaigns, webhooks, and a stats dashboard.
      </p>

      <h2>Auth Emails</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>POST /api/auth/signup</code> &mdash; Welcome email on registration
        </li>
        <li>
          <code>POST /api/auth/forgot-password</code> &mdash; Password reset with token link
        </li>
      </ul>

      <h2>Transactional Emails</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>POST /api/emails/send</code> &mdash; Send any transactional email (template or inline HTML)
        </li>
        <li>
          <code>GET /api/emails/:id</code> &mdash; Check delivery status of a sent email
        </li>
      </ul>

      <h2>Contacts</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>GET /api/contacts</code> &mdash; List contacts (paginated, filterable by tag)
        </li>
        <li>
          <code>POST /api/contacts</code> &mdash; Create a contact with tags and properties
        </li>
        <li>
          <code>GET /api/contacts/:id</code> &mdash; Get a single contact
        </li>
        <li>
          <code>PATCH /api/contacts/:id</code> &mdash; Update contact tags or properties
        </li>
        <li>
          <code>DELETE /api/contacts/:id</code> &mdash; Remove a contact
        </li>
      </ul>

      <h2>Campaigns</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>GET /api/campaigns</code> &mdash; List campaigns with stats
        </li>
        <li>
          <code>POST /api/campaigns</code> &mdash; Create and send a campaign to a tagged audience
        </li>
      </ul>

      <h2>Webhooks</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>POST /api/webhooks/pigeons</code> &mdash; Receive delivery, bounce, complaint, and open events
        </li>
      </ul>

      <h2>Dashboard</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>GET /api/dashboard/stats</code> &mdash; Aggregated send, delivery, bounce, complaint, and open rates
        </li>
      </ul>

      <h2>Try It</h2>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: 6, overflowX: 'auto' }}>
{`# Send a welcome email
curl -X POST http://localhost:3000/api/auth/signup \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "name": "Alice"}'

# Send a transactional email with a template
curl -X POST http://localhost:3000/api/emails/send \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-123-receipt" \\
  -d '{"to": "user@example.com", "templateId": "receipt", "data": {"orderId": "123"}}'

# Check delivery status
curl http://localhost:3000/api/emails/msg_abc123

# Create a contact
curl -X POST http://localhost:3000/api/contacts \\
  -H "Content-Type: application/json" \\
  -d '{"email": "alice@example.com", "firstName": "Alice", "tags": ["beta"]}'

# Create and send a campaign
curl -X POST http://localhost:3000/api/campaigns \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Launch Announcement", "templateId": "launch", "audienceTag": "beta"}'

# View dashboard stats
curl http://localhost:3000/api/dashboard/stats`}
      </pre>
    </main>
  )
}
