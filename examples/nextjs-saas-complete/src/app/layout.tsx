export const metadata = {
  title: 'Pigeons SaaS Complete',
  description: 'Full SaaS email integration with Pigeons and Next.js',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
