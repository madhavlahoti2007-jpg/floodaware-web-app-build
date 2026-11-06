'use client'

import { useMemo, useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { AlertTriangle, ArrowDown, ArrowUp, Bell, Bookmark, Check, Clock3, CloudRain, Droplets, Filter, Home, Info, Layers3, MapPin, Minus, Navigation, RefreshCw, Route, School, ShieldAlert, ShieldCheck, Waves, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AboutSection } from '@/components/floodaware/about-section'
import { PlaceSearch } from '@/components/floodaware/place-search'
import { RainChart } from '@/components/floodaware/rain-chart'
import { RoutePlanner } from '@/components/floodaware/route-planner'
import { SafetySection } from '@/components/floodaware/safety-section'
import type { FloodMapType, MapLayers } from '@/components/floodaware/flood-map'
import type { CachedResult, FloodReport, GeoPoint, Place, RiverPayload, RiskZone, RouteComparison, TravelMode, UnderpassSpot, WeatherPayload } from '@/lib/floodaware'
import { distanceMeters, getReportAge, isReportActive } from '@/lib/floodaware'
import { fetchWeather } from '@/lib/floodaware-api'

export type WorkspaceTab = 'overview' | 'layers' | 'reports' | 'routes' | 'weather' | 'hotspots' | 'underpasses' | 'analytics' | 'saved' | 'emergency' | 'settings' | 'about'

export type SavedPlace = GeoPoint & {
  id: string
  label: string
  category: 'home' | 'work' | 'school' | 'custom'
  radius_meters: number
}

type SourceState = 'loading' | 'responded' | 'cached' | 'failed' | 'idle'

export type WorkspacePanelsProps = {
  tab: WorkspaceTab
  now: number
  location: GeoPoint
  locationLabel: string
  reports: FloodReport[]
  activeReports: FloodReport[]
  zones: RiskZone[]
  weather?: CachedResult<WeatherPayload>
  weatherLoading: boolean
  weatherError?: Error
  river?: CachedResult<RiverPayload>
  riverLoading: boolean
  riverError?: Error
  underpasses?: CachedResult<UnderpassSpot[]>
  underpassesLoading: boolean
  underpassesError?: Error
  elevationAvailable: boolean
  rainfallAdvisory: string
  reportSourceState: 'loading' | 'ready' | 'schema-required' | 'failed' | 'not-configured'
  userId: string | null
  profileRole: 'member' | 'moderator' | 'admin' | null
  onModerateReport: (id: string, status: 'active' | 'removed') => void
  layers: MapLayers
  onLayerToggle: (key: keyof MapLayers) => void
  rainfallLayer: boolean
  onToggleRainfall: () => void
  mapType: FloodMapType
  onMapTypeChange: (type: FloodMapType) => void
  onOpenReport: () => void
  onNavigateTab: (tab: WorkspaceTab) => void
  onViewPoint: (point: GeoPoint) => void
  onViewReport: (report: FloodReport) => void
  onConfirmReport: (id: string) => void
  onClearReport: (id: string) => void
  currentLocationLabel: string
  routeUpdatedAt?: number
  routes: RouteComparison[]
  routesLoading: boolean
  routesError?: Error
  selectedRouteId: string | null
  onRequestRoutes: (start: GeoPoint, destination: GeoPoint, mode?: TravelMode) => void
  onSelectRoute: (id: string) => void
  onRetryRoutes: () => void
  onSaveRoute: (route: RouteComparison) => void
  onShareRoute: (route: RouteComparison) => void
  savedPlaces: SavedPlace[]
  savedPlacesState: 'loading' | 'ready' | 'schema-required' | 'failed' | 'signed-out'
  onSavePlace: (place: Place, label: string, category: SavedPlace['category']) => Promise<void>
  onDeletePlace: (id: string) => void
  notificationsEnabled: boolean
  onEnableNotifications: () => void
  onRefresh: () => void
  refreshing: boolean
  dataSources: { name: string; state: SourceState; updatedAt?: number }[]
  autoRefreshMinutes: number
  onAutoRefreshChange: (value: number) => void
  rainfallUnit: 'mm/h' | 'in/h'
  onRainfallUnitChange: (value: 'mm/h' | 'in/h') => void
  distanceUnit: 'km' | 'mi'
  onDistanceUnitChange: (value: 'km' | 'mi') => void
  reduceMotion: boolean
  onReduceMotionChange: (value: boolean) => void
  onClearSavedData: () => void
  accountPanel: ReactNode
  onRetryReports: () => void
}

const severityOrder: Record<FloodReport['severity'], number> = {
  'Ankle-deep': 1,
  'Knee-deep': 2,
  'Waist-deep': 3,
  Impassable: 4,
}

const chartColors = ['#9BD6A8', '#1F5A33', '#FF8A9B', '#C8102E']

function formatNumber(value: number | null | undefined, unit: string, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : 'Unavailable'
}

function formatRainfall(value: number | null | undefined, unit: 'mm/h' | 'in/h') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable'
  return unit === 'mm/h' ? `${value.toFixed(1)} mm/h` : `${(value / 25.4).toFixed(2)} in/h`
}

