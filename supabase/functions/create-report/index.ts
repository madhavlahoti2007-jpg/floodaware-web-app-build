import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

const allowedSeverities = new Set(['Ankle-deep', 'Knee-deep', 'Waist-deep', 'Impassable'])
const allowedReportTypes = new Set(['street_flooding', 'underpass', 'drain_blockage', 'river_rise'])
const maxPhotoBytes = 2 * 1024 * 1024

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLength)
}

function clientIp(request: Request) {
  const direct = request.headers.get('x-real-ip')
  if (direct) return direct.trim().slice(0, 100)
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded?.slice(0, 100) || 'unknown'
}

async function hashIp(ip: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodePhoto(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) throw new Error('Choose a JPEG, PNG, or WebP photo.')
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))
  if (bytes.byteLength > maxPhotoBytes) throw new Error('Photos must be 2 MB or smaller.')
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const contentType = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`
  return { bytes, extension, contentType }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed.' })

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > 3_200_000) return jsonResponse(413, { error: 'Request is too large.' })

  let input: Record<string, unknown>
  try {
    input = await request.json() as Record<string, unknown>
  } catch {
    return jsonResponse(400, { error: 'A JSON report body is required.' })
  }

  const latitude = Number(input.latitude)
  const longitude = Number(input.longitude)
  const severity = typeof input.severity === 'string' ? input.severity : ''
  const description = cleanText(input.description, 500)
  const reporterName = cleanText(input.reporter_name, 60) || null
  const reportType = typeof input.report_type === 'string' ? input.report_type : 'street_flooding'

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return jsonResponse(400, { error: 'Choose a valid map location.' })
  }
  if (!allowedSeverities.has(severity)) return jsonResponse(400, { error: 'Choose a valid water-depth level.' })
  if (!allowedReportTypes.has(reportType)) return jsonResponse(400, { error: 'Choose a valid report type.' })
  if (description.length < 10 || description.length > 500) return jsonResponse(400, { error: 'Report notes must be between 10 and 500 characters.' })

  let photo: ReturnType<typeof decodePhoto>
  try {
    photo = decodePhoto(input.photo_data_url)
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Photo validation failed.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  if (!supabaseUrl || !serviceKey || !publicKey) return jsonResponse(503, { error: 'The report service is not configured.' })

  let reporterId: string | null = null
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    const authClient = createClient(supabaseUrl, publicKey, { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await authClient.auth.getUser()
    if (error) return jsonResponse(401, { error: 'The supplied account session is invalid.' })
    reporterId = data.user?.id ?? null
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const secretHash = await hashIp(clientIp(request), serviceKey)
  const { error: rateLimitError } = await serviceClient.rpc('consume_report_rate_limit', { p_ip_hash: secretHash })
  if (rateLimitError) {
    if (rateLimitError.message.includes('rate_limit_exceeded')) return jsonResponse(429, { error: 'Report limit reached. Try again in a few minutes.' })
    return jsonResponse(503, { error: 'Report storage is not available yet.' })
  }

  const reportId = crypto.randomUUID()
  let photoPath: string | null = null

  if (photo) {
    photoPath = `reports/${reportId}.${photo.extension}`
    const { error: uploadError } = await serviceClient.storage.from('report-photos').upload(photoPath, photo.bytes, { contentType: photo.contentType, cacheControl: '3600', upsert: false })
    if (uploadError) return jsonResponse(503, { error: 'The report photo could not be stored.' })
  }

  const { data, error } = await serviceClient.rpc('create_flood_report', {
    p_report_id: reportId,
    p_reporter_id: reporterId,
    p_reporter_name: reporterName,
    p_report_type: reportType,
    p_severity: severity,
    p_latitude: latitude,
    p_longitude: longitude,
    p_description: description,
    p_photo_path: photoPath,
  })

  if (error) {
    if (photoPath) await serviceClient.storage.from('report-photos').remove([photoPath])
    if (error.message.includes('rate_limit_exceeded')) return jsonResponse(429, { error: 'Report limit reached. Try again in a few minutes.' })
    if (error.message.startsWith('invalid_')) return jsonResponse(400, { error: 'The report could not be validated.' })
    return jsonResponse(503, { error: 'Report storage is not available yet.' })
  }

  return jsonResponse(201, { report_id: data ?? reportId })
})
