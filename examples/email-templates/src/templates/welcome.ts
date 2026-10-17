/**
 * Simple Welcome Email
 *
 * A clean, minimal welcome template for new user signups.
 *
 * Template variables:
 *   - name: User's first name
 *   - loginUrl: Link to sign in
 */

export const slug = 'welcome'
export const name = 'Welcome'
export const subject = 'Welcome to {{companyName}}, {{name}}!'

export const body = `
import { Html, Head, Body, Container, Section, Text, Button, Hr } from '@react-email/components'

function Template({ name = 'there', companyName = 'Acme', loginUrl = 'https://app.example.com/login' }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', padding: '32px 48px', borderRadius: '8px', marginTop: '32px' }}>
          <Section>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b' }}>
              Welcome, {name}!
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#3f3f46' }}>
              Thanks for signing up for {companyName}. We're excited to have you on board.
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#3f3f46' }}>
              Get started by signing into your account:
            </Text>
            <Button
              href={loginUrl}
              style={{
                backgroundColor: '#18181b',
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
              Sign in to {companyName}
            </Button>
            <Hr style={{ borderColor: '#e4e4e7', margin: '24px 0' }} />
            <Text style={{ fontSize: '14px', color: '#71717a' }}>
              If you didn't create this account, you can safely ignore this email.
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
  loginUrl: 'https://app.acme.com/login',
}