function updatedLabel(result?: CachedResult<unknown>) {
  if (!result) return 'Waiting for source response'
  const label = new Date(result.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${result.stale ? 'Last known' : 'Updated'} · ${label}`
}

function PanelHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="workspace-panel-heading">
      <div><p className="panel-kicker">{eyebrow}</p><h2>{title}</h2></div>
      {children}
    </div>
  )
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="workspace-empty"><span className="empty-mark"><Info size={19} aria-hidden="true" /></span><strong>{title}</strong><p>{detail}</p>{action}</div>
}

function SeverityLabel({ severity, demo }: { severity: FloodReport['severity']; demo?: boolean }) {
  const marker = severity === 'Ankle-deep' ? '○' : severity === 'Knee-deep' ? '●' : severity === 'Waist-deep' ? '▲' : '◆'
  return <span className={`workspace-severity workspace-severity--${severity.toLowerCase().replace('-deep', '').replace(' ', '-')}`}><span aria-hidden="true">{marker}</span>{severity}{demo && <small>Demo</small>}</span>
}

function OverviewPanel(props: WorkspacePanelsProps) {
  const activeCount = props.activeReports.length
  const highZones = props.zones.filter((zone) => zone.level === 'High' || zone.level === 'Severe').length
  const rain = props.weather?.data.currentRainMmHr
  const rainLevel = rain === null || rain === undefined ? 'Unavailable' : rain >= 7.5 ? 'Heavy' : rain >= 2.5 ? 'Moderate' : 'Light'
  const demoOnly = props.reports.length > 0 && props.reports.every((report) => report.isDemo)
  const metrics = [
    { label: 'Active reports', value: props.reportSourceState === 'loading' ? 'Loading' : String(activeCount), tone: 'mint', detail: demoOnly ? 'Demo sample' : 'Community updates' },
    { label: 'High-risk zones', value: props.weatherLoading && props.zones.length === 0 ? 'Loading' : String(highZones), tone: 'rose', detail: 'Calculated nearby' },
    { label: 'Low spots nearby', value: props.underpassesLoading && !props.underpasses ? 'Loading' : props.underpasses?.data.length.toString() ?? 'Unavailable', tone: 'paper', detail: 'OpenStreetMap tags' },
  ]

  return (
    <>
      <PanelHeading eyebrow="Local situation" title="Overview"><span className="live-badge"><span aria-hidden="true" /> {props.reportSourceState === 'ready' ? 'Live' : demoOnly ? 'Demo mode' : 'Connecting'}</span></PanelHeading>
      {demoOnly && <div className="panel-notice panel-notice--demo" role="note"><AlertTriangle size={17} aria-hidden="true" /><p><strong>Demo data included for presentation.</strong> Each example report is labeled on the map and in lists.</p></div>}
      {props.reportSourceState === 'schema-required' && <div className="panel-notice panel-notice--warning" role="status"><ShieldAlert size={17} aria-hidden="true" /><p>Supabase tables are not set up yet. Community reports below are clearly marked demo data; reporting and account-backed storage are paused.</p></div>}
      <div className="risk-advisory-card"><div className="risk-advisory-icon"><CloudRain size={20} aria-hidden="true" /></div><div><span className="panel-kicker">Rain advisory · {rainLevel}</span><p>{props.rainfallAdvisory}</p></div></div>
      <div className="workspace-metric-grid">
        {metrics.map((metric) => <div className={`workspace-metric workspace-metric--${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>)}
      </div>
      <section className="workspace-panel-section">
        <div className="section-title-row"><div><span className="panel-kicker">Forecast</span><h3>Next 12 hours</h3></div>{props.weather && <span className="timestamp">{updatedLabel(props.weather)}</span>}</div>
        {props.weather?.data.hours.length ? <RainChart hours={props.weather.data.hours.slice(0, 12)} /> : <EmptyState title={props.weatherLoading ? 'Loading forecast' : 'Forecast unavailable'} detail={props.weatherError ? 'Open-Meteo did not respond. Retry from Settings.' : 'No forecast response is available for this location yet.'} />}
      </section>
      <div className="workspace-shortcuts">
        <button type="button" className="workspace-button workspace-button--danger" onClick={props.onOpenReport}><MapPin size={16} aria-hidden="true" /> Report flooding</button>
        <button type="button" className="workspace-button workspace-button--primary" onClick={() => props.onNavigateTab('routes')}><Route size={16} aria-hidden="true" /> Plan a route</button>
        <button type="button" className="workspace-button" onClick={() => props.onNavigateTab('emergency')}><ShieldAlert size={16} aria-hidden="true" /> Emergency info</button>
      </div>
      <p className="workspace-footnote">Showing {props.locationLabel}. Forecast and hazard estimates are advisory only.</p>
    </>
  )
}

