/**
 * Password Reset Email
 *
 * Sent when a user requests a password reset. Includes a time-limited
 * reset link and security notice.
 *
 * Template variables:
 *   - name: User's first name
 *   - resetUrl: Password reset link (time-limited)
 *   - expiresIn: How long the link is valid (e.g. "1 hour")
 */

export const slug = 'password-reset'
export const name = 'Password Reset'
export const subject = 'Reset your {{companyName}} password'

export const body = `
import { Html, Head, Body, Container, Section, Text, Button, Hr, Code } from '@react-email/components'

function Template({ name = 'there', companyName = 'Acme', resetUrl = 'https://app.example.com/reset', expiresIn = '1 hour' }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', padding: '32px 48px', borderRadius: '8px', marginTop: '32px' }}>
          <Section>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b' }}>
              Reset your password
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#3f3f46' }}>
              Hi {name}, we received a request to reset your {companyName} password.
              Click the button below to choose a new password:
            </Text>
            <Button
              href={resetUrl}
              style={{
                backgroundColor: '#dc2626',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: '600',
                textDecoration: 'none',
                textAlign: 'center',
                display: 'block',
                padding: '12px 24px',
              }}
            >
              Reset Password
            </Button>
            <Text style={{ fontSize: '14px', lineHeight: '24px', color: '#71717a', marginTop: '16px' }}>
              This link expires in {expiresIn}. If you didn't request a password reset,
              you can safely ignore this email  - your password will remain unchanged.
            </Text>
            <Hr style={{ borderColor: '#e4e4e7', margin: '24px 0' }} />
            <Text style={{ fontSize: '12px', color: '#a1a1aa' }}>
              If the button doesn't work, copy and paste this URL into your browser:
            </Text>
            <Text style={{ fontSize: '12px', color: '#a1a1aa', wordBreak: 'break-all' }}>
              {resetUrl}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default Template
`

export const sampleData = {
  name: 'Jane',
  companyName: 'Acme Inc',
  resetUrl: 'https://app.acme.com/reset?token=abc123',
  expiresIn: '1 hour',
}
