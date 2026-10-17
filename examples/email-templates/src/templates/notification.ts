/**
 * Activity Notification Email
 *
 * A versatile notification template for in-app activity alerts:
 * new comments, mentions, assignments, etc.
 *
 * Template variables:
 *   - name: Recipient's first name
 *   - actorName: Who performed the action
 *   - action: What happened (e.g. "commented on your post")
 *   - preview: Preview of the content
 *   - actionUrl: Link to view in app
 */

export const slug = 'notification'
export const name = 'Activity Notification'
export const subject = '{{actorName}} {{action}}'

export const body = `
import { Html, Head, Body, Container, Section, Text, Button, Hr } from '@react-email/components'

function Template({
  name = 'there',
  actorName = 'Someone',
  action = 'mentioned you',
  preview = '',
  actionUrl = 'https://app.example.com',
  companyName = 'Acme',
}) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', padding: '32px 48px', borderRadius: '8px', marginTop: '32px' }}>
          <Section>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#3f3f46' }}>
              Hi {name},
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#3f3f46' }}>
              <strong>{actorName}</strong> {action}.
            </Text>
            {preview ? (
              <Section style={{ backgroundColor: '#f4f4f5', borderRadius: '6px', padding: '16px', margin: '16px 0' }}>
                <Text style={{ fontSize: '14px', lineHeight: '22px', color: '#52525b', margin: 0, fontStyle: 'italic' }}>
                  "{preview}"
                </Text>
              </Section>
            ) : null}
            <Button
              href={actionUrl}
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
              View in {companyName}
            </Button>
            <Hr style={{ borderColor: '#e4e4e7', margin: '24px 0' }} />
            <Text style={{ fontSize: '12px', color: '#a1a1aa' }}>
              You're receiving this because you have notifications enabled.
              Manage your preferences in your account settings.
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
  actorName: 'Alex',
  action: 'commented on your pull request',
  preview: 'Looks good! Just one small suggestion on line 42.',
  actionUrl: 'https://app.acme.com/pr/123#comment-456',
  companyName: 'Acme Inc',
}
