'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Bell, ChevronLeft, ChevronRight, CloudRain, Droplets, Expand, Layers3, LocateFixed, MapPin, Navigation, RefreshCw, ShieldAlert, WifiOff, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { AccountPanel } from '@/components/floodaware/account-panel'
import { PlaceSearch, type PlaceSearchStatus } from '@/components/floodaware/place-search'
import { ReportDialog, type NewReportInput } from '@/components/floodaware/report-dialog'
import { WorkspaceTabContent, type SavedPlace, type WorkspacePanelsProps, type WorkspaceTab } from '@/components/floodaware/workspace-panels'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  buildRiskZones,
  compareRoutes,
  createDemoReports,
  distanceMeters,
  getReportAge,
  HYDERABAD,
  isReportActive,
  type CachedResult,
  type FloodReport,
  type GeoPoint,
  type Place,
  type RawRoute,
  type RouteComparison,
  type TravelMode,
  type UnderpassSpot,
  type WeatherPayload,
  type RiverPayload,
} from '@/lib/floodaware'
import { fetchElevationGrid, fetchRoutes, fetchRiverOutlook, fetchUnderpasses, fetchWeather } from '@/lib/floodaware-api'
import type { FloodMapType, MapLayers } from '@/components/floodaware/flood-map'

const InteractiveMap = dynamic(
  () => import('@/components/floodaware/flood-map').then((module) => module.FloodMap),
  { ssr: false, loading: () => <div className="workspace-map-loading" role="status"><span className="map-loading-dot" /> Loading OpenStreetMap…</div> },
)

const tabItems: Array<{ id: WorkspaceTab; label: string; icon: typeof MapPin }> = [
  { id: 'overview', label: 'Overview', icon: Layers3 },
  { id: 'layers', label: 'Layers', icon: Layers3 },
  { id: 'reports', label: 'Reports', icon: AlertTriangle },
  { id: 'routes', label: 'Routes', icon: Navigation },
  { id: 'weather', label: 'Weather', icon: CloudRain },
  { id: 'hotspots', label: 'Hotspots', icon: ShieldAlert },
  { id: 'underpasses', label: 'Underpasses', icon: MapPin },
  { id: 'analytics', label: 'Analytics', icon: Droplets },
  { id: 'saved', label: 'Saved & alerts', icon: Bell },
  { id: 'emergency', label: 'Emergency', icon: WifiOff },
  { id: 'settings', label: 'Settings', icon: RefreshCw },
  { id: 'about', label: 'About', icon: Layers3 },
]

const initialLayers: MapLayers = { reports: true, zones: true, underpasses: true, routes: false, showDemo: true }

type ReportBackendState = 'loading' | 'ready' | 'schema-required' | 'failed' | 'not-configured'
type SheetState = 'peek' | 'half' | 'full'
type ReportRow = Record<string, unknown>

function isMissingSchema(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: string; message?: string }
  return ['42P01', 'PGRST204', 'PGRST205'].includes(value.code ?? '') || /schema cache|relation .* does not exist|could not find the table/i.test(value.message ?? '')
}

