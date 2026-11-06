import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import './command-center.css'

export const metadata: Metadata = {
  title: 'FloodAware | Urban flood intelligence & safer routes',
  description: 'Map live rainfall, community waterlogging reports, known low spots, and hazard-aware route alternatives with FloodAware.',
  applicationName: 'FloodAware',
  generator: 'v0.app',
  keywords: ['flood awareness', 'rainfall', 'waterlogging', 'safer routes', 'community reports'],
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'FloodAware',
    description: 'Local flood signals, public weather data, and hazard-aware route comparisons.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1E2022',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