function LayersPanel(props: WorkspacePanelsProps) {
  const rows: { key: keyof MapLayers; label: string; help: string }[] = [
    { key: 'reports', label: 'Citizen reports', help: 'Community waterlogging and road closures' },
    { key: 'zones', label: 'Topographic risk zones', help: 'Relative risk derived from reports and public data' },
    { key: 'underpasses', label: 'Low underpasses and dips', help: 'OSM-tagged tunnels, underpasses, and low road segments' },
    { key: 'routes', label: 'Safe route overlay', help: 'Show alternative routes scored against active hazards' },
    { key: 'showDemo', label: 'Show demo reports', help: 'Every example is visibly marked Demo' },
  ]
  return (
    <>
      <PanelHeading eyebrow="Map configuration" title="Layers & legend" />
      <div className="layer-controls">
        {rows.map((row) => <button type="button" className="layer-control-row" key={row.key} aria-pressed={props.layers[row.key]} onClick={() => props.onLayerToggle(row.key)}><span className={`layer-switch ${props.layers[row.key] ? 'layer-switch--on' : ''}`} aria-hidden="true"><span /></span><span className="layer-copy"><strong>{row.label}</strong><small>{row.help}</small></span></button>)}
        <button type="button" className="layer-control-row" aria-pressed={props.rainfallLayer} onClick={props.onToggleRainfall}><span className={`layer-switch ${props.rainfallLayer ? 'layer-switch--on' : ''}`} aria-hidden="true"><span /></span><span className="layer-copy"><strong>Rainfall at selected point</strong><small>{props.weather ? `${formatRainfall(props.weather.data.currentRainMmHr, props.rainfallUnit)} · Open-Meteo` : 'Live forecast overlay'}</small></span></button>
        <div className="layer-control-row layer-control-row--disabled" aria-disabled="true"><span className="layer-switch" aria-hidden="true"><span /></span><span className="layer-copy"><strong>Traffic layer</strong><small>Requires a configured Google Maps key</small></span></div>
      </div>
      <section className="workspace-panel-section">
        <div className="section-title-row"><div><span className="panel-kicker">Map style</span><h3>Choose a base layer</h3></div></div>
        <div className="map-style-options" role="group" aria-label="Map type">
          {(['roadmap', 'satellite', 'terrain'] as const).map((type) => <button key={type} type="button" className={props.mapType === type ? 'is-selected' : ''} aria-pressed={props.mapType === type} onClick={() => props.onMapTypeChange(type)}>{type === 'roadmap' ? 'Roadmap' : type === 'satellite' ? 'Satellite' : 'Terrain'}</button>)}
        </div>
        <p className="panel-disclaimer">Google Maps is not configured; standard OpenStreetMap tiles are active. Street View and traffic require a Google Maps key.</p>
      </section>
      <div className="legend-grid" aria-label="Flood map legend">
        <div className="legend-row"><span className="legend-marker legend-marker--ankle" aria-hidden="true" /><span><strong>Ankle-deep</strong><small>Passable for most vehicles</small></span></div>
        <div className="legend-row"><span className="legend-marker legend-marker--knee" aria-hidden="true" /><span><strong>Knee-deep</strong><small>Caution for low-clearance cars</small></span></div>
        <div className="legend-row"><span className="legend-marker legend-marker--waist" aria-hidden="true">!</span><span><strong>Waist-deep</strong><small>Severe obstruction · avoid</small></span></div>
        <div className="legend-row"><span className="legend-marker legend-marker--blocked" aria-hidden="true">×</span><span><strong>Impassable</strong><small>Road reported blocked</small></span></div>
        <div className="legend-row"><span className="legend-zone legend-zone--low" aria-hidden="true" /><span><strong>Low to moderate zone</strong><small>Relative advisory boundary</small></span></div>
        <div className="legend-row"><span className="legend-zone legend-zone--high" aria-hidden="true" /><span><strong>High to severe zone</strong><small>Check reports before travel</small></span></div>
        <div className="legend-row"><span className="legend-route legend-route--safe" aria-hidden="true" /><span><strong>Safest route</strong><small>Recommended by hazard score</small></span></div>
        <div className="legend-row"><span className="legend-route legend-route--other" aria-hidden="true" /><span><strong>Other alternatives</strong><small>Compare time and exposure</small></span></div>
      </div>
    </>
  )
}

