import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FloodAware — Community flood intelligence',
    short_name: 'FloodAware',
    description: 'Local rainfall, flood reports, mapped risks, and safer route comparisons.',
    start_url: '/',
    display: 'standalone',
    background_color: '#A5A79B',
    theme_color: '#590907',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }
}
