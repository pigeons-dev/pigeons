export const metadata = {
  title: 'Pigeons Auth Emails Example',
  description: 'Authentication email flows with Pigeons and Next.js',
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
