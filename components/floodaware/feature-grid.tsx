'use client'

import { AlertTriangle, CloudRain, Compass, Droplets, MapPinned, Navigation, Share2, Shield, Waves } from 'lucide-react'
import type { CachedResult, FloodReport, RiverPayload, RiskZone, UnderpassSpot, WeatherPayload } from '@/lib/floodaware'
import { getReportAge } from '@/lib/floodaware'
import { Button } from '@/components/ui/button'
import { RainChart } from '@/components/floodaware/rain-chart'

export type FeatureKey = 'rainfall' | 'forecast' | 'river' | 'reports' | 'zones' | 'underpasses' | 'routes' | 'safety'

type FeatureGridProps = {
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
  now: number
  zones: RiskZone[]
  topZoneName?: string
  zoneUpdatedAt?: number
  elevationAvailable: boolean
  rainfallRiskMessage: string
  shareLocationLabel: string
  onShareLocation: () => void
  onOpen: (feature: FeatureKey) => void
}

function CardState({ loading, error, retry, children, unavailableMessage }: { loading: boolean; error?: Error; retry: () => void; children: React.ReactNode; unavailableMessage: string }) {
  if (loading) return <div className="card-loading" aria-label="Loading live data"><span /><span /></div>
  if (error) {
    return (
      <div className="card-error" role="status">
        <span>{unavailableMessage}</span>
        <button className="text-link" type="button" onClick={retry}>Try again</button>
      </div>
    )
  }
  return <>{children}</>
}

function FeatureCard({
  icon: Icon,
  eyebrow,
  title,
  children,
  buttonText,
  onClick,
  className = '',
}: {
  icon: typeof CloudRain
  eyebrow: string
  title: string
  children: React.ReactNode
  buttonText: string
  onClick: () => void
  className?: string
}) {
  return (
    <article className={`feature-card ${className}`}>
      <div className="feature-card-top">
        <span className="feature-icon"><Icon size={21} aria-hidden="true" /></span>
        <span className="feature-eyebrow">{eyebrow}</span>
      </div>
      <h3>{title}</h3>
      <div className="feature-card-body">{children}</div>
      <Button type="button" variant="outline" className="feature-card-action" onClick={onClick}>
        {buttonText}
      </Button>
    </article>
  )
}

function amount(value: number | null | undefined, suffix: string) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : 'Not available'
}