function ReportsPanel(props: WorkspacePanelsProps) {
  const [filter, setFilter] = useState<'all' | 'hour' | 'six-hours' | 'mine' | FloodReport['severity']>('all')
  const [sort, setSort] = useState<'recent' | 'severity'>('recent')
  const filtered = useMemo(() => {
    const cutoff = filter === 'hour' ? props.now - 60 * 60_000 : filter === 'six-hours' ? props.now - 6 * 60 * 60_000 : null
    const items = props.reports.filter((report) => {
      if (filter === 'mine') return Boolean(props.userId && report.reporterId === props.userId)
      if (filter in severityOrder) return report.severity === filter
      if (cutoff) return report.createdAt >= cutoff
      return true
    })
    return items.sort((left, right) => sort === 'recent' ? right.createdAt - left.createdAt : severityOrder[right.severity] - severityOrder[left.severity])
  }, [filter, props.now, props.reports, props.userId, sort])
  const demoOnly = props.reports.length > 0 && props.reports.every((report) => report.isDemo)
  const filters: Array<{ key: typeof filter; label: string }> = [
    { key: 'all', label: 'All' }, { key: 'hour', label: 'Last hour' }, { key: 'six-hours', label: 'Last 6 hours' },
    { key: 'Ankle-deep', label: 'Ankle' }, { key: 'Knee-deep', label: 'Knee' }, { key: 'Waist-deep', label: 'Waist' }, { key: 'Impassable', label: 'Blocked' }, { key: 'mine', label: 'Mine' },
  ]
  return (
    <>
      <PanelHeading eyebrow="Community intelligence" title="Flood reports"><button type="button" className="workspace-icon-button" aria-label="Retry reports" onClick={props.onRetryReports}><RefreshCw size={16} aria-hidden="true" /></button></PanelHeading>
      {props.reportSourceState === 'schema-required' && <div className="panel-notice panel-notice--warning" role="status"><ShieldAlert size={17} aria-hidden="true" /><p>Supabase reports are not initialized. Showing only labeled demo entries; live reporting, confirmations, and comments are unavailable.</p></div>}
      {demoOnly && <div className="panel-notice panel-notice--demo" role="note"><AlertTriangle size={16} aria-hidden="true" /><p>Demo data included for presentation. Examples are not live incidents.</p></div>}
      <div className="report-toolbar"><span className="panel-kicker"><Filter size={14} aria-hidden="true" /> Filter by time or depth</span><label className="sort-control">Sort<select value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'severity')}><option value="recent">Newest</option><option value="severity">Severity</option></select></label></div>
      <div className="report-filter-list" role="group" aria-label="Filter flood reports">{filters.map((item) => <button key={item.key} type="button" className={filter === item.key ? 'is-selected' : ''} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
      <button type="button" className="workspace-button workspace-button--danger workspace-button--wide" onClick={props.onOpenReport}><MapPin size={16} aria-hidden="true" /> Report waterlogging incident</button>
      {filtered.length ? <ul className="report-record-list">{filtered.map((report) => <li className="report-record" key={report.id}>
        <button type="button" className="report-record-main" onClick={() => props.onViewReport(report)}><div className="report-record-top"><SeverityLabel severity={report.severity} demo={report.isDemo} /><span className="report-age"><Clock3 size={13} aria-hidden="true" /> {getReportAge(report.createdAt, props.now)}</span></div><p>{report.description}</p><span className="report-record-meta"><MapPin size={13} aria-hidden="true" /> {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)} · {report.confirmations} confirmations</span></button>
        {isReportActive(report, props.now) && <div className="report-record-actions"><button type="button" onClick={() => props.onConfirmReport(report.id)}><Check size={14} aria-hidden="true" /> Confirm</button><button type="button" onClick={() => props.onClearReport(report.id)}><X size={14} aria-hidden="true" /> It&apos;s cleared</button>{!report.isDemo && (props.profileRole === 'moderator' || props.profileRole === 'admin') && <button type="button" onClick={() => props.onModerateReport(report.id, 'removed')}><X size={14} aria-hidden="true" /> Remove</button>}</div>}
      </li>)}</ul> : <EmptyState title="No reports match this filter" detail="Try a different time range or severity." />}
      <p className="panel-disclaimer">Reports expire after six hours unless reconfirmed. Three authenticated clear votes resolve a report. Follow official local warnings.</p>
    </>
  )
}

