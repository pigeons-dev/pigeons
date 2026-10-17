/**
 * Team Invite Email
 *
 * Sent when a user is invited to join a team or workspace.
 *
 * Template variables:
 *   - inviterName: Who sent the invite
 *   - teamName: Name of the team/workspace
 *   - inviteUrl: Link to accept the invitation
 */

export const slug = 'team-invite'
export const name = 'Team Invite'
export const subject = '{{inviterName}} invited you to join {{teamName}}'

export const body = `
import { Html, Head, Body, Container, Section, Text, Button, Hr } from '@react-email/components'

function Template({
  inviterName = 'Someone',
  teamName = 'Acme Team',
  inviteUrl = 'https://app.example.com/invite/abc123',
  companyName = 'Acme',
}) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', padding: '32px 48px', borderRadius: '8px', marginTop: '32px' }}>
          <Section style={{ textAlign: 'center' }}>
            <Text style={{ fontSize: '24px', fontWeight: 'bold', color: '#18181b' }}>
              Join {teamName}
            </Text>
            <Text style={{ fontSize: '16px', lineHeight: '26px', color: '#3f3f46' }}>
              <strong>{inviterName}</strong> has invited you to collaborate on
              {' '}<strong>{teamName}</strong> on {companyName}.
            </Text>
            <Button
              href={inviteUrl}
              style={{
                backgroundColor: '#656ee8',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: '600',
                textDecoration: 'none',
                textAlign: 'center',
                display: 'inline-block',
                padding: '12px 32px',
                marginTop: '8px',
              }}
            >
              Accept Invitation
            </Button>
            <Hr style={{ borderColor: '#e4e4e7', margin: '32px 0 16px' }} />
            <Text style={{ fontSize: '12px', color: '#a1a1aa' }}>
              This invitation expires in 7 days. If you didn't expect this
              invitation, you can safely ignore this email.
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
  inviterName: 'Alex Chen',
  teamName: 'Acme Engineering',
  inviteUrl: 'https://app.acme.com/invite/abc123',
  companyName: 'Acme Inc',
}
