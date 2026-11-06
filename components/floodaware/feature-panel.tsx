'use client'

import { AlertTriangle, ArrowDown, ArrowUp, Clock3, Droplets, MapPin, Minus, ShieldAlert, Waves, X } from 'lucide-react'
import type { CachedResult, FloodReport, GeoPoint, RiverPayload, RiskZone, RouteComparison, UnderpassSpot, WeatherPayload } from '@/lib/floodaware'
import { getReportAge, isReportActive } from '@/lib/floodaware'
import { RainChart } from '@/components/floodaware/rain-chart'
import { RoutePlanner } from '@/components/floodaware/route-planner'
import type { FeatureKey } from '@/components/floodaware/feature-grid'

const featureTitle: Record<FeatureKey, string> = {
  rainfall: 'Rainfall right now',
  forecast: '12-hour rain forecast',
  river: 'River flood outlook',
  reports: 'Community flood reports',
  zones: 'Flood-prone zones',
  underpasses: 'Known risky spots',
  routes: 'Safest route planner',
  safety: 'Emergency & safety',
}

function amount(value: number | null | undefined, suffix: string) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : 'Not available'
}

function UpdatedAt({ result }: { result?: CachedResult<unknown> }) {
  if (!result) return null
  return <p className="panel-updated">{result.stale ? 'Last known response' : 'Updated'} · {new Date(result.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
}

type FeaturePanelProps = {
  feature: FeatureKey | null
  onClose: () => void
  weather?: CachedResult<WeatherPayload>
  weatherLoading: boolean
  weatherError?: Error
  retryWeather: () => void
  river?: CachedResult<RiverPayload>
  riverLoading: boolean
  riverError?: Error
  retryRiver: () => void
  underpasses?: CachedResult<UnderpassSpot[]>
  underpassesLoading: boolean
  underpassesError?: Error
  retryUnderpasses: () => void
  reports: FloodReport[]
  activeReports: FloodReport[]
  zones: RiskZone[]
  topZoneName?: string
  zoneUpdatedAt?: number
  elevationAvailable: boolean
  rainfallRiskMessage: string
  currentLocation: GeoPoint
  currentLocationLabel: string
  routeUpdatedAt?: number
  routes: RouteComparison[]
  routesLoading: boolean
  routesError?: Error
  selectedRouteId: string | null
  onRequestRoutes: (start: GeoPoint, destination: GeoPoint) => void
  onSelectRoute: (id: string) => void
  retryRoutes: () => void
  onConfirmReport: (id: string) => void
  onClearReport: (id: string) => void
}

export function FeaturePanel(props: FeaturePanelProps) {
  const { feature, onClose } = props
  if (!feature) return null

  const activeReports = props.activeReports
  const items = feature === 'reports'
    ? [...props.reports].sort((a, b) => b.createdAt - a.createdAt)
    : []
  const highZones = props.zones.filter((zone) => zone.level === 'High' || zone.level === 'Severe').sort((a, b) => b.score - a.score)

  return (
    <aside className="map-feature-panel" aria-labelledby="map-feature-title">
      <div className="map-feature-panel-heading">
        <div>
          <p className="eyebrow">FloodAware insights</p>
          <h2 id="map-feature-title">{featureTitle[feature]}</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Close insights panel" onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="map-feature-panel-content">
        {(feature === 'rainfall' || feature === 'forecast') && (
          <section className="panel-section">
            <div className="panel-metrics">
              <div><span>Current rain</span><strong>{amount(props.weather?.data.currentRainMmHr, 'mm/h')}</strong></div>
              <div><span>Today&apos;s forecast total</span><strong>{amount(props.weather?.data.todayTotalMm, 'mm')}</strong></div>
            </div>
            {props.weather?.data.hours.length ? <RainChart hours={props.weather.data.hours} /> : (
              <div className="panel-empty">
                <Droplets size={24} aria-hidden="true" />
                <p>{props.weatherLoading ? 'Loading the live forecast…' : 'Rainfall data is not available for this location.'}</p>
                {props.weatherError && <button className="text-link" type="button" onClick={props.retryWeather}>Retry</button>}
              </div>
            )}
            <div className="panel-banner rain-advisory-banner"><AlertTriangle size={17} aria-hidden="true" /><p>{props.rainfallRiskMessage}</p></div>
            <UpdatedAt result={props.weather} />
            <p className="panel-disclaimer">Rainfall is a point forecast from Open-Meteo. Conditions can differ across nearby streets.</p>
          </section>
        )}

        {feature === 'river' && (
          <section className="panel-section">
            <div className="river-summary">
              <span className="river-icon"><Waves size={21} aria-hidden="true" /></span>
              <div><span>Daily discharge</span><strong>{amount(props.river?.data.currentDischarge, 'm³/s')}</strong></div>
              {props.river?.data.currentDischarge !== null && props.river?.data.currentDischarge !== undefined && (
                <span className={`trend-pill trend-pill--${props.river.data.trend.toLowerCase()}`}>
                  {props.river.data.trend === 'Rising' ? <ArrowUp size={15} aria-hidden="true" /> : props.river.data.trend === 'Falling' ? <ArrowDown size={15} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}
                  {props.river.data.trend}
                </span>
              )}
            </div>
            {props.river?.data.series.length ? (
              <div className="river-series">
                {props.river.data.series.slice(-5).map((entry) => (
                  <div className="river-series-row" key={entry.date}>
                    <span>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${entry.date}T12:00:00`))}</span>
                    <strong>{amount(entry.discharge, 'm³/s')}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-empty"><Waves size={24} aria-hidden="true" /><p>{props.riverLoading ? 'Loading river outlook…' : 'River discharge is unavailable for this location.'}</p>{props.riverError && <button className="text-link" type="button" onClick={props.retryRiver}>Retry</button>}</div>
            )}
            <UpdatedAt result={props.river} />
            <p className="panel-disclaimer">River data may not cover every local waterway. No discharge value is inferred when the source has no coverage.</p>
          </section>
        )}

        {feature === 'reports' && (
          <section className="panel-section">
            <div className="panel-banner"><AlertTriangle size={17} aria-hidden="true" /><p>{activeReports.length ? `${activeReports.length} active report${activeReports.length === 1 ? '' : 's'} in this browser session.` : 'No active reports in this browser session.'} Demo entries are labeled.</p></div>
            <ul className="panel-report-list">
              {items.map((report) => (
                <li className="panel-report-item" key={report.id}>
                  <div className="panel-report-topline">
                    <span className={`severity-pill severity-pill--${report.severity.toLowerCase().replace('-deep', '').replace(' ', '-')}`}><AlertTriangle size={14} aria-hidden="true" /> {report.severity}</span>
                    {report.isDemo && <span className="demo-pill">Demo</span>}
                    {!isReportActive(report) && <span className="resolved-pill">Resolved / expired</span>}
                    <span className="panel-report-age"><Clock3 size={14} aria-hidden="true" /> {getReportAge(report.createdAt)}</span>
                  </div>
                  <p>{report.description}</p>
                  <span className="panel-report-coordinates"><MapPin size={14} aria-hidden="true" /> {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)} · {report.confirmations} confirmations</span>
                  {isReportActive(report) && (
                    <div className="panel-report-actions">
                      <button className="secondary-action" type="button" onClick={() => props.onConfirmReport(report.id)}>Confirm report</button>
                      <button className="secondary-action" type="button" onClick={() => props.onClearReport(report.id)}>Mark cleared</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="panel-disclaimer">A report expires after six hours without reconfirmation. Three clear votes mark it resolved. Updates are temporary in this preview.</p>
          </section>
        )}

        {feature === 'zones' && (
          <section className="panel-section">
            <div className="panel-banner"><AlertTriangle size={17} aria-hidden="true" /><p>{props.elevationAvailable ? 'Zone scores combine report depth, recency, confirmations, local rain, and relative elevation.' : 'Elevation data is unavailable. These provisional scores use report depth, recency, confirmations, and rainfall only.'}</p></div>
            {highZones.length ? (
              <ul className="zone-list">
                {highZones.map((zone) => (
                  <li key={zone.id}>
                    <span className={`zone-indicator zone-indicator--${zone.level.toLowerCase()}`} aria-hidden="true" />
                    <div><strong><ShieldAlert size={15} aria-hidden="true" /> {zone.level} risk · {zone.report.severity}</strong><p>{zone.report.description}</p><span>{zone.report.isDemo ? 'Demo report · ' : ''}Score {zone.score}/100 · radius about {zone.radius} m</span></div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="panel-empty"><MapPin size={24} aria-hidden="true" /><p>No high or severe zones are present in the active report set.</p></div>
            )}
            {props.topZoneName && <p className="panel-updated">Highest nearby advisory area: {props.topZoneName}</p>}
            {props.zoneUpdatedAt && <p className="panel-updated">Scores updated · {new Date(props.zoneUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
            <p className="panel-disclaimer">Zones are relative advisories, not verified inundation boundaries. Elevation sampling is coarse and should not be used to predict water depth.</p>
          </section>
        )}

        {feature === 'underpasses' && (
          <section className="panel-section">
            <div className="panel-banner"><MapPin size={17} aria-hidden="true" /><p>OpenStreetMap-tagged tunnels and low road segments within roughly 3 km of the selected location.</p></div>
            {props.underpasses?.data.length ? (
              <ul className="spot-list">
                {props.underpasses.data.map((spot) => (
                  <li key={spot.id}><MapPin size={17} aria-hidden="true" /><div><strong>{spot.name}</strong><span>{spot.kind} · {spot.latitude.toFixed(4)}, {spot.longitude.toFixed(4)}</span></div></li>
                ))}
              </ul>
            ) : (
              <div className="panel-empty"><MapPin size={24} aria-hidden="true" /><p>{props.underpassesLoading ? 'Looking for mapped underpasses…' : props.underpassesError ? 'OpenStreetMap data is unavailable right now.' : 'No matching OSM tags were returned within 3 km.'}</p>{props.underpassesError && <button className="text-link" type="button" onClick={props.retryUnderpasses}>Retry</button>}</div>
            )}
            <UpdatedAt result={props.underpasses} />
          </section>
        )}

        {feature === 'routes' && (
          <RoutePlanner
            currentLocation={props.currentLocation}
            currentLocationLabel={props.currentLocationLabel}
            updatedAt={props.routeUpdatedAt}
            reports={props.reports}
            routes={props.routes}
            isLoading={props.routesLoading}
            error={props.routesError}
            selectedRouteId={props.selectedRouteId}
            onRequestRoutes={props.onRequestRoutes}
            onSelectRoute={props.onSelectRoute}
            onRetry={props.retryRoutes}
          />
        )}

        {feature === 'safety' && (
          <section className="panel-section">
            <div className="panel-banner"><AlertTriangle size={17} aria-hidden="true" /><p>Never enter moving or rising water. FloodAware cannot contact emergency services for you.</p></div>
            <div className="panel-call-list"><a href="tel:112"><strong>112</strong><span>Emergency response</span></a><a href="tel:108"><strong>108</strong><span>Ambulance</span></a></div>
            <a className="panel-anchor-link" href="#safety">Read the full safety guide</a>
            <p className="panel-disclaimer">Emergency numbers and general guidance are informational. Follow local authority instructions.</p>
          </section>
        )}
      </div>
    </aside>
  )
}