function WeatherPanel(props: WorkspacePanelsProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const hours = props.weather?.data.hours ?? []
  const peak = hours.reduce<{ value: number; time: string } | null>((best, hour) => {
    if (hour.precipitationMm === null) return best
    return !best || hour.precipitationMm > best.value ? { value: hour.precipitationMm, time: hour.time } : best
  }, null)
  return (
    <>
      <PanelHeading eyebrow="Public forecast data" title="Weather & rivers"><span className={`trend-pill trend-pill--${(props.river?.data.trend ?? 'unavailable').toLowerCase()}`}>{props.river?.data.trend === 'Rising' ? <ArrowUp size={14} aria-hidden="true" /> : props.river?.data.trend === 'Falling' ? <ArrowDown size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}{props.river?.data.trend ?? 'Loading'}</span></PanelHeading>
      <div className="weather-summary-grid"><div className="workspace-metric workspace-metric--mint"><span>Current rain</span><strong>{formatRainfall(props.weather?.data.currentRainMmHr, props.rainfallUnit)}</strong><small>Open-Meteo forecast</small></div><div className="workspace-metric workspace-metric--paper"><span>Today&apos;s total</span><strong>{formatNumber(props.weather?.data.todayTotalMm, 'mm')}</strong><small>Daily precipitation estimate</small></div></div>
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">Hourly forecast</span><h3>Precipitation · next 12 hours</h3></div><div className="segmented-control" role="group" aria-label="Forecast display"><button type="button" aria-pressed={view === 'chart'} className={view === 'chart' ? 'is-selected' : ''} onClick={() => setView('chart')}>Chart</button><button type="button" aria-pressed={view === 'table'} className={view === 'table' ? 'is-selected' : ''} onClick={() => setView('table')}>Table</button></div></div>
        {props.weatherLoading && !props.weather ? <EmptyState title="Loading rainfall" detail="Requesting the latest hourly forecast." /> : props.weatherError && !props.weather ? <EmptyState title="Forecast unavailable" detail="The Open-Meteo forecast endpoint did not respond." /> : view === 'chart' && hours.length ? <RainChart hours={hours} /> : hours.length ? <div className="accessible-table-wrap"><table className="workspace-table"><caption className="sr-only">Hourly precipitation forecast from Open-Meteo</caption><thead><tr><th scope="col">Local time</th><th scope="col">Rain</th><th scope="col">Chance</th></tr></thead><tbody>{hours.map((hour) => <tr key={hour.time}><th scope="row">{new Date(hour.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</th><td>{formatNumber(hour.precipitationMm, 'mm')}</td><td>{formatNumber(hour.probability, '%', 0)}</td></tr>)}</tbody></table></div> : <EmptyState title="No forecast values" detail="No hourly precipitation values were returned for this location." />}
        {peak && <p className="panel-notice"><Droplets size={16} aria-hidden="true" /><span>Forecast peak: {peak.value.toFixed(1)} mm around {new Date(peak.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</span></p>}
        <p className="timestamp">{updatedLabel(props.weather)}</p>
      </section>
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">Flood API · modeled outlook</span><h3>River discharge</h3></div><span className="trend-pill">{props.river?.data.trend ?? 'Unavailable'}</span></div>
        <div className="river-current-card"><Waves size={20} aria-hidden="true" /><div><span>Daily discharge</span><strong>{formatNumber(props.river?.data.currentDischarge, 'm³/s')}</strong></div></div>
        {props.river?.data.series.length ? <div className="river-series-list">{props.river.data.series.slice(-7).map((item) => <div key={item.date}><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span><strong>{formatNumber(item.discharge, 'm³/s')}</strong></div>)}</div> : <EmptyState title={props.riverLoading ? 'Loading river outlook' : 'River data unavailable'} detail="The Flood API may not cover every waterway." />}
        <p className="panel-disclaimer">River discharge is modeled public data, not a live gauge reading.</p>
      </section>
    </>
  )
}

function HotspotsPanel(props: WorkspacePanelsProps) {
  const ranked = [...props.zones].sort((a, b) => b.score - a.score)
  const counts = ['Low', 'Moderate', 'High', 'Severe'].map((level) => ({ level, count: props.zones.filter((zone) => zone.level === level).length }))
  return (
    <>
      <PanelHeading eyebrow="Computed from public signals" title="Flood hotspots" />
      <div className="hotspot-summary-grid">{counts.map((item) => <div className={`hotspot-summary hotspot-summary--${item.level.toLowerCase()}`} key={item.level}><span>{item.level}</span><strong>{item.count}</strong><small>{item.count === 1 ? 'zone' : 'zones'}</small></div>)}</div>
      <div className="panel-notice"><ShieldAlert size={17} aria-hidden="true" /><p>Scores combine report severity, recency, confirmations, rainfall, and coarse elevation. These are relative advisories, not flood boundaries.</p></div>
      {ranked.length ? <ul className="hotspot-list">{ranked.map((zone) => <li key={zone.id}><div className="hotspot-row"><span className={`zone-indicator zone-indicator--${zone.level.toLowerCase()}`} aria-hidden="true" /><div className="hotspot-copy"><strong>{zone.level} risk · {zone.report.severity}</strong><p>{zone.report.description}</p><small>{zone.report.isDemo ? 'Demo · ' : ''}Score {zone.score}/100 · about {zone.radius} m</small></div><button className="workspace-icon-button" type="button" aria-label={`View ${zone.level} risk on map`} onClick={() => props.onViewReport(zone.report)}><Navigation size={16} aria-hidden="true" /></button></div></li>)}</ul> : <EmptyState title="No active report hotspots" detail="Risk zones appear when the selected area has active reports." />}
    </>
  )
}

function UnderpassesPanel(props: WorkspacePanelsProps) {
  const spots = props.underpasses?.data ?? []
  return (
    <>
      <PanelHeading eyebrow="OpenStreetMap · 3 km radius" title="Underpasses & low spots"><span className="tag-chip">Known low points</span></PanelHeading>
      <div className="panel-notice"><MapPin size={17} aria-hidden="true" /><p>These are mapped underpasses, tunnels, and low road segments—not confirmed flooding.</p></div>
      {props.underpassesLoading && !props.underpasses ? <EmptyState title="Searching OpenStreetMap" detail="Looking for mapped low spots near this location." /> : props.underpassesError && !props.underpasses ? <EmptyState title="OpenStreetMap is unavailable" detail="The Overpass endpoint did not respond." action={<button type="button" className="text-link" onClick={() => props.onRefresh()}>Retry</button>} /> : spots.length ? <ul className="underpass-list">{spots.map((spot) => <li key={spot.id}><span className="underpass-symbol" aria-hidden="true">U</span><div><strong>{spot.name}</strong><span>{spot.kind} · {distanceMeters(props.location, spot).toFixed(0)} m away</span><small>{spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}</small></div><button className="workspace-icon-button" type="button" aria-label={`Show ${spot.name} on map`} onClick={() => props.onViewPoint({ latitude: spot.latitude, longitude: spot.longitude })}><Navigation size={15} aria-hidden="true" /></button></li>)}</ul> : <EmptyState title="No tagged low spots nearby" detail="No matching underpass tags were returned for this 3 km search." />}
      <p className="timestamp">{updatedLabel(props.underpasses)}</p>
    </>
  )
}

function AnalyticsPanel(props: WorkspacePanelsProps) {
  const recent = useMemo(() => {
    const day = 24 * 60 * 60_000
    return Array.from({ length: 7 }, (_, index) => {
      const start = props.now - (6 - index) * day
      const end = start + day
      const count = props.reports.filter((report) => report.createdAt >= start && report.createdAt < end).length
      return { day: new Date(start).toLocaleDateString([], { weekday: 'short' }), count }
    })
  }, [props.now, props.reports])
  const severity = ['Ankle-deep', 'Knee-deep', 'Waist-deep', 'Impassable'].map((name) => ({ name, value: props.reports.filter((report) => report.severity === name).length }))
  const resolvedToday = props.reports.filter((report) => report.resolvedAt && new Date(report.resolvedAt).toDateString() === new Date(props.now).toDateString()).length
  const metrics = [
    { label: 'Active reports', value: props.activeReports.length },
    { label: 'High-risk areas', value: props.zones.filter((zone) => zone.level === 'High' || zone.level === 'Severe').length },
    { label: 'Reports · 24 h', value: props.reports.filter((report) => props.now - report.createdAt <= 24 * 60 * 60_000).length },
    { label: 'Resolved today', value: resolvedToday },
  ]
  const demoOnly = props.reports.length > 0 && props.reports.every((report) => report.isDemo)
  return (
    <>
      <PanelHeading eyebrow="Community signals" title="Analytics">{demoOnly && <span className="tag-chip">Demo sample</span>}</PanelHeading>
      {demoOnly && <div className="panel-notice panel-notice--demo"><AlertTriangle size={16} aria-hidden="true" /><p>Counts and charts below reflect labeled demo entries only.</p></div>}
      <div className="analytics-metric-grid">{metrics.map((item) => <div className="workspace-metric" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{demoOnly ? 'Demo sample' : 'Supabase reports'}</small></div>)}</div>
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">Seven-day view</span><h3>Reports over time</h3></div></div><div className="workspace-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={recent} margin={{ top: 8, right: 4, left: -28, bottom: 0 }}><CartesianGrid stroke="rgba(242,241,236,.10)" vertical={false} /><XAxis dataKey="day" tick={{ fill: '#F2F1EC', fontSize: 12 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: '#F2F1EC', fontSize: 12 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: '#1E2022', border: '1px solid rgba(242,241,236,.18)', borderRadius: 12, color: '#F2F1EC' }} /><Bar dataKey="count" name="Reports" fill="#9BD6A8" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">By reported depth</span><h3>Severity breakdown</h3></div></div>{props.reports.length ? <div className="severity-chart-row"><div className="workspace-pie-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={severity} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={3}>{severity.map((item, index) => <Cell key={item.name} fill={chartColors[index]} />)}</Pie><Tooltip contentStyle={{ background: '#1E2022', border: '1px solid rgba(242,241,236,.18)', borderRadius: 12, color: '#F2F1EC' }} /></PieChart></ResponsiveContainer></div><ul className="chart-legend">{severity.map((item, index) => <li key={item.name}><span style={{ background: chartColors[index] }} aria-hidden="true" /><span>{item.name}</span><strong>{item.value}</strong></li>)}</ul></div> : <EmptyState title="No report data yet" detail="Severity distribution will appear when reports are available." />}</section>
      <p className="panel-disclaimer">Busiest areas are ranked from available report coordinates; no location is inferred when there is no report data.</p>
    </>
  )
}

function SavedPlaceCard({ place, reports, now, onView, onDelete, distanceUnit }: { place: SavedPlace; reports: FloodReport[]; now: number; onView: (point: GeoPoint) => void; onDelete: (id: string) => void; distanceUnit: 'km' | 'mi' }) {
  const nearby = reports.filter((report) => isReportActive(report, now) && distanceMeters(place, report) <= place.radius_meters)
  const weatherState = useSWR(`saved-weather:${place.latitude.toFixed(3)}:${place.longitude.toFixed(3)}`, () => fetchWeather(place), { refreshInterval: 10 * 60_000, dedupingInterval: 60_000 })
  const weather = weatherState.data?.data.currentRainMmHr
  const icon = place.category === 'home' ? <Home size={15} aria-hidden="true" /> : place.category === 'school' ? <School size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />
  const distLabel = distanceUnit === 'mi' ? `${(place.radius_meters / 1609.34).toFixed(1)} mi radius` : `${(place.radius_meters / 1000).toFixed(1)} km radius`
  return <li className="saved-place-card"><div className="saved-place-heading"><span className="saved-place-category">{icon}{place.category}</span><div className="saved-place-actions"><button className="workspace-icon-button" type="button" aria-label={`View ${place.label} on map`} onClick={() => onView(place)}><Navigation size={15} aria-hidden="true" /></button><button className="workspace-icon-button" type="button" aria-label={`Remove ${place.label}`} onClick={() => onDelete(place.id)}><X size={15} aria-hidden="true" /></button></div></div><strong>{place.label}</strong><span className="saved-place-coordinate">{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)} · {distLabel}</span><div className="saved-place-live"><span><CloudRain size={14} aria-hidden="true" /> {weather === undefined ? 'Loading rain…' : formatRainfall(weather, 'mm/h')}</span><span><AlertTriangle size={14} aria-hidden="true" /> {nearby.length} nearby {nearby.length === 1 ? 'report' : 'reports'}</span></div></li>
}

function SavedPanel(props: WorkspacePanelsProps) {
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<SavedPlace['category']>('home')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPlace) { setFormError('Search for and select a place first.'); return }
    if (!label.trim()) { setFormError('Add a short label for this place.'); return }
    setSaving(true)
    setFormError('')
    try { await props.onSavePlace(selectedPlace, label.trim(), category); setSelectedPlace(null); setLabel('') }
    catch (error) { setFormError(error instanceof Error ? error.message : 'The place could not be saved.') }
    finally { setSaving(false) }
  }
  return (
    <>
      <PanelHeading eyebrow="Personal alerts" title="Saved places & alerts"><span className={props.notificationsEnabled ? 'tag-chip tag-chip--active' : 'tag-chip'}><Bell size={13} aria-hidden="true" /> {props.notificationsEnabled ? 'Notifications on' : 'Notifications off'}</span></PanelHeading>
      {props.savedPlacesState === 'signed-out' && <><EmptyState title="Sign in to save places" detail="Saved locations and alert preferences are private to your account." />{props.accountPanel}</>}
      {props.savedPlacesState === 'schema-required' && <div className="panel-notice panel-notice--warning" role="status"><ShieldAlert size={17} aria-hidden="true" /><p>Saved places and alert preferences need the Supabase schema, which has not been applied.</p></div>}
      {props.savedPlacesState === 'failed' && <EmptyState title="Saved places could not load" detail="The account data service did not respond." />}
      {props.savedPlacesState === 'ready' && <>
        <form className="workspace-form saved-place-form" onSubmit={handleSave}>
          <label className="workspace-label" htmlFor="saved-place-search">Add a place</label>
          <PlaceSearch label="Search saved place" placeholder="Search a home, work, or school address" value={selectedPlace} onSelect={setSelectedPlace} />
          <div className="saved-place-form-row"><label className="workspace-field"><span className="workspace-label">Label</span><input className="workspace-input" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} placeholder="e.g. Home" /></label><label className="workspace-field"><span className="workspace-label">Type</span><select className="workspace-input" value={category} onChange={(event) => setCategory(event.target.value as SavedPlace['category'])}><option value="home">Home</option><option value="work">Work</option><option value="school">School</option><option value="custom">Other</option></select></label></div>
          {formError && <p className="workspace-message workspace-message--error" role="alert">{formError}</p>}
          <button className="workspace-button workspace-button--primary workspace-button--wide" type="submit" disabled={saving}><Bookmark size={15} aria-hidden="true" /> {saving ? 'Saving…' : 'Save place'}</button>
        </form>
        {props.savedPlaces.length ? <ul className="saved-place-list">{props.savedPlaces.map((place) => <SavedPlaceCard key={place.id} place={place} reports={props.activeReports} now={props.now} onView={props.onViewPoint} onDelete={props.onDeletePlace} distanceUnit={props.distanceUnit} />)}</ul> : <EmptyState title="No saved places yet" detail="Add home, work, or school to monitor nearby reports." />}
        <div className="notification-card"><div><strong>Browser notifications</strong><p>Ask permission only when you choose to enable nearby alerts.</p></div><button type="button" className="workspace-button" onClick={props.onEnableNotifications} disabled={props.notificationsEnabled}><Bell size={15} aria-hidden="true" /> {props.notificationsEnabled ? 'Enabled' : 'Enable alerts'}</button></div>
      </>}
    </>
  )
}

