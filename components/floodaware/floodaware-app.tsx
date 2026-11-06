'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CloudRain,
  Droplets,
  Layers3,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
  Waves,
  WifiOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AboutSection } from '@/components/floodaware/about-section'
import { DashboardSection } from '@/components/floodaware/dashboard-section'
import { FeatureGrid, type FeatureKey } from '@/components/floodaware/feature-grid'
import { FeaturePanel } from '@/components/floodaware/feature-panel'
import { PlaceSearch, type PlaceSearchStatus } from '@/components/floodaware/place-search'
import { ReportDialog, type NewReportInput } from '@/components/floodaware/report-dialog'
import { SafetySection } from '@/components/floodaware/safety-section'
import {
  buildRiskZones,
  compareRoutes,
  createDemoReports,
  distanceMeters,
  isValidFloodReport,
  mergeReports,
  getReportAge,
  HYDERABAD,
  isReportActive,
  type CachedResult,
  type FloodReport,
  type GeoPoint,
  type Place,
  type RawRoute,
  type RiskZone,
  type RouteComparison,
  type UnderpassSpot,
  type WeatherPayload,
  type RiverPayload,
} from '@/lib/floodaware'
import { fetchElevationGrid, fetchRoutes, fetchRiverOutlook, fetchUnderpasses, fetchWeather, reversePlaceName } from '@/lib/floodaware-api'
import type { MapLayers } from '@/components/floodaware/flood-map'

const InteractiveMap = dynamic(
  () => import('@/components/floodaware/flood-map').then((module) => module.FloodMap),
  {
    ssr: false,
    loading: () => <div className="map-loading" role="status"><span className="map-loading-dot" /> Loading the interactive OpenStreetMap…</div>,
  },
)

const initialLayers: MapLayers = {
  reports: true,
  zones: true,
  underpasses: true,
  routes: false,
  showDemo: true,
}

type ReportSyncMessage =
  | { type: 'snapshot-request' }
  | { type: 'snapshot'; reports: FloodReport[] }
  | { type: 'upsert'; report: FloodReport }
  | { type: 'confirm' | 'clear-vote'; reportId: string; at: number }
  | { type: 'reset-demos'; reports: FloodReport[] }

function isReportSyncMessage(value: unknown): value is ReportSyncMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (message.type === 'snapshot-request') return true
  if (message.type === 'upsert') return isValidFloodReport(message.report)
  if (message.type === 'snapshot' || message.type === 'reset-demos') {
    return Array.isArray(message.reports) && message.reports.every(isValidFloodReport)
  }
  if (message.type === 'confirm' || message.type === 'clear-vote') {
    return typeof message.reportId === 'string' && message.reportId.length <= 100 && typeof message.at === 'number' && Number.isFinite(message.at)
  }
  return false
}

function formatAmount(value: number | null | undefined, unit: string) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : 'Not available'
}

