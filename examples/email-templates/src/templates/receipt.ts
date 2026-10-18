/**
 * Payment Receipt Email
 *
 * A clean receipt email for payment confirmations. Shows line items,
 * totals, and a link to view the full invoice.
 *
 * Template variables:
 *   - customerName: Customer's name
 *   - invoiceNumber: Invoice/receipt number
 *   - invoiceUrl: Link to full invoice
 *   - items: JSON string of line items (parsed in template)
 *   - total: Total amount (e.g. "$49.00")
 *   - date: Payment date
 */

export const slug = 'receipt'
export const name = 'Payment Receipt'
export const subject = 'Your receipt from {{companyName}}  - {{invoiceNumber}}'

export const body = `
import { Html, Head, Body, Container, Section, Text, Button, Hr, Row, Column } from '@react-email/components'

function Template({
  customerName = 'Customer',
  companyName = 'Acme',
  invoiceNumber = 'INV-0001',
  invoiceUrl = 'https://app.example.com/invoices/1',
  total = '$49.00',
  date = 'October 15, 2026',
  itemName = 'Pro Plan (Monthly)',
  itemAmount = '$49.00',
}) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f4f4f5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', padding: '32px 48px', borderRadius: '8px', marginTop: '32px' }}>
          <Section>
            <Text style={{ fontSize: '12px', fontWeight: '600', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Receipt from {companyName}
            </Text>
            <Text style={{ fontSize: '32px', fontWeight: 'bold', color: '#18181b', margin: '8px 0 4px' }}>
              {total}
            </Text>
            <Text style={{ fontSize: '14px', color: '#71717a', margin: '0 0 24px' }}>
              Paid on {date}
            </Text>
            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 16px' }} />
            <Row>
              <Column>
                <Text style={{ fontSize: '14px', color: '#3f3f46', margin: '4px 0' }}>{itemName}</Text>
              </Column>
              <Column align="right">
                <Text style={{ fontSize: '14px', color: '#3f3f46', margin: '4px 0' }}>{itemAmount}</Text>
              </Column>
            </Row>
            <Hr style={{ borderColor: '#e4e4e7', margin: '16px 0' }} />
            <Row>
              <Column>
                <Text style={{ fontSize: '14px', fontWeight: '600', color: '#18181b', margin: '4px 0' }}>Total</Text>
              </Column>
              <Column align="right">
                <Text style={{ fontSize: '14px', fontWeight: '600', color: '#18181b', margin: '4px 0' }}>{total}</Text>
              </Column>
            </Row>
            <Hr style={{ borderColor: '#e4e4e7', margin: '16px 0 24px' }} />
            <Button
              href={invoiceUrl}
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
              View Invoice
            </Button>
            <Text style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '24px' }}>
              Invoice {invoiceNumber} · {customerName}
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
  customerName: 'Jane Doe',
  companyName: 'Acme Inc',
  invoiceNumber: 'INV-2026-0042',
  invoiceUrl: 'https://app.acme.com/invoices/42',
  total: '$49.00',
  date: 'October 15, 2026',
  itemName: 'Pro Plan (Monthly)',
  itemAmount: '$49.00',
}
