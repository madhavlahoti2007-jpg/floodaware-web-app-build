import { NextRequest, NextResponse } from 'next/server'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const APP_USER_AGENT = 'FloodAware/1.0 (community urban flood safety map)'

function getHeaders(request: NextRequest) {
  return {
    'User-Agent': APP_USER_AGENT,
    'Accept-Language': request.headers.get('accept-language') || 'en',
    Referer: `${new URL(request.url).origin}/`,
  }
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams
  const latitude = input.get('latitude')
  const longitude = input.get('longitude')
  const search = input.get('q')?.trim()
  const upstream = new URL(NOMINATIM_BASE)

  if (search) {
    if (search.length < 3 || search.length > 160) {
      return NextResponse.json({ error: 'Search text must be between 3 and 160 characters.' }, { status: 400 })
    }
    upstream.pathname = '/search'
    upstream.search = new URLSearchParams({ q: search, format: 'jsonv2', addressdetails: '1', limit: '5' }).toString()
  } else if (latitude && longitude) {
    const lat = Number(latitude)
    const lon = Number(longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: 'Location is outside valid coordinate bounds.' }, { status: 400 })
    }
    upstream.pathname = '/reverse'
    upstream.search = new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', addressdetails: '1', zoom: '16' }).toString()
  } else {
    return NextResponse.json({ error: 'Provide a place search or coordinates.' }, { status: 400 })
  }

  try {
    const response = await fetch(upstream, {
      headers: getHeaders(request),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!response.ok) {
      return NextResponse.json({ error: 'Place search is temporarily unavailable.' }, { status: 502 })
    }
    const result = await response.json()
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    })
  } catch {
    return NextResponse.json({ error: 'Place search is temporarily unavailable.' }, { status: 503 })
  }
}