function SettingsPanel(props: WorkspacePanelsProps) {
  return (
    <>
      <PanelHeading eyebrow="Account & preferences" title="Settings" />
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">Profile</span><h3>Sign in and preferences</h3></div></div>{props.accountPanel}</section>
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">Display</span><h3>Accessibility & units</h3></div></div>
        <label className="settings-row"><span><strong>Rainfall units</strong><small>Display rain as an hourly rate</small></span><select className="workspace-input workspace-input--compact" value={props.rainfallUnit} onChange={(event) => props.onRainfallUnitChange(event.target.value as 'mm/h' | 'in/h')}><option value="mm/h">mm/h</option><option value="in/h">in/h</option></select></label>
        <label className="settings-row"><span><strong>Distance units</strong><small>Route and saved place distances</small></span><select className="workspace-input workspace-input--compact" value={props.distanceUnit} onChange={(event) => props.onDistanceUnitChange(event.target.value as 'km' | 'mi')}><option value="km">Kilometres</option><option value="mi">Miles</option></select></label>
        <label className="settings-row"><span><strong>Automatic refresh</strong><small>Refresh live rainfall and reports</small></span><select className="workspace-input workspace-input--compact" value={props.autoRefreshMinutes} onChange={(event) => props.onAutoRefreshChange(Number(event.target.value))}><option value={5}>5 minutes</option><option value={10}>10 minutes</option><option value={20}>20 minutes</option><option value={30}>30 minutes</option></select></label>
        <label className="settings-row"><span><strong>Reduce motion</strong><small>Disable decorative map and panel motion</small></span><input type="checkbox" checked={props.reduceMotion} onChange={(event) => props.onReduceMotionChange(event.target.checked)} /></label>
        <label className="settings-row"><span><strong>Show demo reports</strong><small>Examples are always marked Demo</small></span><input type="checkbox" checked={props.layers.showDemo} onChange={() => props.onLayerToggle('showDemo')} /></label>
        <button type="button" className="workspace-button workspace-button--danger" onClick={props.onClearSavedData}><X size={15} aria-hidden="true" /> Clear my saved places and routes</button>
      </section>
      <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">System telemetry</span><h3>Data sources</h3></div><button className="workspace-icon-button" type="button" aria-label="Refresh data sources" onClick={props.onRefresh} disabled={props.refreshing}><RefreshCw size={15} aria-hidden="true" className={props.refreshing ? 'is-spinning' : ''} /></button></div><div className="source-list">{props.dataSources.map((source) => <div className="source-row" key={source.name}><span className={`source-dot source-dot--${source.state}`} aria-hidden="true" /><span>{source.name}</span><strong>{source.state === 'responded' ? 'Responded' : source.state === 'cached' ? 'Cached' : source.state === 'failed' ? 'Failed' : source.state === 'loading' ? 'Loading' : 'Not requested'}</strong>{source.updatedAt && <small>{new Date(source.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>}</div>)}</div></section>
      {(props.profileRole === 'moderator' || props.profileRole === 'admin') && <section className="workspace-panel-section"><div className="section-title-row"><div><span className="panel-kicker">Moderation</span><h3>Admin tools</h3></div><span className="account-role"><ShieldCheck size={14} aria-hidden="true" /> {props.profileRole}</span></div><p className="panel-disclaimer">Community reports are public. Removal actions are recorded in the moderation audit log.</p>{props.reports.filter((report) => !report.isDemo).length ? <ul className="admin-report-list">{props.reports.filter((report) => !report.isDemo && !report.resolved).slice(0, 8).map((report) => <li key={report.id}><span><strong>{report.severity}</strong><small>{report.description}</small></span><button type="button" className="workspace-button workspace-button--danger" onClick={() => props.onModerateReport(report.id, 'removed')}>Remove</button></li>)}</ul> : <EmptyState title="No community reports to moderate" detail="Verified, non-demo reports will appear here." />}</section>}
      <div className="panel-notice panel-notice--warning"><AlertTriangle size={16} aria-hidden="true" /><p>Supabase persistence is not active until its schema, Storage bucket, and report function are applied and deployed.</p></div>
      <p className="panel-disclaimer">System telemetry: {props.reportSourceState === 'ready' ? 'Live' : props.reportSourceState === 'schema-required' ? 'Demo mode' : 'Connecting'} · Map: OpenStreetMap · Follow official local warnings.</p>
    </>
  )
}