function toTimestamp(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function mapReportRow(row: ReportRow, supabase: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>): FloodReport {
  const createdAt = toTimestamp(row.created_at, Date.now())
  const photoPath = typeof row.photo_path === 'string' ? row.photo_path : null
  const photoUrl = photoPath ? supabase.storage.from('report-photos').getPublicUrl(photoPath).data.publicUrl : null
  return {
    id: String(row.id),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    severity: row.severity as FloodReport['severity'],
    description: typeof row.description === 'string' ? row.description : '',
    createdAt,
    updatedAt: toTimestamp(row.updated_at, createdAt),
    lastConfirmedAt: row.last_confirmed_at ? toTimestamp(row.last_confirmed_at, createdAt) : null,
    confirmations: Number(row.confirmations ?? 0),
    clearedVotes: Number(row.cleared_votes ?? 0),
    resolved: row.status === 'resolved',
    resolvedAt: row.resolved_at ? toTimestamp(row.resolved_at, createdAt) : null,
    isDemo: Boolean(row.is_demo),
    reporterName: typeof row.reporter_name === 'string' ? row.reporter_name : null,
    reporterId: typeof row.reporter_id === 'string' ? row.reporter_id : null,
    expiresAt: row.expires_at ? toTimestamp(row.expires_at, createdAt) : null,
    photoDataUrl: photoUrl,
  }
}

function statusFor<T>(data: CachedResult<T> | undefined, loading: boolean, error: unknown) {
  if (data) return data.stale ? 'cached' as const : 'responded' as const
  if (error) return 'failed' as const
  return loading ? 'loading' as const : 'idle' as const
}

function rainfallLabel(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Rainfall unavailable'
  const level = value >= 7.5 ? 'Heavy' : value >= 2.5 ? 'Moderate' : 'Light'
  return `${level} rain · ${value.toFixed(1)} mm/h`
}

export function ResilienceWorkspace({ initialNow }: { initialNow: number }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), [])
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sheetState, setSheetState] = useState<SheetState>('peek')
  const [mapCenter, setMapCenter] = useState<GeoPoint>(HYDERABAD)
  const [userLocation, setUserLocation] = useState<GeoPoint>(HYDERABAD)
  const [locationLabel, setLocationLabel] = useState('Hyderabad')
  const [locationStatus, setLocationStatus] = useState<'locating' | 'live' | 'fallback'>('locating')
  const [searchPlace, setSearchPlace] = useState<Place | null>(null)
  const [nominatimStatus, setNominatimStatus] = useState<PlaceSearchStatus>('idle')
  const [layers, setLayers] = useState<MapLayers>(initialLayers)
  const [rainfallLayer, setRainfallLayer] = useState(false)
  const [mapType, setMapType] = useState<FloodMapType>('roadmap')
  const [mapTileStatus, setMapTileStatus] = useState<'loading' | 'responded' | 'partial' | 'failed'>('loading')
  const [mapReloadKey, setMapReloadKey] = useState(0)
  const [routeRequest, setRouteRequest] = useState<{ start: GeoPoint; destination: GeoPoint; mode: TravelMode } | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [pinPoint, setPinPoint] = useState<GeoPoint>(HYDERABAD)
  const [pickingReportPin, setPickingReportPin] = useState(false)
  const [online, setOnline] = useState(true)
  const [toast, setToast] = useState('')
  const [now, setNow] = useState(initialNow)
  const [refreshing, setRefreshing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(10)
  const [rainfallUnit, setRainfallUnit] = useState<'mm/h' | 'in/h'>('mm/h')
  const [distanceUnit, setDistanceUnit] = useState<'km' | 'mi'>('km')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [mapViewReady, setMapViewReady] = useState(false)
  const mapChangedRef = useRef(false)
  const dragStartY = useRef<number | null>(null)

  const sessionState = useSWR<User | null>(supabase ? 'floodaware:current-user' : null, async () => {
    if (!supabase) return null
    const { data, error } = await supabase.auth.getUser()
    if (error && error.name !== 'AuthSessionMissingError') throw error
    return data.user ?? null
  }, { revalidateOnFocus: true, dedupingInterval: 20_000 })
  const user = sessionState.data ?? null

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange(() => { void sessionState.mutate() })
    return () => data.subscription.unsubscribe()
  }, [sessionState.mutate, supabase])

  useEffect(() => {
    let active = true
    let cachedCenter: GeoPoint | null = null
    try {
      const cached = window.localStorage.getItem('floodaware:last-map-view')
      if (cached) {
        const parsed = JSON.parse(cached) as { latitude?: number; longitude?: number }
        if (typeof parsed.latitude === 'number' && parsed.latitude >= -90 && parsed.latitude <= 90 && typeof parsed.longitude === 'number' && parsed.longitude >= -180 && parsed.longitude <= 180) {
          cachedCenter = { latitude: parsed.latitude, longitude: parsed.longitude }
          setMapCenter(cachedCenter)
          setLocationLabel('Last viewed area')
        }
      }
    } catch { cachedCenter = null }
    if (!navigator.geolocation) {
      setLocationStatus('fallback')
      if (!cachedCenter) setLocationLabel('Hyderabad')
      setMapViewReady(true)
      return () => { active = false }
    }
    navigator.geolocation.getCurrentPosition((position) => {
      if (!active) return
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      setUserLocation(point)
      setPinPoint(point)
      setLocationStatus('live')
      if (!cachedCenter && !mapChangedRef.current) { setMapCenter(point); setLocationLabel('Your location') }
      setMapViewReady(true)
    }, () => {
      if (!active) return
      setLocationStatus('fallback')
      if (!cachedCenter && !mapChangedRef.current) { setMapCenter(HYDERABAD); setLocationLabel('Hyderabad') }
      setMapViewReady(true)
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 180_000 })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!mapViewReady) return
    try { window.localStorage.setItem('floodaware:last-map-view', JSON.stringify({ latitude: Number(mapCenter.latitude.toFixed(3)), longitude: Number(mapCenter.longitude.toFixed(3)) })) } catch { /* cache is optional */ }
  }, [mapCenter, mapViewReady])

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    const updateClock = () => setNow(Date.now())
    updateOnline()
    updateClock()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    const interval = window.setInterval(updateClock, 60_000)
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); window.clearInterval(interval) }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4_500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const announce = useCallback((message: string) => setToast(message), [])
  const pointKey = `${mapCenter.latitude.toFixed(3)}:${mapCenter.longitude.toFixed(3)}`
  const weatherState = useSWR<CachedResult<WeatherPayload>>(`weather:${pointKey}`, () => fetchWeather(mapCenter), { refreshInterval: autoRefreshMinutes * 60_000, revalidateOnFocus: true, dedupingInterval: 60_000, keepPreviousData: true })
  const riverState = useSWR<CachedResult<RiverPayload>>(`river:${pointKey}`, () => fetchRiverOutlook(mapCenter), { refreshInterval: 30 * 60_000, revalidateOnFocus: true, dedupingInterval: 60_000, keepPreviousData: true })
  const elevationState = useSWR<CachedResult<Awaited<ReturnType<typeof fetchElevationGrid>>['data']>>(`elevation:${pointKey}`, () => fetchElevationGrid(mapCenter), { refreshInterval: 30 * 60_000, revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true })
  const underpassState = useSWR<CachedResult<UnderpassSpot[]>>(`underpasses:${pointKey}`, () => fetchUnderpasses(mapCenter), { refreshInterval: 30 * 60_000, revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true })

  const reportState = useSWR<FloodReport[]>(supabase ? 'floodaware:reports' : null, async () => {
    if (!supabase) return []
    const { data, error } = await supabase.from('flood_report_summary').select('*').order('created_at', { ascending: false }).limit(300)
    if (error) throw error
    return (data ?? []).map((row) => mapReportRow(row as ReportRow, supabase))
  }, { refreshInterval: autoRefreshMinutes * 60_000, revalidateOnFocus: true, dedupingInterval: 10_000 })

  const reportSourceState: ReportBackendState = !supabase ? 'not-configured' : reportState.data ? 'ready' : reportState.error ? (isMissingSchema(reportState.error) ? 'schema-required' : 'failed') : 'loading'
  const demoReports = useMemo(() => createDemoReports(initialNow), [initialNow])
  const reports = reportState.data ?? (reportSourceState === 'schema-required' || reportSourceState === 'failed' || reportSourceState === 'not-configured' ? demoReports : [])
  const displayedReports = useMemo(() => reports.filter((report) => layers.showDemo || !report.isDemo), [layers.showDemo, reports])
  const activeReports = useMemo(() => displayedReports.filter((report) => isReportActive(report, now)), [displayedReports, now])
  const nearbyReports = useMemo(() => activeReports.filter((report) => distanceMeters(mapCenter, report) <= 4_000), [activeReports, mapCenter])
  const forecastPeak = weatherState.data?.data.hours.reduce<number | null>((peak, hour) => hour.precipitationMm === null ? peak : peak === null ? hour.precipitationMm : Math.max(peak, hour.precipitationMm), null) ?? null
  const zones = useMemo(() => buildRiskZones(nearbyReports, elevationState.data?.data ?? [], weatherState.data?.data.currentRainMmHr ?? null, forecastPeak), [nearbyReports, elevationState.data, weatherState.data, forecastPeak, now])
  const routeKey = routeRequest ? `routes:${routeRequest.mode}:${routeRequest.start.latitude.toFixed(4)}:${routeRequest.start.longitude.toFixed(4)}:${routeRequest.destination.latitude.toFixed(4)}:${routeRequest.destination.longitude.toFixed(4)}` : null
  const routeState = useSWR<CachedResult<{ routes: RawRoute[] }>>(routeKey, () => routeRequest ? fetchRoutes(routeRequest.start, routeRequest.destination, false, routeRequest.mode) : Promise.reject(new Error('Choose a route first')), { revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true })
  const routes = useMemo<RouteComparison[]>(() => compareRoutes(routeState.data?.data.routes ?? [], activeReports), [routeState.data, activeReports, now])
  const profileState = useSWR(supabase && user ? `floodaware:profile:${user.id}` : null, async () => {
    if (!supabase || !user) return null
    const { data, error } = await supabase.from('profiles').select('id, display_name, preferred_language, notification_opt_in, role').eq('id', user.id).maybeSingle()
    if (error) throw error
    return data as import('@/components/floodaware/account-panel').FloodAwareProfile | null
  }, { revalidateOnFocus: true })
  const savedPlacesState = useSWR<SavedPlace[]>(supabase && user ? `floodaware:saved-places:${user.id}` : null, async () => {
    if (!supabase || !user) return []
    const { data, error } = await supabase.from('saved_places').select('id, label, category, latitude, longitude, radius_meters').eq('user_id', user.id).order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as SavedPlace[]
  }, { revalidateOnFocus: true })
  const savedPlacesStatus: WorkspacePanelsProps['savedPlacesState'] = !user ? 'signed-out' : savedPlacesState.data ? 'ready' : savedPlacesState.error ? (isMissingSchema(savedPlacesState.error) ? 'schema-required' : 'failed') : 'loading'
  const savedPlaces = savedPlacesState.data ?? []

  useEffect(() => {
    if (!supabase || reportSourceState !== 'ready') return
    const channel = supabase.channel('floodaware-live-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flood_reports' }, () => { void reportState.mutate() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'report_votes' }, () => { void reportState.mutate() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [reportSourceState, reportState.mutate, supabase])

  useEffect(() => {
    if (!supabase || !user || !profileState.data?.notification_opt_in || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const channel = supabase.channel(`floodaware-alerts-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_alerts', filter: `user_id=eq.${user.id}` }, (payload) => {
        const alert = payload.new as { title?: string; body?: string }
        if (alert.title) new Notification(alert.title, { body: alert.body ?? 'A new flood update is near one of your saved places.' })
      }).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [profileState.data?.notification_opt_in, supabase, user])

  const tileStatus = useCallback((status: 'loading' | 'responded' | 'failed') => {
    setMapTileStatus((current) => status === 'loading' ? 'loading' : status === 'responded' ? current === 'failed' || current === 'partial' ? 'partial' : 'responded' : current === 'responded' || current === 'partial' ? 'partial' : 'failed')
  }, [])

  function locateUser(updateMap = true, notify = false) {
    if (!navigator.geolocation) { setLocationStatus('fallback'); if (notify) announce('Location is unavailable. Search for a place or use the map center.'); return }
    navigator.geolocation.getCurrentPosition((position) => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }
      setUserLocation(point)
      setPinPoint(point)
      setLocationStatus('live')
      if (updateMap) { mapChangedRef.current = true; setMapCenter(point); setLocationLabel('Your location'); setSearchPlace(null) }
      if (notify) announce('Your location is ready.')
    }, () => { setLocationStatus('fallback'); if (notify) announce('Location access was unavailable. Showing the selected map area instead.') }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 180_000 })
  }

  function viewPoint(point: GeoPoint) {
    mapChangedRef.current = true
    setMapCenter(point)
    setLocationLabel('Selected advisory area')
    setActiveTab('overview')
    setSheetState('peek')
  }

  function viewReport(report: FloodReport) {
    viewPoint(report)
    setLayers((current) => ({ ...current, reports: true }))
  }

  function selectSearchPlace(place: Place) {
    mapChangedRef.current = true
    setSearchPlace(place)
    setMapCenter({ latitude: place.latitude, longitude: place.longitude })
    setLocationLabel(place.displayName.split(',')[0] || 'Selected area')
    setActiveTab('overview')
  }

  function requestRoutes(start: GeoPoint, destination: GeoPoint, mode: TravelMode = 'drive') {
    setRouteRequest({ start, destination, mode })
    setSelectedRouteId(null)
    setLayers((current) => ({ ...current, routes: true }))
    setActiveTab('routes')
  }

  async function confirmReport(id: string) {
    if (!user) { setActiveTab('settings'); announce('Sign in to confirm or clear a community report.'); return }
    if (!supabase || reportSourceState !== 'ready') { announce('Report verification is unavailable until Supabase setup is applied.'); return }
    const { error } = await supabase.from('report_votes').upsert({ report_id: id, user_id: user.id, vote_type: 'confirm' }, { onConflict: 'report_id,user_id' })
    if (error) { announce('Your confirmation could not be saved. Retry after checking your connection.'); return }
    await reportState.mutate()
    announce('Report confirmed. Its six-hour expiry is extended.')
  }

  async function clearReport(id: string) {
    if (!user) { setActiveTab('settings'); announce('Sign in to confirm or clear a community report.'); return }
    if (!supabase || reportSourceState !== 'ready') { announce('Report verification is unavailable until Supabase setup is applied.'); return }
    const { error } = await supabase.from('report_votes').upsert({ report_id: id, user_id: user.id, vote_type: 'cleared' }, { onConflict: 'report_id,user_id' })
    if (error) { announce('Your clear vote could not be saved. Retry after checking your connection.'); return }
    await reportState.mutate()
    announce('Clear vote saved. Three votes resolve a report.')
  }

  async function submitReport(input: NewReportInput) {
    if (!supabase || reportSourceState !== 'ready') return { error: 'Supabase reporting is not ready. The database schema and create-report Edge Function must be applied first.' }
    const { error } = await supabase.functions.invoke('create-report', { body: {
      latitude: input.latitude,
      longitude: input.longitude,
      severity: input.severity,
      description: input.description,
      reporter_name: input.reporterName,
      photo_data_url: input.photoDataUrl,
    } })
    if (error) return { error: 'The rate-limited Supabase report service is not available. Setup is pending; no report was saved.' }
    await reportState.mutate()
    setReportDialogOpen(false)
    setPickingReportPin(false)
    setLayers((current) => ({ ...current, reports: true, showDemo: true }))
    setActiveTab('reports')
    announce('Your report was submitted to the community feed.')
    return {}
  }

  async function savePlace(place: Place, label: string, category: SavedPlace['category']) {
    if (!supabase || !user) throw new Error('Sign in before saving a place.')
    const { error } = await supabase.from('saved_places').insert({ user_id: user.id, label, category, latitude: place.latitude, longitude: place.longitude, radius_meters: 1500 })
    if (error) throw new Error('This place could not be saved. Supabase setup may still be pending.')
    await savedPlacesState.mutate()
    announce('Saved place added.')
  }

  async function deletePlace(id: string) {
    if (!supabase || !user) return
    const { error } = await supabase.from('saved_places').delete().eq('id', id).eq('user_id', user.id)
    if (error) { announce('Saved place could not be removed.'); return }
    await savedPlacesState.mutate()
    announce('Saved place removed.')
  }

  async function enableNotifications() {
    if (!user) { setActiveTab('settings'); announce('Sign in and opt in to enable nearby notifications.'); return }
    if (!('Notification' in window)) { announce('Browser notifications are not supported here.'); return }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (permission !== 'granted') { announce('Notification permission was not granted.'); return }
    if (!supabase || profileState.error || !profileState.data) { announce('Profile notification preferences need the Supabase schema.'); return }
    const { error } = await supabase.from('profiles').update({ notification_opt_in: true }).eq('id', user.id)
    if (error) { announce('Notification preference could not be saved.'); return }
    await profileState.mutate()
    announce('Nearby browser notifications are enabled.')
  }

  async function clearSavedData() {
    if (!supabase || !user) { announce('Sign in before clearing saved data.'); return }
    if (!window.confirm('Delete all saved places and routes from your account?')) return
    const places = await supabase.from('saved_places').delete().eq('user_id', user.id)
    const routesResult = await supabase.from('saved_routes').delete().eq('user_id', user.id)
    if (places.error || routesResult.error) { announce('Saved data could not be cleared. Supabase setup may still be pending.'); return }
    await savedPlacesState.mutate()
    announce('Saved places and routes cleared.')
  }

  async function moderateReport(id: string, status: 'active' | 'removed') {
    if (!supabase || (profile?.role !== 'moderator' && profile?.role !== 'admin')) { announce('Moderator access is required for this action.'); return }
    const { error } = await supabase.rpc('moderate_flood_report', { p_report_id: id, p_status: status })
    if (error) { announce('Moderation action could not be saved. Check the Supabase setup.'); return }
    await reportState.mutate()
    announce(status === 'removed' ? 'Report removed from the public map.' : 'Report restored to the public map.')
  }

  async function refreshData() {
    if (refreshing) return
    setRefreshing(true)
    const results = await Promise.allSettled([
      weatherState.mutate(fetchWeather(mapCenter, true), { revalidate: false }),
      riverState.mutate(fetchRiverOutlook(mapCenter, true), { revalidate: false }),
      elevationState.mutate(fetchElevationGrid(mapCenter, true), { revalidate: false }),
      underpassState.mutate(fetchUnderpasses(mapCenter, true), { revalidate: false }),
      reportState.mutate(),
    ])
    setRefreshing(false)
    const failures = results.filter((result) => result.status === 'rejected').length
    announce(failures ? 'Some sources did not respond. Check each source status for details.' : 'Data refresh complete.')
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen().then(() => setFullscreen(true)).catch(() => announce('Fullscreen mode is unavailable in this browser.'))
    else void document.exitFullscreen().then(() => setFullscreen(false))
  }

  async function saveSelectedRoute(route: RouteComparison) {
    if (!supabase || !user) { setActiveTab('settings'); announce('Sign in to save routes.'); return }
    if (reportSourceState !== 'ready') { announce('Route storage is unavailable until Supabase setup is applied.'); return }
    if (!routeRequest) return
    const { error } = await supabase.from('saved_routes').insert({ user_id: user.id, name: `Route ${route.label}`, route_mode: routeRequest.mode, start_latitude: routeRequest.start.latitude, start_longitude: routeRequest.start.longitude, end_latitude: routeRequest.destination.latitude, end_longitude: routeRequest.destination.longitude, route_geojson: { type: 'LineString', coordinates: route.coordinates }, distance_meters: route.distanceMeters, duration_seconds: route.durationSeconds, risk_score: route.riskScore })
    announce(error ? 'Route could not be saved. Check Supabase setup.' : 'Route saved to your account.')
  }

  async function shareSelectedRoute(route: RouteComparison) {
    if (!routeRequest) return
    const url = new URL(window.location.href)
    url.searchParams.set('from', `${routeRequest.start.latitude.toFixed(5)},${routeRequest.start.longitude.toFixed(5)}`)
    url.searchParams.set('to', `${routeRequest.destination.latitude.toFixed(5)},${routeRequest.destination.longitude.toFixed(5)}`)
    url.searchParams.set('route', route.id)
    url.searchParams.set('mode', routeRequest.mode)
    try {
      if (navigator.share) await navigator.share({ title: `FloodAware · ${route.label}`, text: 'Advisory route scored against available flood reports.', url: url.toString() })
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url.toString())
      else { announce('Route sharing is unavailable in this browser.'); return }
      announce('Route link shared.')
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) announce('Route link could not be shared.')
    }
  }

  const visibleReports = displayedReports
  const activeVisibleReports = activeReports
  const locationText = locationStatus === 'live' && locationLabel === 'Your location' ? 'Your location' : locationLabel
  const rainfallAdvisory = weatherState.data?.data.currentRainMmHr !== null && weatherState.data?.data.currentRainMmHr !== undefined && weatherState.data.data.currentRainMmHr >= 7.5
    ? 'Heavy rain is underway at this location. Avoid underpasses and never enter moving water.'
    : weatherState.data?.data.hours.some((hour) => (hour.precipitationMm ?? 0) >= 5 && (hour.probability ?? 0) >= 60)
      ? 'Heavy rain is possible within the next 12 hours. Avoid underpasses if water is rising.'
      : weatherState.data ? 'No high-intensity rain signal appears in the next 12 hours. Forecasts can change.' : 'Rainfall guidance is unavailable until local forecast data responds.'
  const dataSources = [
    { name: 'Rain · Open-Meteo', state: statusFor(weatherState.data, weatherState.isLoading, weatherState.error), updatedAt: weatherState.data?.updatedAt },
    { name: 'River · Flood API', state: statusFor(riverState.data, riverState.isLoading, riverState.error), updatedAt: riverState.data?.updatedAt },
    { name: 'Elevation · Open-Meteo', state: statusFor(elevationState.data, elevationState.isLoading, elevationState.error), updatedAt: elevationState.data?.updatedAt },
    { name: 'Low spots · Overpass', state: statusFor(underpassState.data, underpassState.isLoading, underpassState.error), updatedAt: underpassState.data?.updatedAt },
    { name: 'Community reports · Supabase', state: reportSourceState === 'ready' ? 'responded' as const : reportSourceState === 'loading' ? 'loading' as const : reportSourceState === 'failed' || reportSourceState === 'schema-required' || reportSourceState === 'not-configured' ? 'failed' as const : 'idle' as const },
    { name: 'Map tiles · OpenStreetMap', state: mapTileStatus === 'responded' ? 'responded' as const : mapTileStatus === 'partial' ? 'cached' as const : mapTileStatus === 'failed' ? 'failed' as const : 'loading' as const },
    { name: 'Place search · Nominatim', state: nominatimStatus === 'responded' ? 'responded' as const : nominatimStatus === 'failed' ? 'failed' as const : nominatimStatus === 'loading' ? 'loading' as const : 'idle' as const },
    { name: 'Routes · OSRM', state: statusFor(routeState.data, routeState.isLoading, routeState.error), updatedAt: routeState.data?.updatedAt },
  ]
  const profile = profileState.data ?? null
  const profileError = profileState.error ? (isMissingSchema(profileState.error) ? 'Profile storage is not initialized.' : 'Profile could not be loaded.') : null
  const notificationOptIn = Boolean(profile?.notification_opt_in && typeof Notification !== 'undefined' && Notification.permission === 'granted')
  const reportSourceMessage = reportSourceState === 'schema-required' ? 'Supabase schema setup pending' : reportSourceState === 'failed' ? 'Supabase reports unavailable' : reportSourceState === 'ready' ? 'Live telemetry connected' : reportSourceState === 'not-configured' ? 'Supabase unavailable' : 'Connecting to telemetry'
  const sheetHeight = sheetState === 'peek' ? '184px' : sheetState === 'half' ? '52dvh' : '88dvh'
  const contentProps: WorkspacePanelsProps = {
    tab: activeTab,
    now,
    location: mapCenter,
    locationLabel,
    reports: visibleReports,
    activeReports: activeVisibleReports,
    zones,
    weather: weatherState.data,
    weatherLoading: weatherState.isLoading,
    weatherError: weatherState.error as Error | undefined,
    river: riverState.data,
    riverLoading: riverState.isLoading,
    riverError: riverState.error as Error | undefined,
    underpasses: underpassState.data,
    underpassesLoading: underpassState.isLoading,
    underpassesError: underpassState.error as Error | undefined,
    elevationAvailable: Boolean(elevationState.data?.data.length),
    rainfallAdvisory,
    reportSourceState,
    userId: user?.id ?? null,
    profileRole: profile?.role ?? null,
    onModerateReport: (id: string, status: 'active' | 'removed') => void moderateReport(id, status),
    layers,
    onLayerToggle: (key: keyof MapLayers) => setLayers((current) => ({ ...current, [key]: !current[key] })),
    rainfallLayer,
    onToggleRainfall: () => setRainfallLayer((current) => !current),
    mapType,
    onMapTypeChange: setMapType,
    onOpenReport: () => { setPinPoint(mapCenter); setReportDialogOpen(true) },
    onNavigateTab: setActiveTab,
    onViewPoint: viewPoint,
    onViewReport: viewReport,
    onConfirmReport: (id: string) => void confirmReport(id),
    onClearReport: (id: string) => void clearReport(id),
    currentLocationLabel: locationStatus === 'live' ? 'Your location' : `Map center · ${locationLabel}`,
    routeUpdatedAt: routeState.data?.updatedAt,
    routes,
    routesLoading: routeState.isLoading,
    routesError: routeState.error as Error | undefined,
    selectedRouteId,
    onRequestRoutes: requestRoutes,
    onSelectRoute: setSelectedRouteId,
    onRetryRoutes: () => routeRequest && void routeState.mutate(fetchRoutes(routeRequest.start, routeRequest.destination, true, routeRequest.mode), { revalidate: false }),
    savedPlaces,
    savedPlacesState: savedPlacesStatus,
    onSavePlace: savePlace,
    onDeletePlace: (id: string) => void deletePlace(id),
    notificationsEnabled: notificationOptIn,
    onEnableNotifications: () => void enableNotifications(),
    onRefresh: () => void refreshData(),
    refreshing,
    dataSources,
    autoRefreshMinutes,
    onAutoRefreshChange: setAutoRefreshMinutes,
    rainfallUnit,
    onRainfallUnitChange: setRainfallUnit,
    distanceUnit,
    onDistanceUnitChange: setDistanceUnit,
    reduceMotion,
    onReduceMotionChange: setReduceMotion,
    onClearSavedData: () => void clearSavedData(),
    accountPanel: <AccountPanel user={user} profile={profile} profileError={profileError} supabase={supabase} onProfileSaved={() => void profileState.mutate()} />,
    onRetryReports: () => void reportState.mutate(),
    onSaveRoute: (route: RouteComparison) => void saveSelectedRoute(route),
    onShareRoute: (route: RouteComparison) => void shareSelectedRoute(route),
  }

  function handleSheetPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    dragStartY.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function handleSheetPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragStartY.current === null) return
    const delta = dragStartY.current - event.clientY
    if (delta > 45) setSheetState((current) => current === 'peek' ? 'half' : 'full')
    if (delta < -45) setSheetState((current) => current === 'full' ? 'half' : 'peek')
    dragStartY.current = null
  }
  function handleSheetKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowUp') { event.preventDefault(); setSheetState((current) => current === 'peek' ? 'half' : 'full') }
    if (event.key === 'ArrowDown') { event.preventDefault(); setSheetState((current) => current === 'full' ? 'half' : 'peek') }
  }

  return (
    <div className={`resilience-shell ${sidebarCollapsed ? 'is-collapsed' : ''} ${reduceMotion ? 'reduce-motion' : ''} sheet-${sheetState}`} style={{ '--sheet-height': sheetHeight } as CSSProperties}>
      <main className="map-stage" aria-label="FloodAware map workspace">
        <InteractiveMap
          key={mapReloadKey}
          point={mapCenter}
          reports={displayedReports}
          zones={zones}
          underpasses={underpassState.data?.data ?? []}
          routes={routes}
          selectedRouteId={selectedRouteId}
          layers={layers}
          pickingReportPin={pickingReportPin}
          onPickReportPin={(point) => { setPinPoint(point); setPickingReportPin(false); setReportDialogOpen(true) }}
          onConfirmReport={(id) => void confirmReport(id)}
          onClearReport={(id) => void clearReport(id)}
          onSelectRoute={setSelectedRouteId}
          onTileStatusChange={tileStatus}
          mapType={mapType}
          routeEndpoints={routeRequest}
        />
        <div className="map-topbar">
          <div className="map-search-wrap"><span className="map-search-mark"><MapPin size={16} aria-hidden="true" /></span><PlaceSearch label="Search area, landmark, or street name" placeholder="Search area, landmark, or street name…" value={searchPlace} onSelect={selectSearchPlace} onStatusChange={setNominatimStatus} /></div>
          <div className="map-rain-chip"><span className="rain-chip-icon"><CloudRain size={16} aria-hidden="true" /></span><span>{rainfallLabel(weatherState.data?.data.currentRainMmHr)}</span></div>
        </div>
        <div className="map-provider-banner" role="status"><InfoIcon /> Google Maps unavailable, showing OpenStreetMap</div>
        {mapTileStatus === 'partial' || mapTileStatus === 'failed' ? <div className="map-tile-warning" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>{mapTileStatus === 'partial' ? 'Some map tiles did not load.' : 'Map tiles are unavailable.'}</span><button type="button" onClick={() => { setMapTileStatus('loading'); setMapReloadKey((key) => key + 1) }}>Retry</button></div> : null}
        {pickingReportPin && <div className="map-pin-prompt" role="status"><MapPin size={17} aria-hidden="true" /><span>Tap the map to place your report pin.</span><button className="workspace-icon-button" type="button" aria-label="Cancel pin placement" onClick={() => setPickingReportPin(false)}><X size={16} aria-hidden="true" /></button></div>}
        <details className="floating-map-legend"><summary><Layers3 size={16} aria-hidden="true" /><span>Legend</span></summary><div className="floating-legend-items"><span><i className="legend-marker legend-marker--ankle" aria-hidden="true" /> Ankle-deep</span><span><i className="legend-marker legend-marker--knee" aria-hidden="true" /> Knee-deep</span><span><i className="legend-marker legend-marker--waist" aria-hidden="true">!</i> Waist-deep</span><span><i className="legend-marker legend-marker--blocked" aria-hidden="true">×</i> Impassable</span><span><i className="legend-zone legend-zone--low" aria-hidden="true" /> Low zone</span><span><i className="legend-zone legend-zone--moderate" aria-hidden="true" /> Moderate zone</span><span><i className="legend-zone legend-zone--high" aria-hidden="true" /> High–severe zone</span><span><i className="legend-route" aria-hidden="true" /> Safest route</span><span><i className="legend-marker legend-marker--user" aria-hidden="true" /> Your location</span></div></details>
        {rainfallLayer && <div className="floating-rain-card"><div><CloudRain size={17} aria-hidden="true" /><strong>Rain at selected location</strong></div><p>{rainfallLabel(weatherState.data?.data.currentRainMmHr)}</p><span>{weatherState.data ? `Open-Meteo · ${new Date(weatherState.data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : weatherState.error ? 'Live forecast unavailable' : 'Loading forecast…'}</span></div>}
        <div className="map-float-controls"><button className="map-control-button" type="button" onClick={() => locateUser(true, true)} aria-label="Locate me" title="Locate me"><LocateFixed size={17} aria-hidden="true" /></button><button className="map-control-button" type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}><Expand size={17} aria-hidden="true" /></button><button className="map-control-button" type="button" disabled title="Street View requires Google Maps"><Navigation size={17} aria-hidden="true" /><span className="sr-only">Street View unavailable</span></button><button className="map-control-button map-traffic-button" type="button" disabled title="Traffic requires Google Maps"><span aria-hidden="true">T</span><span className="sr-only">Traffic unavailable</span></button></div>
        <div className="map-report-action"><button className="workspace-button workspace-button--danger" type="button" onClick={() => { setPinPoint(mapCenter); setReportDialogOpen(true) }}><MapPin size={17} aria-hidden="true" /> Report flooding</button></div>
        <div className="map-location-status"><LocateFixed size={14} aria-hidden="true" /> {locationStatus === 'live' ? 'Using your device location' : locationStatus === 'fallback' ? `Location unavailable · showing ${locationLabel}` : 'Finding your location…'}</div>
      </main>

      {!online && <div className="workspace-offline-banner" role="status"><WifiOff size={16} aria-hidden="true" /> Offline · last-known public data is labeled</div>}

      <aside className="workspace-sidebar" aria-label="FloodAware controls">
        <header className="workspace-brand">
          <span className="brand-mark" aria-hidden="true"><MapPin size={26} /><Droplets size={14} /></span>
          <div className="brand-copy"><strong>Flood<span>Aware</span></strong><small>Urban Flood Intelligence &amp; Navigation</small><span className={`telemetry-badge ${reportSourceState === 'ready' ? 'is-live' : reportSourceState === 'schema-required' || reportSourceState === 'failed' ? 'is-demo' : ''}`}><span aria-hidden="true" />{online ? reportSourceMessage : 'Offline'}</span></div>
          <button className="sidebar-collapse-button" type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed}>{sidebarCollapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}</button>
        </header>
        <div className="workspace-sidebar-body">
          <nav className="workspace-tab-rail" aria-label="FloodAware workspace tabs">
            {tabItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`workspace-tab-button ${activeTab === id ? 'is-active' : ''}`} aria-current={activeTab === id ? 'page' : undefined} aria-label={label} title={label} onClick={() => { setActiveTab(id); if (window.matchMedia('(max-width: 720px)').matches) setSheetState('half') }}><Icon size={19} aria-hidden="true" /><span>{label}</span></button>)}
          </nav>
          <section className="workspace-content-pane" aria-label={`${tabItems.find((tab) => tab.id === activeTab)?.label ?? 'Overview'} panel`}>
            <button className="sheet-drag-handle" type="button" aria-label="Resize panel; use arrow keys or drag" onPointerDown={handleSheetPointerDown} onPointerUp={handleSheetPointerUp} onKeyDown={handleSheetKeyDown}><span /></button>
            <div className="workspace-content-scroll"><WorkspaceTabContent {...contentProps} /></div>
            <footer className="workspace-sidebar-footer"><span className="footer-dot" aria-hidden="true" /><span>System telemetry: {online ? reportSourceMessage : 'Offline'}</span><span className="footer-separator">·</span><span>Map: OpenStreetMap</span></footer>
          </section>
        </div>
      </aside>

      <ReportDialog
        open={reportDialogOpen}
        point={pinPoint}
        backendReady={reportSourceState === 'ready'}
        onClose={() => setReportDialogOpen(false)}
        onPickOnMap={() => { setReportDialogOpen(false); setPickingReportPin(true); announce('Tap the map to place your report pin.') }}
        onUseMyLocation={() => locateUser(false, true)}
        onSubmit={submitReport}
      />
      {toast && <div className="workspace-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

function InfoIcon() {
  return <span className="map-provider-icon" aria-hidden="true">i</span>
}
