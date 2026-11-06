'use client'

import { Fragment, useEffect, useMemo } from 'react'
import { AlertTriangle, MapPin, ShieldAlert } from 'lucide-react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import type { FloodReport, GeoPoint, RawRoute, RiskZone, RouteComparison, UnderpassSpot } from '@/lib/floodaware'
import { getReportAge, isReportActive } from '@/lib/floodaware'

const riskColors = {
  Low: '#1F5A33',
  Moderate: '#1F5A33',
  High: '#C8102E',
  Severe: '#C8102E',
} as const

const markerSizes: Record<FloodReport['severity'], number> = {
  'Ankle-deep': 26,
  'Knee-deep': 30,
  'Waist-deep': 36,
  Impassable: 42,
}

function reportIcon(severity: FloodReport['severity']) {
  const className = severity.toLowerCase().replace('-deep', '').replace(' ', '-')
  const size = markerSizes[severity]
  const glyph = severity === 'Waist-deep' ? '!' : severity === 'Impassable' ? '×' : ''
  return L.divIcon({
    className: 'flood-marker-shell',
    html: `<span class="flood-marker flood-marker--${className}" aria-hidden="true"><span>${glyph}</span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  })
}

const userIcon = L.divIcon({
  className: 'flood-marker-shell',
  html: '<span class="flood-user-marker" aria-hidden="true"><span></span></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

const spotIcon = L.divIcon({
  className: 'flood-marker-shell',
  html: '<span class="flood-spot-marker" aria-hidden="true"><span></span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -14],
})

const routeWarningIcon = L.divIcon({
  className: 'flood-marker-shell',
  html: '<span class="route-warning-marker" aria-hidden="true"><span>!</span></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

function RecenterMap({ point }: { point: GeoPoint }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([point.latitude, point.longitude], Math.max(map.getZoom(), 13), { duration: 0.8 })
  }, [map, point.latitude, point.longitude])
  return null
}

function MapClickHandler({ picking, onPick }: { picking: boolean; onPick: (point: GeoPoint) => void }) {
  useMapEvents({
    click(event) {
      if (picking) onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng })
    },
  })
  return null
}

function ReportPopup({
  report,
  onConfirm,
  onClear,
}: {
  report: FloodReport
  onConfirm: (id: string) => void
  onClear: (id: string) => void
}) {
  return (
    <div className="map-popup-card">
      <div className="popup-badges">
        <span className={`severity-pill severity-pill--${report.severity.toLowerCase().replace('-deep', '').replace(' ', '-')}`}>
          <AlertTriangle size={14} aria-hidden="true" /> {report.severity}
        </span>
        {report.isDemo && <span className="demo-pill">Demo</span>}
        {!isReportActive(report) && <span className="resolved-pill">Resolved</span>}
      </div>
      <p className="popup-description">{report.description}</p>
      <p className="popup-meta">Reported {getReportAge(report.createdAt)} · {report.confirmations} confirmations</p>
      {report.clearedVotes > 0 && <p className="popup-meta">Cleared votes: {report.clearedVotes} of 3</p>}
      {report.photoDataUrl && <img className="popup-photo" src={report.photoDataUrl} alt="Community report of street waterlogging" />}
      {report.reporterName && <p className="popup-meta">Shared by {report.reporterName}</p>}
      {isReportActive(report) && (
        <div className="popup-actions">
          <button className="popup-action popup-action-primary" type="button" onClick={() => onConfirm(report.id)}>
            Confirm
          </button>
          <button className="popup-action" type="button" onClick={() => onClear(report.id)}>
            It&apos;s cleared
          </button>
        </div>
      )}
    </div>
  )
}

export type MapLayers = {
  reports: boolean
  zones: boolean
  underpasses: boolean
  routes: boolean
  showDemo: boolean
}

export type FloodMapType = 'roadmap' | 'terrain' | 'satellite'

type FloodMapProps = {
  point: GeoPoint
  reports: FloodReport[]
  zones: RiskZone[]
  underpasses: UnderpassSpot[]
  routes: RouteComparison[]
  selectedRouteId: string | null
  layers: MapLayers
  pickingReportPin: boolean
  onPickReportPin: (point: GeoPoint) => void
  onConfirmReport: (id: string) => void
  onClearReport: (id: string) => void
  onSelectRoute: (id: string) => void
  onTileStatusChange: (status: 'loading' | 'responded' | 'failed') => void
  mapType?: FloodMapType
  routeEndpoints?: { start: GeoPoint; destination: GeoPoint } | null
}

export function FloodMap({
  point,
  reports,
  zones,
  underpasses,
  routes,
  selectedRouteId,
  layers,
  pickingReportPin,
  onPickReportPin,
  onConfirmReport,
  onClearReport,
  onSelectRoute,
  onTileStatusChange,
  mapType = 'roadmap',
  routeEndpoints = null,
}: FloodMapProps) {
  const visibleReports = useMemo(
    () => reports.filter((report) => layers.showDemo || !report.isDemo),
    [layers.showDemo, reports],
  )
  const selectedRoute = routes.find((route) => route.id === selectedRouteId) ?? null
  const fastestRoute = routes.reduce<RouteComparison | null>((fastest, route) =>
    !fastest || route.durationSeconds < fastest.durationSeconds ? route : fastest,
  null)

  return (
    <MapContainer
      className={`flood-map ${pickingReportPin ? 'flood-map-picking' : ''}`}
      center={[point.latitude, point.longitude]}
      zoom={13}
      scrollWheelZoom
      zoomControl={false}
      preferCanvas
      aria-label="FloodAware interactive map"
    >
      <RecenterMap point={point} />
      <MapClickHandler picking={pickingReportPin} onPick={onPickReportPin} />
      <ZoomControl position="bottomright" />
      <TileLayer
        attribution={mapType === 'satellite'
          ? 'Tiles &copy; Esri'
          : mapType === 'terrain'
            ? 'Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap'
            : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'}
        url={mapType === 'satellite'
          ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          : mapType === 'terrain'
            ? 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
            : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
        maxZoom={mapType === 'terrain' ? 17 : 19}
        eventHandlers={{
          loading: () => onTileStatusChange('loading'),
          tileload: () => onTileStatusChange('responded'),
          tileerror: () => onTileStatusChange('failed'),
        }}
      />
      <Marker position={[point.latitude, point.longitude]} icon={userIcon} zIndexOffset={800}>
        <Popup>
          <div className="map-popup-card">
            <strong>Your selected location</strong>
            <p className="popup-meta">Map center for local weather and flood data.</p>
          </div>
        </Popup>
      </Marker>
      {layers.zones && zones.map((zone) => (
        <Circle
          key={zone.id}
          center={[zone.latitude, zone.longitude]}
          radius={zone.radius}
          pathOptions={{ color: riskColors[zone.level], fillColor: riskColors[zone.level], fillOpacity: zone.level === 'Low' || zone.level === 'Moderate' ? 0.28 : 0.42, weight: 2, dashArray: '7 6' }}
        >
          <Popup>
            <div className="map-popup-card">
              <span className={`severity-pill severity-pill--${zone.level.toLowerCase()}`}><ShieldAlert size={14} aria-hidden="true" /> {zone.level} risk zone</span>
              <p className="popup-description">Based on nearby reports, recent confirmations, rainfall, and relative elevation.</p>
              <p className="popup-meta">Advisory score: {zone.score} / 100 · {zone.report.severity} report</p>
              {zone.report.isDemo && <span className="demo-pill">Demo report</span>}
            </div>
          </Popup>
        </Circle>
      ))}
      {layers.routes && routes.map((route) => {
        const isSelected = route.id === (selectedRoute?.id ?? routes[0]?.id)
        const positions = route.coordinates.map(([longitude, latitude]) => [latitude, longitude] as [number, number])
        return (
          <Fragment key={route.id}>
            {isSelected && <Polyline positions={positions} pathOptions={{ color: '#F2F1EC', weight: 11, opacity: 0.96 }} />}
            <Polyline
              positions={positions}
              pathOptions={{ color: isSelected ? '#1F5A33' : '#C8102E', weight: isSelected ? 7 : 4, opacity: 0.96, dashArray: isSelected ? undefined : '9 9' }}
              eventHandlers={{ click: () => onSelectRoute(route.id) }}
            />
          </Fragment>
        )
      })}
      {layers.routes && routeEndpoints && (
        <>
          <Marker position={[routeEndpoints.start.latitude, routeEndpoints.start.longitude]} icon={L.divIcon({ className: 'route-endpoint-icon', html: '<span>A</span>', iconSize: [30, 30], iconAnchor: [15, 15] })} />
          <Marker position={[routeEndpoints.destination.latitude, routeEndpoints.destination.longitude]} icon={L.divIcon({ className: 'route-endpoint-icon', html: '<span>B</span>', iconSize: [30, 30], iconAnchor: [15, 15] })} />
        </>
      )}
      {layers.routes && fastestRoute?.severeHazards.map((hazard) => (
        <Marker key={`fastest-warning-${hazard.id}`} position={[hazard.latitude, hazard.longitude]} icon={routeWarningIcon}>
          <Popup>
            <div className="map-popup-card">
              <span className="severity-pill severity-pill--impassable"><AlertTriangle size={14} aria-hidden="true" /> Severe hazard on fastest route</span>
              <p className="popup-description">{hazard.description}</p>
              <p className="popup-meta">{hazard.isDemo ? 'Demo report · ' : ''}{getReportAge(hazard.createdAt)}</p>
            </div>
          </Popup>
        </Marker>
      ))}
      {layers.reports && visibleReports.map((report) => (
        <Marker
          key={report.id}
          position={[report.latitude, report.longitude]}
          icon={reportIcon(report.severity)}
          opacity={isReportActive(report) ? 1 : 0.58}
        >
          <Popup>
            <ReportPopup report={report} onConfirm={onConfirmReport} onClear={onClearReport} />
          </Popup>
        </Marker>
      ))}
      {layers.underpasses && underpasses.map((spot) => (
        <Marker key={spot.id} position={[spot.latitude, spot.longitude]} icon={spotIcon}>
          <Popup>
            <div className="map-popup-card">
              <span className="severity-pill severity-pill--moderate"><MapPin size={14} aria-hidden="true" /> Known risky spot</span>
              <p className="popup-description">{spot.name}</p>
              <p className="popup-meta">OpenStreetMap tag: {spot.kind}</p>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
