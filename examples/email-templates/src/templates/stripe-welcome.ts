/**
 * Stripe-style Welcome Email
 *
 * A production-quality template inspired by Stripe's welcome email.
 * Uses React Email components — rendered server-side by Pigeons when sent.
 *
 * Template variables:
 *   - companyName: Your company name
 *   - dashboardUrl: Link to user's dashboard
 *   - docsUrl: Link to documentation
 */

export const slug = 'stripe-welcome'
export const name = 'Stripe-style Welcome'
export const subject = "You're now ready to go live with {{companyName}}!"

export const body = `
import { Html, Head, Body, Container, Section, Text, Button, Hr, Link, Img, Preview } from '@react-email/components'

function Template({ companyName = 'Acme', dashboardUrl = 'https://dashboard.example.com', docsUrl = 'https://docs.example.com' }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Preview>You're now ready to make live transactions with {companyName}!</Preview>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', padding: '20px 48px 48px', marginBottom: '64px' }}>
          <Section>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#525f7f' }}>
              Thanks for submitting your account information. You're now ready to
              make live transactions with {companyName}!
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#525f7f' }}>
              You can view your payments and a variety of other information
              about your account right from your dashboard.
            </Text>
            <Button
              href={dashboardUrl}
              style={{
                backgroundColor: '#656ee8',
                borderRadius: '3px',
                color: '#fff',
                fontSize: '16px',
                fontWeight: 'bold',
                textDecoration: 'none',
                textAlign: 'center',
                display: 'block',
                padding: '10px',
              }}
            >
              View your Dashboard
            </Button>
            <Hr style={{ borderColor: '#e6ebf1', margin: '20px 0' }} />
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#525f7f' }}>
              If you haven't finished your integration, you might find our{' '}
              <Link href={docsUrl} style={{ color: '#556cd6' }}>docs</Link> handy.
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#525f7f' }}>
              — The {companyName} team
            </Text>
            <Hr style={{ borderColor: '#e6ebf1', margin: '20px 0' }} />
            <Text style={{ fontSize: '12px', lineHeight: '16px', color: '#8898aa' }}>
              {companyName}, 123 Main St, San Francisco, CA 94105
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
  companyName: 'Acme Inc',
  dashboardUrl: 'https://dashboard.acme.com',
  docsUrl: 'https://docs.acme.com',
}