export function FeatureGrid({
  weather,
  weatherLoading,
  weatherError,
  retryWeather,
  river,
  riverLoading,
  riverError,
  retryRiver,
  underpasses,
  underpassesLoading,
  underpassesError,
  retryUnderpasses,
  reports,
  activeReports,
  now,
  zones,
  topZoneName,
  zoneUpdatedAt,
  elevationAvailable,
  rainfallRiskMessage,
  shareLocationLabel,
  onShareLocation,
  onOpen,
}: FeatureGridProps) {
  const highZones = zones.filter((zone) => zone.level === 'High' || zone.level === 'Severe')
  const onlyDemoReports = reports.length > 0 && reports.every((report) => report.isDemo)
  const recentReports = [...activeReports].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)
  const latestWeather = weather?.data

  return (
    <section className="features-section section-shell" aria-labelledby="features-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Built for the next downpour</p>
          <h2 id="features-title">What FloodAware can do</h2>
        </div>
        <p className="section-heading-note">Clear, location-aware signals to help you decide what to do next.</p>
      </div>
      <div className="feature-grid">
        <FeatureCard icon={CloudRain} eyebrow="Open-Meteo · live" title="Rainfall now" buttonText="View rainfall" onClick={() => onOpen('rainfall')}>
          <CardState loading={weatherLoading && !weather} error={weatherError && !weather ? weatherError : undefined} retry={retryWeather} unavailableMessage="Live rainfall is unavailable for this location.">
            {latestWeather ? (
              <>
                <p className="feature-metric">{amount(latestWeather.currentRainMmHr, 'mm/h')}</p>
                <p className="feature-support">Current rain · {amount(latestWeather.todayTotalMm, 'mm')} forecast today</p>
                <p className="rain-advisory-copy">{rainfallRiskMessage}</p>
                <p className="data-updated">{weather?.stale ? 'Last known reading' : 'Live reading'} · {new Date(weather.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
              </>
            ) : <p className="feature-support">Waiting for the live weather response.</p>}
          </CardState>
        </FeatureCard>

        <FeatureCard icon={Droplets} eyebrow="Next 12 hours" title="Rain forecast" buttonText="Open forecast" onClick={() => onOpen('forecast')}>
          <CardState loading={weatherLoading && !weather} error={weatherError && !weather ? weatherError : undefined} retry={retryWeather} unavailableMessage="The hourly forecast is unavailable for this location.">
            {latestWeather?.hours.length ? (
              <>
                <RainChart hours={latestWeather.hours} compact />
                <p className="feature-support">Hourly precipitation and probability.</p>
                <p className="data-updated">{weather?.stale ? 'Last known forecast' : 'Updated'} · {new Date(weather!.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
              </>
            ) : <p className="feature-support">Forecast values are not available for this location.</p>}
          </CardState>
        </FeatureCard>

        <FeatureCard icon={Waves} eyebrow="Open-Meteo Flood API · modeled" title="River & flood outlook" buttonText="Review river data" onClick={() => onOpen('river')}>
          <CardState loading={riverLoading && !river} error={riverError && !river ? riverError : undefined} retry={retryRiver} unavailableMessage="The river outlook is unavailable for this location.">
            {river?.data.currentDischarge !== null && river?.data.currentDischarge !== undefined ? (
              <>
                <p className="feature-metric">{river.data.currentDischarge.toFixed(1)} <span>m³/s</span></p>
                <span className={`trend-pill trend-pill--${river.data.trend.toLowerCase()}`}><Waves size={15} aria-hidden="true" />{river.data.trend}</span>
                <p className="feature-support">Modeled daily river discharge · coarse-grid outlook.</p>
                <p className="data-updated">{river.stale ? 'Last known reading' : 'Live outlook'} · {new Date(river.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
              </>
            ) : <p className="feature-support">River discharge is not available for this location.</p>}
          </CardState>
        </FeatureCard>

        <FeatureCard icon={MapPinned} eyebrow="Community signals" title="Flood reports" buttonText="Browse reports" onClick={() => onOpen('reports')}>
          <div className="feature-count-row">
            <p className="feature-metric">{activeReports.length || 'No active'}</p>
            {onlyDemoReports && <span className="demo-pill">Demo set</span>}
          </div>
          <p className="feature-support">{activeReports.length === 1 ? 'active report' : 'active reports'} · expires after 6 hours unless reconfirmed.</p>
          <p className="data-updated">{onlyDemoReports ? 'Demo reports are clearly marked on the map.' : 'Shared across open tabs only · not saved to a database.'}</p>
          {recentReports.length > 0 && (
            <ul className="recent-report-preview" aria-label="Three most recent active reports">
              {recentReports.map((report) => (
                <li key={report.id}><span>{report.severity}{report.isDemo ? ' · Demo' : ''}</span><time dateTime={new Date(report.createdAt).toISOString()}>{getReportAge(report.createdAt, now)}</time></li>
              ))}
            </ul>
          )}
        </FeatureCard>

        <FeatureCard icon={AlertTriangle} eyebrow="Reports + local conditions" title="Flood-prone zones" buttonText="Explore risk zones" onClick={() => onOpen('zones')}>
          <p className="feature-metric">{highZones.length || 'None'}</p>
          <p className="feature-support">{highZones.length ? 'High or severe advisory areas nearby.' : 'No high or severe advisory areas are scored nearby.'}</p>
          <p className="data-updated">{topZoneName ? `Highest nearby signal: ${topZoneName}` : 'Scores combine reports, rain, and relative elevation.'}</p>
          <p className="data-updated">{zoneUpdatedAt ? `${elevationAvailable ? 'Elevation + rainfall' : 'Report + rainfall only'} · ${new Date(zoneUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for local data.'}</p>
        </FeatureCard>

        <FeatureCard icon={Navigation} eyebrow="OpenStreetMap tags · 3 km" title="Known risky spots" buttonText="See mapped spots" onClick={() => onOpen('underpasses')}>
          <CardState loading={underpassesLoading && !underpasses} error={underpassesError && !underpasses ? underpassesError : undefined} retry={retryUnderpasses} unavailableMessage="Nearby OpenStreetMap data is unavailable.">
            {underpasses ? (
              <>
                <p className="feature-metric">{underpasses.data.length || 'No tagged'}</p>
                <p className="feature-support">{underpasses.data.length ? 'mapped underpasses or low road spots nearby' : 'underpass tags found within 3 km'}</p>
                <p className="data-updated">{underpasses.stale ? 'Last known OSM data' : 'OpenStreetMap response'} · {new Date(underpasses.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
              </>
            ) : <p className="feature-support">Waiting for nearby OpenStreetMap features.</p>}
          </CardState>
        </FeatureCard>

        <FeatureCard icon={Compass} eyebrow="Hazard-aware directions" title="Safest route planner" buttonText="Plan a route" onClick={() => onOpen('routes')}>
          <p className="feature-metric feature-metric-compact">Compare routes, not just minutes.</p>
          <p className="feature-support">Road alternatives are scored against active reports and sampled elevation.</p>
          <p className="data-updated">OSRM directions · Open-Meteo elevation</p>
        </FeatureCard>

        <FeatureCard icon={Shield} eyebrow="Practical safety guidance" title="Emergency & safety" buttonText="Open safety guide" onClick={() => onOpen('safety')}>
          <p className="feature-metric feature-metric-compact">Quick help, without guesswork.</p>
          <p className="feature-support">Emergency calling, shareable location, and flood-safety steps.</p>
          <div className="quick-dials">
            <a href="tel:112" aria-label="Call emergency services at 112">Call 112</a>
            <a href="tel:108" aria-label="Call ambulance services at 108">Call 108</a>
          </div>
          <Button type="button" variant="outline" className="quick-share-button" onClick={onShareLocation}>
            <Share2 data-icon="inline-start" aria-hidden="true" /> {shareLocationLabel}
          </Button>
          <ul className="safety-mini-tips">
            <li>Do not walk or drive through moving water.</li>
            <li>Avoid underpasses when water is rising.</li>
            <li>Move to higher ground if water enters a building.</li>
          </ul>
        </FeatureCard>
      </div>
      <div className="feature-note"><AlertTriangle size={17} aria-hidden="true" /><p>FloodAware is an advisory tool. Never enter moving or rising water, and call local emergency services when someone is in danger.</p></div>
    </section>
  )
}