function getRainfallAdvisory(weather: CachedResult<WeatherPayload> | undefined) {
  if (!weather) return 'Rainfall guidance is unavailable until local forecast data responds.'
  const current = weather.data.currentRainMmHr
  const heavy = weather.data.hours.find((hour) => (hour.precipitationMm ?? 0) >= 5 && (hour.probability ?? 0) >= 60)
  const possible = weather.data.hours.find((hour) => (hour.precipitationMm ?? 0) >= 2 && (hour.probability ?? 0) >= 40)
  if (weather.stale) {
    const updatedAt = new Date(weather.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (typeof current === 'number' && current >= 7.5) {
      return `Last known reading at ${updatedAt} showed heavy rain (${current.toFixed(1)} mm/h). Check current local conditions before traveling.`
    }
    if (heavy) {
      return `Last known forecast at ${updatedAt} flagged a heavy-rain signal around ${heavy.time.slice(11, 16)} local time. Check current local advisories.`
    }
    return `Forecast last updated at ${updatedAt}. Conditions may have changed; follow current local advisories.`
  }
  if (typeof current === 'number' && current >= 7.5) {
    return 'Heavy rain is underway at this location. Avoid underpasses and never enter moving water.'
  }
  if (heavy) {
    return `The forecast shows a heavy-rain signal around ${heavy.time.slice(11, 16)} local time (${heavy.probability}% chance). Avoid underpasses if water is rising.`
  }
  if (possible) {
    return `Rain is possible around ${possible.time.slice(11, 16)} local time. Slow down near low spots and keep checking local conditions.`
  }
  return 'No high-intensity rain signal appears in the next 12 hours. Forecasts can change; follow local advisories.'
}

type DataStatus = 'responded' | 'cached' | 'failed' | 'partial' | 'loading' | 'idle' | 'session-only'

function getDataStatus(result: CachedResult<unknown> | undefined, loading: boolean, error: unknown): DataStatus {
  if (result) return result.stale ? 'cached' : 'responded'
  if (error) return 'failed'
  return loading ? 'loading' : 'idle'
}

function DataSourceStatus({ icon: Icon, label, status }: { icon: typeof CloudRain; label: string; status: DataStatus }) {
  const statusLabel: Record<DataStatus, string> = {
    responded: 'Responded',
    cached: 'Cached',
    failed: 'Unavailable',
    partial: 'Partially available',
    loading: 'Loading',
    idle: 'Not requested',
    'session-only': 'Session only',
  }
  return (
    <span className={`data-source-state data-source-${status}`}>
      <span className="data-source-dot" aria-hidden="true" />
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
      <strong>{statusLabel[status]}</strong>
    </span>
  )
}

function layerTitle(key: keyof MapLayers) {
  const titles: Record<keyof MapLayers, string> = {
    reports: 'Community reports',
    zones: 'Risk zones',
    underpasses: 'Known risky spots',
    routes: 'Route comparison',
    showDemo: 'Show demo reports',
  }
  return titles[key]
}

export function FloodAwareApp({ initialNow }: { initialNow: number }) {
  const [mapCenter, setMapCenter] = useState<GeoPoint>(HYDERABAD)
  const [userLocation, setUserLocation] = useState<GeoPoint>(HYDERABAD)
  const [pinPoint, setPinPoint] = useState<GeoPoint>(HYDERABAD)
  const [locationLabel, setLocationLabel] = useState('Hyderabad')
  const [locationStatus, setLocationStatus] = useState<'locating' | 'live' | 'fallback'>('locating')
  const [searchPlace, setSearchPlace] = useState<Place | null>(null)
  const [reports, setReports] = useState<FloodReport[]>(() => createDemoReports(initialNow))
  const [confirmedByViewer, setConfirmedByViewer] = useState<Set<string>>(() => new Set())
  const [clearedByViewer, setClearedByViewer] = useState<Set<string>>(() => new Set())
  const [layers, setLayers] = useState<MapLayers>(initialLayers)
  const [rainfallLayer, setRainfallLayer] = useState(false)
  const [activeFeature, setActiveFeature] = useState<FeatureKey | null>(null)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [pickingReportPin, setPickingReportPin] = useState(false)
  const [toast, setToast] = useState('')
  const [routeRequest, setRouteRequest] = useState<{ start: GeoPoint; destination: GeoPoint } | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)
  const [clock, setClock] = useState(initialNow)
  const [mapViewReady, setMapViewReady] = useState(false)
  const [mapRestoredFromCache, setMapRestoredFromCache] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [mapTileStatus, setMapTileStatus] = useState<'loading' | 'responded' | 'partial' | 'failed'>('loading')
  const [mapReloadKey, setMapReloadKey] = useState(0)
  const [nominatimStatus, setNominatimStatus] = useState<PlaceSearchStatus>('idle')
  const reportsRef = useRef(reports)
  const reportChannelRef = useRef<BroadcastChannel | null>(null)
  const mapChangedRef = useRef(false)

  reportsRef.current = reports
  const announce = useCallback((message: string) => setToast(message), [])
  const locateUser = useCallback((updateMap: boolean, notifyOnFailure = false) => {
    if (!navigator.geolocation) {
      setLocationStatus('fallback')
      if (notifyOnFailure) announce('Location is unavailable in this browser. You can search for a place instead.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }
        setUserLocation(point)
        setPinPoint(point)
        setLocationStatus('live')
        if (updateMap) {
          mapChangedRef.current = true
          setMapCenter(point)
          setSearchPlace(null)
          setLocationLabel('Your location')
          setMapRestoredFromCache(false)
        }
        if (notifyOnFailure) announce('Your location is ready.')
      },
      () => {
        setLocationStatus('fallback')
        if (notifyOnFailure) announce('Location access was unavailable. Search for a place or use the current map center.')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 180_000 },
    )
  }, [announce])

  useEffect(() => {
    let active = true
    let cachedCenter: GeoPoint | null = null
    try {
      const cached = window.localStorage.getItem('floodaware:last-map-view')
      if (cached) {
        const parsed = JSON.parse(cached) as { latitude?: number; longitude?: number }
        if (
          typeof parsed.latitude === 'number' && parsed.latitude >= -90 && parsed.latitude <= 90 &&
          typeof parsed.longitude === 'number' && parsed.longitude >= -180 && parsed.longitude <= 180
        ) {
          cachedCenter = { latitude: parsed.latitude, longitude: parsed.longitude }
          setMapCenter(cachedCenter)
          setLocationLabel('Last viewed area')
          setMapRestoredFromCache(true)
        }
      }
    } catch {
      cachedCenter = null
    }

    if (!navigator.geolocation) {
      setLocationStatus('fallback')
      if (!cachedCenter) setLocationLabel('Hyderabad')
      setMapViewReady(true)
      return () => { active = false }
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active) return
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }
        setUserLocation(point)
        setPinPoint(point)
        setLocationStatus('live')
        if (!cachedCenter && !mapChangedRef.current) {
          setMapCenter(point)
          setLocationLabel('Your location')
        }
        setMapViewReady(true)
      },
      () => {
        if (!active) return
        setLocationStatus('fallback')
        if (!cachedCenter && !mapChangedRef.current) {
          setMapCenter(HYDERABAD)
          setLocationLabel('Hyderabad')
        }
        setMapViewReady(true)
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 180_000 },
    )
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!mapViewReady) return
    try {
      window.localStorage.setItem('floodaware:last-map-view', JSON.stringify({
        latitude: Number(mapCenter.latitude.toFixed(3)),
        longitude: Number(mapCenter.longitude.toFixed(3)),
      }))
    } catch {
      // The map remains usable when browser storage is disabled.
    }
  }, [mapCenter, mapViewReady])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('floodaware:reports')
    reportChannelRef.current = channel
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isReportSyncMessage(event.data)) return
      const message = event.data
      if (message.type === 'snapshot-request') {
        channel.postMessage({ type: 'snapshot', reports: reportsRef.current } satisfies ReportSyncMessage)
      } else if (message.type === 'snapshot') {
        setReports((current) => mergeReports(current, message.reports))
      } else if (message.type === 'upsert') {
        setReports((current) => mergeReports(current, [message.report]))
      } else if (message.type === 'reset-demos') {
        setReports((current) => mergeReports(current.filter((report) => !report.isDemo), message.reports))
      } else if (message.type === 'confirm') {
        setReports((current) => current.map((report) => report.id === message.reportId
          ? { ...report, confirmations: report.confirmations + 1, lastConfirmedAt: message.at, updatedAt: message.at }
          : report))
      } else if (message.type === 'clear-vote') {
        setReports((current) => current.map((report) => {
          if (report.id !== message.reportId) return report
          const clearedVotes = report.clearedVotes + 1
          const resolved = clearedVotes >= 3
          return { ...report, clearedVotes, resolved, resolvedAt: resolved ? message.at : report.resolvedAt, updatedAt: message.at }
        }))
      }
    }
    channel.postMessage({ type: 'snapshot-request' } satisfies ReportSyncMessage)
    return () => {
      channel.close()
      reportChannelRef.current = null
    }
  }, [])

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine)
    updateOnline()
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  useEffect(() => {
    const updateClock = () => setClock(Date.now())
    updateClock()
    const interval = window.setInterval(updateClock, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    setMapTileStatus('loading')
  }, [mapCenter.latitude, mapCenter.longitude])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 4_500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const pointKey = `${mapCenter.latitude.toFixed(3)}:${mapCenter.longitude.toFixed(3)}`
  const updateMapTileStatus = useCallback((status: 'loading' | 'responded' | 'failed') => {
    setMapTileStatus((current) => {
      if (status === 'loading') return 'loading'
      if (status === 'responded') return current === 'failed' || current === 'partial' ? 'partial' : 'responded'
      return current === 'responded' || current === 'partial' ? 'partial' : 'failed'
    })
  }, [])
  const weatherState = useSWR<CachedResult<WeatherPayload>>(
    `weather:${pointKey}`,
    () => fetchWeather(mapCenter),
    { refreshInterval: 10 * 60_000, revalidateOnFocus: true, dedupingInterval: 60_000, keepPreviousData: true },
  )
  const riverState = useSWR<CachedResult<RiverPayload>>(
    `river:${pointKey}`,
    () => fetchRiverOutlook(mapCenter),
    { refreshInterval: 30 * 60_000, revalidateOnFocus: true, dedupingInterval: 60_000, keepPreviousData: true },
  )
  const elevationState = useSWR<CachedResult<Awaited<ReturnType<typeof fetchElevationGrid>>['data']>>(
    `elevation:${pointKey}`,
    () => fetchElevationGrid(mapCenter),
    { refreshInterval: 30 * 60_000, revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true },
  )
  const underpassState = useSWR<CachedResult<UnderpassSpot[]>>(
    `underpasses:${pointKey}`,
    () => fetchUnderpasses(mapCenter),
    { refreshInterval: 30 * 60_000, revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true },
  )

  const displayedReports = useMemo(
    () => reports.filter((report) => layers.showDemo || !report.isDemo),
    [layers.showDemo, reports],
  )
  const activeReports = useMemo(
    () => displayedReports.filter((report) => isReportActive(report, clock)),
    [clock, displayedReports],
  )
  const nearbyActiveReports = useMemo(
    () => activeReports.filter((report) => distanceMeters(mapCenter, report) <= 4_000),
    [activeReports, mapCenter],
  )
  const forecastPeakMmHr = weatherState.data?.data.hours.reduce<number | null>((peak, hour) => {
    if (hour.precipitationMm === null) return peak
    return peak === null ? hour.precipitationMm : Math.max(peak, hour.precipitationMm)
  }, null) ?? null
  const zones = useMemo(
    () => buildRiskZones(nearbyActiveReports, elevationState.data?.data ?? [], weatherState.data?.data.currentRainMmHr ?? null, forecastPeakMmHr),
    [nearbyActiveReports, elevationState.data, weatherState.data, forecastPeakMmHr, clock],
  )
  const topZone = useMemo(
    () => [...zones].sort((a, b) => b.score - a.score)[0],
    [zones],
  )
  const topZoneKey = topZone ? `reverse:${topZone.latitude.toFixed(4)}:${topZone.longitude.toFixed(4)}` : null
  const topZoneState = useSWR<CachedResult<string>>(
    topZoneKey,
    () => topZone ? reversePlaceName(topZone) : Promise.reject(new Error('No risk zone available')),
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  )

  const routeKey = routeRequest
    ? `routes:${routeRequest.start.latitude.toFixed(4)}:${routeRequest.start.longitude.toFixed(4)}:${routeRequest.destination.latitude.toFixed(4)}:${routeRequest.destination.longitude.toFixed(4)}`
    : null
  const routeState = useSWR<CachedResult<{ routes: RawRoute[] }>>(
    routeKey,
    () => routeRequest ? fetchRoutes(routeRequest.start, routeRequest.destination) : Promise.reject(new Error('Choose a route first')),
    { revalidateOnFocus: false, dedupingInterval: 60_000, keepPreviousData: true },
  )
  const routeComparisons = useMemo<RouteComparison[]>(
    () => compareRoutes(routeState.data?.data.routes ?? [], activeReports),
    [routeState.data, activeReports, clock],
  )

  useEffect(() => {
    if (routeComparisons.length > 0 && !routeComparisons.some((route) => route.id === selectedRouteId)) {
      const safest = [...routeComparisons].sort((a, b) => a.riskScore - b.riskScore)[0]
      setSelectedRouteId(safest.id)
    }
  }, [routeComparisons, selectedRouteId])

  function updateLayer(key: keyof MapLayers) {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  function openFeature(feature: FeatureKey) {
    setActiveFeature(feature)
    if (feature === 'routes') setLayers((current) => ({ ...current, routes: true }))
    window.setTimeout(() => document.getElementById('live-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 20)
  }

  function handleConfirmReport(id: string) {
    if (confirmedByViewer.has(id)) {
      announce('You have already confirmed this report in this session.')
      return
    }
    const at = Date.now()
    setConfirmedByViewer((current) => new Set(current).add(id))
    setReports((current) => current.map((report) => report.id === id
      ? { ...report, confirmations: report.confirmations + 1, lastConfirmedAt: at, updatedAt: at }
      : report))
    reportChannelRef.current?.postMessage({ type: 'confirm', reportId: id, at } satisfies ReportSyncMessage)
    announce('Report confirmed. Its six-hour expiry has been extended.')
  }

  function handleClearReport(id: string) {
    if (clearedByViewer.has(id)) {
      announce('You have already voted to clear this report in this session.')
      return
    }
    const at = Date.now()
    setClearedByViewer((current) => new Set(current).add(id))
    setReports((current) => current.map((report) => {
      if (report.id !== id) return report
      const clearedVotes = report.clearedVotes + 1
      const resolved = clearedVotes >= 3
      return { ...report, clearedVotes, resolved, resolvedAt: resolved ? at : report.resolvedAt, updatedAt: at }
    }))
    reportChannelRef.current?.postMessage({ type: 'clear-vote', reportId: id, at } satisfies ReportSyncMessage)
    announce('Your clear vote was added. Three votes resolve a report.')
  }

  function handleNewReport(input: NewReportInput) {
    const now = Date.now()
    const report: FloodReport = {
      ...input,
      id: `session-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      lastConfirmedAt: now,
      confirmations: 0,
      clearedVotes: 0,
      resolved: false,
      resolvedAt: null,
      isDemo: false,
    }
    setReports((current) => mergeReports(current, [report]))
    reportChannelRef.current?.postMessage({ type: 'upsert', report } satisfies ReportSyncMessage)
    setLayers((current) => ({ ...current, reports: true, showDemo: true }))
    setActiveFeature('reports')
    setReportDialogOpen(false)
    setPickingReportPin(false)
    announce('Your report was added for this browser session only.')
  }

  function handleMapPlace(place: Place) {
    mapChangedRef.current = true
    setSearchPlace(place)
    setMapCenter({ latitude: place.latitude, longitude: place.longitude })
    setLocationLabel(place.displayName.split(',')[0] || 'Selected location')
    setMapRestoredFromCache(false)
    setActiveFeature(null)
  }

  function handleMapPin(point: GeoPoint) {
    setPinPoint(point)
    setPickingReportPin(false)
    setReportDialogOpen(true)
  }

  function handleRequestRoutes(start: GeoPoint, destination: GeoPoint) {
    setRouteRequest({ start, destination })
    setSelectedRouteId(null)
    setLayers((current) => ({ ...current, routes: true }))
  }

  async function handleShareLocation() {
    const point = locationStatus === 'live' ? userLocation : mapCenter
    const url = `https://www.openstreetmap.org/?mlat=${point.latitude.toFixed(5)}&mlon=${point.longitude.toFixed(5)}#map=17/${point.latitude.toFixed(5)}/${point.longitude.toFixed(5)}`
    const message = `${locationStatus === 'live' ? 'My location' : 'Selected map point'}: ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'FloodAware location', text: message, url })
        announce(locationStatus === 'live' ? 'Location shared.' : 'Selected map point shared.')
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message)
        announce('Location link copied. Paste it into a message to share.')
        return
      }
      announce('Sharing is not available in this browser. Use the coordinates in the safety section.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      announce('The location link could not be shared. Try copying the coordinates in the safety section.')
    }
  }

  function handleViewZone(zone: RiskZone) {
    mapChangedRef.current = true
    setMapCenter({ latitude: zone.latitude, longitude: zone.longitude })
    setLocationLabel('Selected advisory area')
    setMapRestoredFromCache(false)
    setActiveFeature('zones')
    document.getElementById('live-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function resetDemoReports() {
    const demoReports = createDemoReports()
    setReports((current) => mergeReports(current.filter((report) => !report.isDemo), demoReports))
    reportChannelRef.current?.postMessage({ type: 'reset-demos', reports: demoReports } satisfies ReportSyncMessage)
    setConfirmedByViewer(new Set())
    setClearedByViewer(new Set())
    setLayers((current) => ({ ...current, showDemo: true, reports: true }))
    announce('Demo reports restored for this session.')
  }

  async function refreshPublicData() {
    if (isRefreshing) return
    setIsRefreshing(true)
    const requests: Promise<unknown>[] = [
      weatherState.mutate(fetchWeather(mapCenter, true), { revalidate: false }),
      riverState.mutate(fetchRiverOutlook(mapCenter, true), { revalidate: false }),
      elevationState.mutate(fetchElevationGrid(mapCenter, true), { revalidate: false }),
      underpassState.mutate(fetchUnderpasses(mapCenter, true), { revalidate: false }),
    ]
    if (routeRequest) {
      requests.push(routeState.mutate(fetchRoutes(routeRequest.start, routeRequest.destination, true), { revalidate: false }))
    }
    const results = await Promise.allSettled(requests)
    setIsRefreshing(false)
    const failures = results.filter((result) => result.status === 'rejected').length
    announce(failures ? 'Some public sources did not respond. Last-known values remain labeled.' : 'Refresh complete. Check each source status for its latest response.')
  }

  const showDemoNotice = reports.length > 0 && reports.every((report) => report.isDemo)
  const weather = weatherState.data
  const river = riverState.data
  const underpasses = underpassState.data
  const elevation = elevationState.data
  const rainfallRiskMessage = getRainfallAdvisory(weather)
  const lastUpdatedAt = [weather?.updatedAt, river?.updatedAt, elevation?.updatedAt, underpasses?.updatedAt, routeState.data?.updatedAt, topZoneState.data?.updatedAt]
    .filter((timestamp): timestamp is number => typeof timestamp === 'number')
    .reduce<number | null>((latest, timestamp) => latest === null ? timestamp : Math.max(latest, timestamp), null)
  const mapStatus = mapRestoredFromCache
    ? 'Restored last viewed area'
    : locationLabel === 'Your location' && locationStatus === 'live'
      ? 'Using your device location'
      : locationStatus === 'locating' && locationLabel === 'Hyderabad'
        ? 'Finding your location…'
        : locationStatus === 'fallback'
          ? `Location unavailable · showing ${locationLabel}`
          : `Showing ${locationLabel}`

  return (
    <div className="floodaware-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="FloodAware home">
          <span className="brand-mark"><MapPin className="brand-pin" size={21} aria-hidden="true" /><Droplets className="brand-drop" size={16} aria-hidden="true" /></span>
          <span className="brand-name">Flood<span>Aware</span><small>Community flood intelligence</small></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-link nav-link-active" href="#live-map">Live map</a>
          <a className="nav-link" href="#dashboard">Dashboard</a>
          <a className="nav-link" href="#safety">Safety</a>
          <a className="nav-link" href="#about">About</a>
        </nav>
        <div className="header-actions">
          <span className={`connection-indicator ${isOnline ? 'connection-online' : 'connection-offline'}`}>
            <span aria-hidden="true" />{isOnline ? 'Online' : 'Offline'}
          </span>
          <Button type="button" className="header-report-button" onClick={() => { setPinPoint(mapCenter); setReportDialogOpen(true) }}>
            <MapPin data-icon="inline-start" aria-hidden="true" /> Report flooding
          </Button>
        </div>
      </header>

      {!isOnline && <div className="offline-banner section-shell" role="status"><WifiOff size={18} aria-hidden="true" /><p>You&apos;re offline. Cached public data is labeled; new reports stay in this browser session.</p></div>}

      <main id="top">
        <section className="live-map-section" aria-labelledby="page-title">
          <div className="map-section-heading section-shell">
            <div>
              <p className="eyebrow"><span className="live-indicator" aria-hidden="true" /> City flood signals · {locationLabel}</p>
              <h1 id="page-title">See the water before it finds you.</h1>
              <p className="map-section-description">Rainfall, community reports, and safer route comparisons—on one clear map.</p>
            </div>
            <div className="map-section-actions">
              <span className="map-status-label"><LocateFixed size={17} aria-hidden="true" /> {mapStatus}</span>
              <Button type="button" variant="outline" className="secondary-button" onClick={() => locateUser(true, true)}>
                <LocateFixed data-icon="inline-start" aria-hidden="true" /> Use my location
              </Button>
            </div>
          </div>

          <div id="live-map" className="live-map-shell" aria-label="FloodAware live flood map">
            <InteractiveMap
              key={mapReloadKey}
              point={mapCenter}
              reports={displayedReports}
              zones={zones}
              underpasses={underpasses?.data ?? []}
              routes={routeComparisons}
              selectedRouteId={selectedRouteId}
              layers={layers}
              pickingReportPin={pickingReportPin}
              onPickReportPin={handleMapPin}
              onConfirmReport={handleConfirmReport}
              onClearReport={handleClearReport}
              onSelectRoute={setSelectedRouteId}
              onTileStatusChange={updateMapTileStatus}
            />

            {(mapTileStatus === 'partial' || mapTileStatus === 'failed') && (
              <div className="map-tile-warning map-overlay-card" role="status">
                <AlertTriangle size={17} aria-hidden="true" />
                <span>{mapTileStatus === 'partial' ? 'Some map tiles did not load.' : 'Map tiles are unavailable.'}</span>
                <button className="text-link" type="button" onClick={() => { setMapTileStatus('loading'); setMapReloadKey((current) => current + 1) }}>Retry</button>
              </div>
            )}

            <div className="map-search-card map-overlay-card">
              <div className="map-search-card-heading"><span><MapPin size={16} aria-hidden="true" /> Map location</span><span className="map-location-label">{locationLabel}</span></div>
              <PlaceSearch label="Search city or area" placeholder="Search a city or address" value={searchPlace} onSelect={handleMapPlace} onStatusChange={setNominatimStatus} />
            </div>

            <details className="map-layer-card map-overlay-card">
              <summary><Layers3 size={17} aria-hidden="true" /><span>Map layers</span><ChevronDown className="layer-chevron" size={17} aria-hidden="true" /></summary>
              <div className="layer-list">
                {(['reports', 'zones', 'underpasses', 'routes', 'showDemo'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`layer-toggle ${layers[key] ? 'layer-toggle-on' : ''}`}
                    aria-pressed={layers[key]}
                    onClick={() => updateLayer(key)}
                  >
                    <span className="layer-check" aria-hidden="true">{layers[key] && <Check size={13} />}</span>
                    <span>{layerTitle(key)}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`layer-toggle ${rainfallLayer ? 'layer-toggle-on' : ''}`}
                  aria-pressed={rainfallLayer}
                  onClick={() => setRainfallLayer((current) => !current)}
                >
                  <span className="layer-check" aria-hidden="true">{rainfallLayer && <Check size={13} />}</span>
                  <span>Rainfall at location</span>
                </button>
              </div>
            </details>

            {rainfallLayer && (
              <div className="rainfall-map-card map-overlay-card" role="status">
                <div className="rainfall-map-heading"><CloudRain size={18} aria-hidden="true" /><strong>Rainfall at selected point</strong><button className="icon-button icon-button-small" type="button" aria-label="Hide rainfall summary" onClick={() => setRainfallLayer(false)}><X size={16} aria-hidden="true" /></button></div>
                <p><strong>{formatAmount(weather?.data.currentRainMmHr, 'mm/h')}</strong> current · {formatAmount(weather?.data.todayTotalMm, 'mm')} forecast today</p>
                <p className="rain-advisory-copy">{rainfallRiskMessage}</p>
                <span>{weather?.stale ? 'Last known Open-Meteo data' : weather ? `Open-Meteo · updated ${new Date(weather.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : weatherState.error ? 'Live rainfall is unavailable.' : 'Loading live rainfall…'}</span>
              </div>
            )}

            <div className="map-legend map-overlay-card" aria-label="Map legend">
              <strong>Map legend</strong>
              <div className="legend-items">
                <span><i className="legend-dot legend-dot-ankle" aria-hidden="true" /> Ankle-deep</span>
                <span><i className="legend-dot legend-dot-knee" aria-hidden="true" /> Knee-deep</span>
                <span><i className="legend-dot legend-dot-waist" aria-hidden="true" /> Waist-deep</span>
                <span><i className="legend-dot legend-dot-impassable" aria-hidden="true" /> Impassable</span>
                <span><i className="legend-risk-dot legend-risk-low" aria-hidden="true" /> Low zone</span>
                <span><i className="legend-risk-dot legend-risk-moderate" aria-hidden="true" /> Moderate zone</span>
                <span><i className="legend-risk-dot legend-risk-high" aria-hidden="true" /> High zone</span>
                <span><i className="legend-risk-dot legend-risk-severe" aria-hidden="true" /> Severe zone</span>
                <span><i className="legend-route" aria-hidden="true" /> Selected route</span>
              </div>
            </div>

            {pickingReportPin && (
              <div className="pin-pick-banner map-overlay-card" role="status">
                <MapPin size={18} aria-hidden="true" /><span>Tap the map to place your report pin.</span>
                <button className="text-link" type="button" onClick={() => { setPickingReportPin(false); setReportDialogOpen(true) }}>Cancel</button>
              </div>
            )}

            <div className="map-report-action">
              <Button type="button" className="primary-button" onClick={() => { setPinPoint(mapCenter); setReportDialogOpen(true) }}>
                <MapPin data-icon="inline-start" aria-hidden="true" /> Report waterlogging
              </Button>
            </div>

            <FeaturePanel
              feature={activeFeature}
              onClose={() => setActiveFeature(null)}
              weather={weather}
              weatherLoading={weatherState.isLoading}
              weatherError={weatherState.error as Error | undefined}
              retryWeather={() => void weatherState.mutate(fetchWeather(mapCenter, true), { revalidate: false })}
              river={river}
              riverLoading={riverState.isLoading}
              riverError={riverState.error as Error | undefined}
              retryRiver={() => void riverState.mutate(fetchRiverOutlook(mapCenter, true), { revalidate: false })}
              underpasses={underpasses}
              underpassesLoading={underpassState.isLoading}
              underpassesError={underpassState.error as Error | undefined}
              retryUnderpasses={() => void underpassState.mutate(fetchUnderpasses(mapCenter, true), { revalidate: false })}
              reports={displayedReports}
              activeReports={activeReports}
              zones={zones}
              topZoneName={topZoneState.data?.data}
              zoneUpdatedAt={elevation?.updatedAt ?? weather?.updatedAt}
              elevationAvailable={Boolean(elevation?.data.length)}
              rainfallRiskMessage={rainfallRiskMessage}
              currentLocation={locationStatus === 'live' ? userLocation : mapCenter}
              currentLocationLabel={locationStatus === 'live' ? 'Your location' : `Map center · ${locationLabel}`}
              routeUpdatedAt={routeState.data?.updatedAt}
              routes={routeComparisons}
              routesLoading={routeState.isLoading}
              routesError={routeState.error as Error | undefined}
              selectedRouteId={selectedRouteId}
              onRequestRoutes={handleRequestRoutes}
              onSelectRoute={setSelectedRouteId}
              retryRoutes={() => { if (routeRequest) void routeState.mutate(fetchRoutes(routeRequest.start, routeRequest.destination, true), { revalidate: false }) }}
              onConfirmReport={handleConfirmReport}
              onClearReport={handleClearReport}
            />
          </div>

          {showDemoNotice && (
            <div className="demo-notice section-shell" role="note">
              <AlertTriangle size={20} aria-hidden="true" />
              <p><strong>Demo data included for presentation.</strong> These 18 starter reports are labeled on the map. This notice disappears after a new session report is added.</p>
              <button className="text-link" type="button" onClick={() => setLayers((current) => ({ ...current, showDemo: !current.showDemo }))}>
                {layers.showDemo ? 'Hide demo reports' : 'Show demo reports'}
              </button>
            </div>
          )}

          <div className="map-data-status section-shell" aria-label="Data source status">
            <div className="map-data-status-heading">
              <div><strong>Live source status</strong><span>{lastUpdatedAt ? `Last updated ${new Date(lastUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for the first public response'}</span></div>
              <Button type="button" variant="outline" className="secondary-button data-refresh-button" onClick={() => void refreshPublicData()} disabled={isRefreshing} aria-busy={isRefreshing}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" className={isRefreshing ? 'refresh-icon-spinning' : ''} />
                {isRefreshing ? 'Refreshing' : 'Refresh data'}
              </Button>
            </div>
            <div className="data-source-list">
              <DataSourceStatus icon={CloudRain} label="Rain · Open-Meteo" status={getDataStatus(weather, weatherState.isLoading, weatherState.error)} />
              <DataSourceStatus icon={Waves} label="River · Flood API" status={getDataStatus(river, riverState.isLoading, riverState.error)} />
              <DataSourceStatus icon={MapPin} label="Elevation · Open-Meteo" status={getDataStatus(elevation, elevationState.isLoading, elevationState.error)} />
              <DataSourceStatus icon={MapPin} label="Risky spots · Overpass" status={getDataStatus(underpasses, underpassState.isLoading, underpassState.error)} />
              <DataSourceStatus icon={MapPin} label="Map tiles · OpenStreetMap" status={mapTileStatus} />
              <DataSourceStatus icon={MapPin} label="Place search · Nominatim" status={nominatimStatus === 'responded' ? 'responded' : nominatimStatus === 'failed' ? 'failed' : nominatimStatus === 'loading' ? 'loading' : 'idle'} />
              <DataSourceStatus icon={Navigation} label="Routes · OSRM" status={getDataStatus(routeState.data, routeState.isLoading, routeState.error)} />
              <DataSourceStatus icon={ShieldAlert} label="Community reports" status="session-only" />
            </div>
            <p className="report-storage-note">Reports and votes stay in memory and sync only between open tabs. They are not stored in a database.</p>
          </div>
        </section>

        <FeatureGrid
          weather={weather}
          weatherLoading={weatherState.isLoading}
          weatherError={weatherState.error as Error | undefined}
          retryWeather={() => void weatherState.mutate(fetchWeather(mapCenter, true), { revalidate: false })}
          river={river}
          riverLoading={riverState.isLoading}
          riverError={riverState.error as Error | undefined}
          retryRiver={() => void riverState.mutate(fetchRiverOutlook(mapCenter, true), { revalidate: false })}
          underpasses={underpasses}
          underpassesLoading={underpassState.isLoading}
          underpassesError={underpassState.error as Error | undefined}
          retryUnderpasses={() => void underpassState.mutate(fetchUnderpasses(mapCenter, true), { revalidate: false })}
          reports={displayedReports}
          activeReports={activeReports}
          now={clock}
          zones={zones}
          topZoneName={topZoneState.data?.data}
          zoneUpdatedAt={elevation?.updatedAt ?? weather?.updatedAt}
          elevationAvailable={Boolean(elevation?.data.length)}
          rainfallRiskMessage={rainfallRiskMessage}
          shareLocationLabel={locationStatus === 'live' ? 'Share my location' : 'Share selected map point'}
          onShareLocation={() => void handleShareLocation()}
          onOpen={openFeature}
        />

        <DashboardSection reports={displayedReports} zones={zones} onViewZone={handleViewZone} now={clock} />
        <SafetySection point={locationStatus === 'live' ? userLocation : mapCenter} locationIsDevice={locationStatus === 'live'} />
        <AboutSection onResetDemo={resetDemoReports} />
      </main>

      <footer className="site-footer section-shell">
        <a className="brand footer-brand" href="#top" aria-label="FloodAware home">
          <span className="brand-mark"><MapPin className="brand-pin" size={20} aria-hidden="true" /><Droplets className="brand-drop" size={15} aria-hidden="true" /></span>
          <span className="brand-name">Flood<span>Aware</span><small>Stay informed. Stay safer.</small></span>
        </a>
        <p>Public information only · Conditions change quickly · Follow local authorities</p>
        <a className="footer-top-link" href="#top">Back to top <ChevronDown size={15} aria-hidden="true" /></a>
      </footer>

      {toast && <div className="toast-message" role="status" aria-live="polite"><Check size={18} aria-hidden="true" /> {toast}</div>}
      <ReportDialog
        open={reportDialogOpen}
        point={pinPoint}
        onClose={() => setReportDialogOpen(false)}
        onPickOnMap={() => { setReportDialogOpen(false); setPickingReportPin(true); announce('Tap the map to place the report pin.') }}
        onUseMyLocation={() => locateUser(false, true)}
        onSubmit={async (input) => { handleNewReport(input) }}
        backendReady={false}
      />
    </div>
  )
}
