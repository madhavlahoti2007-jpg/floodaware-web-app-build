'use client'

import { useState } from 'react'
import { AlertTriangle, Clock3, Map, Navigation, Route, ShieldCheck } from 'lucide-react'
import type { FloodReport, GeoPoint, Place, RouteComparison, TravelMode } from '@/lib/floodaware'
import { PlaceSearch } from '@/components/floodaware/place-search'
import { Button } from '@/components/ui/button'

function formatDistance(meters: number, unit: 'km' | 'mi' = 'km') {
  return unit === 'mi' ? `${(meters / 1609.34).toFixed(1)} mi` : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

type RoutePlannerProps = {
  currentLocation: GeoPoint
  currentLocationLabel: string
  updatedAt?: number
  reports: FloodReport[]
  routes: RouteComparison[]
  isLoading: boolean
  error?: Error
  selectedRouteId: string | null
  onRequestRoutes: (start: GeoPoint, destination: GeoPoint, mode?: TravelMode) => void
  onSelectRoute: (id: string) => void
  onRetry: () => void
  onSaveRoute?: (route: RouteComparison) => void
  onShareRoute?: (route: RouteComparison) => void
  distanceUnit?: 'km' | 'mi'
}

export function RoutePlanner({
  currentLocation,
  currentLocationLabel,
  updatedAt,
  reports,
  routes,
  isLoading,
  error,
  selectedRouteId,
  onRequestRoutes,
  onSelectRoute,
  onRetry,
  onSaveRoute,
  onShareRoute,
  distanceUnit = 'km',
}: RoutePlannerProps) {
  const [useCurrentStart, setUseCurrentStart] = useState(true)
  const [travelMode, setTravelMode] = useState<TravelMode>('drive')
  const [startPlace, setStartPlace] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [formError, setFormError] = useState('')
  const everyRouteHasSevereHazard = routes.length > 0 && routes.every((route) => route.severeHazards.length > 0)
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? routes[0] ?? null

  function requestRoutes() {
    if (!destination) {
      setFormError('Search for and select a destination first.')
      return
    }
    if (!useCurrentStart && !startPlace) {
      setFormError('Search for and select a start point.')
      return
    }
    setFormError('')
    onRequestRoutes(useCurrentStart ? currentLocation : startPlace!, destination, travelMode)
  }

  return (
    <div className="route-planner-content">
      <div className="route-form-grid">
        <div className="form-field">
          {useCurrentStart ? (
            <div className="route-start-card">
              <div>
                <span className="field-label">Start</span>
                <p className="route-start-value"><Navigation size={16} aria-hidden="true" /> {currentLocationLabel}</p>
              </div>
              <button className="text-link" type="button" onClick={() => setUseCurrentStart(false)}>Change</button>
            </div>
          ) : (
            <div className="route-start-search">
              <PlaceSearch
                label="Start"
                placeholder="Search a starting point"
                value={startPlace}
                onSelect={(place) => setStartPlace(place)}
              />
              <button className="text-link" type="button" onClick={() => { setUseCurrentStart(true); setStartPlace(null) }}>
                {currentLocationLabel === 'Your location' ? 'Use my location' : 'Use map center'}
              </button>
            </div>
          )}
        </div>
        <PlaceSearch
          label="Destination"
          placeholder="Search a place or address"
          value={destination}
          onSelect={(place) => { setDestination(place); setFormError('') }}
        />
      </div>
      <label className="form-field route-mode-field"><span className="field-label">Travel mode</span><select className="form-input" value={travelMode} onChange={(event) => setTravelMode(event.target.value as TravelMode)}><option value="drive">Drive</option><option value="two-wheeler">Two-wheeler</option><option value="walk">Walk</option></select></label>
      <Button type="button" className="primary-button route-submit" onClick={requestRoutes} disabled={isLoading}>
        <Route data-icon="inline-start" aria-hidden="true" />
        {isLoading ? 'Finding routes…' : 'Compare safer routes'}
      </Button>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      {error && (
        <div className="panel-error" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div><p>Routes are unavailable right now.</p><button className="text-link" type="button" onClick={onRetry}>Retry</button></div>
        </div>
      )}
      {isLoading && <div className="route-loading" aria-label="Loading route alternatives"><span /><span /><span /></div>}
      {everyRouteHasSevereHazard && (
        <div className="route-warning" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <p><strong>No safe route.</strong> Every available route crosses a reported impassable hazard. Consider waiting or sheltering.</p>
        </div>
      )}
      {routes.length > 0 && !isLoading && (
        <div className="route-results">
          <p className="panel-kicker">OSRM alternatives · scored against active reports</p>
          {updatedAt && <p className="panel-updated">Routes updated · {new Date(updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>}
          {routes.map((route) => {
            const selected = selectedRouteId === route.id
            const hasDemoHazards = route.hazards.some((hazard) => hazard.isDemo)
            return (
              <button
                key={route.id}
                type="button"
                className={`route-option ${selected ? 'route-option-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelectRoute(route.id)}
              >
                <div className="route-option-heading">
                  <span className="route-option-title">
                    {route.label.includes('Safest') ? <ShieldCheck size={18} aria-hidden="true" /> : <Map size={18} aria-hidden="true" />}
                    {route.label}
                  </span>
                  <span className={`risk-score risk-score--${route.riskScore >= 65 ? 'high' : route.riskScore >= 35 ? 'moderate' : 'low'}`}>
                    Risk {route.riskScore}/100
                  </span>
                </div>
                <div className="route-option-meta">
                  <span><Route size={15} aria-hidden="true" /> {formatDistance(route.distanceMeters, distanceUnit)}</span>
                  <span><Clock3 size={15} aria-hidden="true" /> {formatDuration(route.durationSeconds)}</span>
                </div>
                <p className="route-hazard-summary">
                  {route.hazards.length > 0
                    ? `${route.hazards.length} reported ${route.hazards.length === 1 ? 'hazard' : 'hazards'} on this route${hasDemoHazards ? ' · includes demo reports' : ''}`
                    : 'No active reported hazards intersect this route'}
                </p>
              </button>
            )
          })}
          {selectedRoute && <div className="route-share-actions"><button className="secondary-action" type="button" onClick={() => onSaveRoute?.(selectedRoute)}><ShieldCheck size={15} aria-hidden="true" /> Save route</button><button className="secondary-action" type="button" onClick={() => onShareRoute?.(selectedRoute)}><Navigation size={15} aria-hidden="true" /> Share route</button></div>}
          <p className="route-disclaimer">Advisory only—not a guarantee. Conditions change quickly. Route scoring uses reports available in the current feed.</p>
        </div>
      )}
      {!isLoading && !error && routes.length === 0 && (
        <div className="route-empty">
          <Route size={24} aria-hidden="true" />
          <p>Choose a destination to compare road routes against nearby flood reports.</p>
        </div>
      )}

    </div>
  )
}