export function WorkspaceTabContent(props: WorkspacePanelsProps) {
  switch (props.tab) {
    case 'overview': return <OverviewPanel {...props} />
    case 'layers': return <LayersPanel {...props} />
    case 'reports': return <ReportsPanel {...props} />
    case 'routes': return <>
      <PanelHeading eyebrow="Advisory route planning" title="Safe route planner"><span className="tag-chip">OSRM fallback</span></PanelHeading>
      <div className="panel-notice"><Navigation size={16} aria-hidden="true" /><p>Route alternatives are scored against active reports. Google Routes is unavailable without a Maps key.</p></div>
      <RoutePlanner currentLocation={props.location} currentLocationLabel={props.currentLocationLabel} updatedAt={props.routeUpdatedAt} reports={props.reports} routes={props.routes} isLoading={props.routesLoading} error={props.routesError} selectedRouteId={props.selectedRouteId} onRequestRoutes={props.onRequestRoutes} onSelectRoute={props.onSelectRoute} onRetry={props.onRetryRoutes} onSaveRoute={props.onSaveRoute} onShareRoute={props.onShareRoute} distanceUnit={props.distanceUnit} />
      <div className="panel-notice"><ShieldAlert size={16} aria-hidden="true" /><p>Advisory only. A route score cannot guarantee road conditions or safety.</p></div>
    </>
    case 'weather': return <WeatherPanel {...props} />
    case 'hotspots': return <HotspotsPanel {...props} />
    case 'underpasses': return <UnderpassesPanel {...props} />
    case 'analytics': return <AnalyticsPanel {...props} />
    case 'saved': return <SavedPanel {...props} />
    case 'emergency': return <><PanelHeading eyebrow="Emergency information" title="Safety & help" /><SafetySection point={props.location} locationIsDevice={props.currentLocationLabel === 'Your location'} /><div className="emergency-local"><h3>National response</h3><p>112 · Emergency response</p><p>108 · Ambulance</p><p>For local disaster-management numbers, follow the latest district authority guidance.</p></div></>
    case 'settings': return <SettingsPanel {...props} />
    case 'about': return <><PanelHeading eyebrow="FloodAware" title="About this service" /><AboutSection onResetDemo={() => undefined} /></>
  }
}
