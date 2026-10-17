export default function Home() {
  return (
    <main style={{ maxWidth: 600, margin: '4rem auto', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Pigeons Auth Emails</h1>
      <p>
        This example demonstrates common authentication email flows
        using the Pigeons TypeScript SDK with Next.js API routes.
      </p>
      <p>
        Each link below triggers a <code>POST</code> request to an API route
        that sends a transactional email through your Pigeons instance.
      </p>

      <h2>Available Flows</h2>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <code>POST /api/auth/signup</code> &mdash; Welcome email after registration
        </li>
        <li>
          <code>POST /api/auth/verify-email</code> &mdash; Email verification with token link
        </li>
        <li>
          <code>POST /api/auth/forgot-password</code> &mdash; Password reset email
        </li>
        <li>
          <code>POST /api/auth/magic-link</code> &mdash; Passwordless login link
        </li>
      </ul>

      <h2>Try It</h2>
      <p>Use curl or any HTTP client to hit the routes:</p>
      <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: 6, overflowX: 'auto' }}>
{`curl -X POST http://localhost:3000/api/auth/signup \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "name": "Alice"}'`}
      </pre>
    </main>
  )
}
