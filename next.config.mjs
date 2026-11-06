/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), notifications=(self)' },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.open-meteo.com https://flood-api.open-meteo.com https://overpass-api.de https://router.project-osrm.org https://routing.openstreetmap.de https://*.tile.openstreetmap.org https://*.opentopomap.org https://server.arcgisonline.com; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ]
  },
}

export default nextConfig
