export const HYDERABAD = { latitude: 17.385, longitude: 78.4867 }

export const FLOOD_LEVELS = [
  { name: 'Ankle-deep', value: 1 },
  { name: 'Knee-deep', value: 2 },
  { name: 'Waist-deep', value: 3 },
  { name: 'Impassable', value: 4 },
] as const

export type FloodSeverity = (typeof FLOOD_LEVELS)[number]['name']
export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Severe'
export type GeoPoint = { latitude: number; longitude: number }
export type TravelMode = 'drive' | 'two-wheeler' | 'walk'

export type FloodReport = GeoPoint & {
  id: string
  severity: FloodSeverity
  description: string
  createdAt: number
  updatedAt: number
  lastConfirmedAt: number | null
  confirmations: number
  clearedVotes: number
  resolved: boolean
  resolvedAt: number | null
  isDemo: boolean
  reporterName: string | null
  reporterId?: string | null
  expiresAt?: number | null
  photoDataUrl: string | null
}

export type RiskZone = GeoPoint & {
  id: string
  level: RiskLevel
  score: number
  radius: number
  report: FloodReport
}

export type ForecastHour = {
  time: string
  precipitationMm: number | null
  probability: number | null
}

export type WeatherPayload = {
  currentRainMmHr: number | null
  todayTotalMm: number | null
  hours: ForecastHour[]
}

export type RiverPayload = {
  currentDischarge: number | null
  trend: 'Rising' | 'Steady' | 'Falling' | 'Unavailable'
  series: { date: string; discharge: number | null }[]
}

export type ElevationSample = GeoPoint & { meters: number }

export type UnderpassSpot = GeoPoint & {
  id: string
  name: string
  kind: string
}

export type Place = GeoPoint & {
  displayName: string
}

export type RawRoute = {
  id: string
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
  elevations: number[]
}

export type RouteComparison = RawRoute & {
  riskScore: number
  hazards: FloodReport[]
  severeHazards: FloodReport[]
  label: string
}

export type CachedResult<T> = {
  data: T
  updatedAt: number
  stale: boolean
}

const demoPoints: Array<{
  latitude: number
  longitude: number
  severity: FloodSeverity
  description: string
  minutesAgo: number
  confirmations: number
  resolved?: boolean
}> = [
  { latitude: 17.4372, longitude: 78.4482, severity: 'Knee-deep', description: 'Water is pooling across the service lane after the rain.', minutesAgo: 18, confirmations: 2 },
  { latitude: 17.4067, longitude: 78.4772, severity: 'Waist-deep', description: 'Floodwater is covering the lower part of the road.', minutesAgo: 32, confirmations: 3 },
  { latitude: 17.3926, longitude: 78.4901, severity: 'Ankle-deep', description: 'Standing water near the junction; traffic is moving slowly.', minutesAgo: 47, confirmations: 1 },
  { latitude: 17.4213, longitude: 78.4517, severity: 'Impassable', description: 'Vehicles cannot pass through the underpass right now.', minutesAgo: 61, confirmations: 4 },
  { latitude: 17.3668, longitude: 78.4753, severity: 'Knee-deep', description: 'Water is spilling onto the footpath and left lane.', minutesAgo: 74, confirmations: 2 },
  { latitude: 17.4421, longitude: 78.5015, severity: 'Ankle-deep', description: 'A shallow but growing pool is forming at the road edge.', minutesAgo: 89, confirmations: 0 },
  { latitude: 17.3891, longitude: 78.4385, severity: 'Waist-deep', description: 'Water has reached the door line of parked cars.', minutesAgo: 103, confirmations: 3 },
  { latitude: 17.4548, longitude: 78.3834, severity: 'Knee-deep', description: 'The low point under the bridge is waterlogged.', minutesAgo: 116, confirmations: 1 },
  { latitude: 17.3734, longitude: 78.5141, severity: 'Ankle-deep', description: 'Water is collecting around the curb and crossing.', minutesAgo: 129, confirmations: 2 },
  { latitude: 17.4157, longitude: 78.4932, severity: 'Waist-deep', description: 'Two lanes are under water; use the parallel road.', minutesAgo: 145, confirmations: 5 },
  { latitude: 17.3527, longitude: 78.4484, severity: 'Knee-deep', description: 'A deep puddle is slowing buses and smaller vehicles.', minutesAgo: 164, confirmations: 1 },
  { latitude: 17.4286, longitude: 78.4778, severity: 'Ankle-deep', description: 'Water is flowing across the street from the side drain.', minutesAgo: 183, confirmations: 0 },
  { latitude: 17.3972, longitude: 78.5266, severity: 'Impassable', description: 'The road dip is fully covered; please do not enter.', minutesAgo: 205, confirmations: 4 },
  { latitude: 17.4634, longitude: 78.4558, severity: 'Knee-deep', description: 'Water is over the road markings at this low stretch.', minutesAgo: 227, confirmations: 2 },
  { latitude: 17.3811, longitude: 78.4618, severity: 'Ankle-deep', description: 'Shallow water is moving slowly through the junction.', minutesAgo: 249, confirmations: 1 },
  { latitude: 17.4356, longitude: 78.5194, severity: 'Waist-deep', description: 'Water is above the wheel hubs on the lowest section.', minutesAgo: 273, confirmations: 3 },
  { latitude: 17.3588, longitude: 78.4972, severity: 'Knee-deep', description: 'Water is receding; one lane remains difficult to use.', minutesAgo: 296, confirmations: 1, resolved: true },
  { latitude: 17.4042, longitude: 78.4213, severity: 'Ankle-deep', description: 'The reported pooling has cleared and the road is passable.', minutesAgo: 322, confirmations: 2, resolved: true },
]

export function createDemoReports(now = Date.now()): FloodReport[] {
  return demoPoints.map((point, index) => {
    const createdAt = now - point.minutesAgo * 60_000
    const resolvedAt = point.resolved ? createdAt + 12 * 60_000 : null
    return {
      id: `demo-${index + 1}`,
      latitude: point.latitude,
      longitude: point.longitude,
      severity: point.severity,
      description: point.description,
      createdAt,
      updatedAt: createdAt,
      lastConfirmedAt: point.confirmations > 0 ? createdAt + 5 * 60_000 : null,
      confirmations: point.confirmations,
      clearedVotes: point.resolved ? 3 : 0,
      resolved: Boolean(point.resolved),
      resolvedAt,
      isDemo: true,
      reporterName: null,
      photoDataUrl: null,
    }
  })
}

export function severityValue(severity: FloodSeverity) {
  return FLOOD_LEVELS.find((level) => level.name === severity)?.value ?? 1
}

export function isReportActive(report: FloodReport, now = Date.now()) {
  const lastActivity = report.lastConfirmedAt ?? report.createdAt
  return !report.resolved && now - lastActivity < 6 * 60 * 60_000
}

export function mergeReports(current: FloodReport[], incoming: FloodReport[]) {
  const merged = new Map(current.map((report) => [report.id, report]))
  for (const report of incoming) {
    const existing = merged.get(report.id)
    if (!existing || report.updatedAt >= existing.updatedAt) merged.set(report.id, report)
  }
  return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function isValidFloodReport(value: unknown): value is FloodReport {
  if (!value || typeof value !== 'object') return false
  const report = value as Partial<FloodReport>
  return typeof report.id === 'string' && report.id.length <= 100 &&
    typeof report.latitude === 'number' && report.latitude >= -90 && report.latitude <= 90 &&
    typeof report.longitude === 'number' && report.longitude >= -180 && report.longitude <= 180 &&
    FLOOD_LEVELS.some((level) => level.name === report.severity) &&
    typeof report.description === 'string' && report.description.length <= 500 &&
    typeof report.createdAt === 'number' && Number.isFinite(report.createdAt) &&
    typeof report.updatedAt === 'number' && Number.isFinite(report.updatedAt) &&
    typeof report.confirmations === 'number' && Number.isInteger(report.confirmations) && report.confirmations >= 0 &&
    typeof report.clearedVotes === 'number' && Number.isInteger(report.clearedVotes) && report.clearedVotes >= 0 &&
    typeof report.isDemo === 'boolean' &&
    (report.photoDataUrl === null || (typeof report.photoDataUrl === 'string' && (report.photoDataUrl.startsWith('data:image/') || report.photoDataUrl.startsWith('https://')) && report.photoDataUrl.length <= 2_800_000))
}

export function getReportAge(timestamp: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr${hours === 1 ? '' : 's'} ago`
}

export function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const earthRadius = 6_371_000
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLatitude = toRadians(b.latitude - a.latitude)
  const deltaLongitude = toRadians(b.longitude - a.longitude)
  const latitudeA = toRadians(a.latitude)
  const latitudeB = toRadians(b.latitude)
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function nearestElevation(point: GeoPoint, elevations: ElevationSample[]) {
  if (elevations.length === 0) return null
  return elevations.reduce((nearest, sample) =>
    distanceMeters(point, sample) < distanceMeters(point, nearest) ? sample : nearest,
  )
}

function riskLevel(score: number): RiskLevel {
  if (score >= 78) return 'Severe'
  if (score >= 58) return 'High'
  if (score >= 36) return 'Moderate'
  return 'Low'
}

export function buildRiskZones(
  reports: FloodReport[],
  elevations: ElevationSample[],
  rainfallMmHr: number | null,
  forecastPeakMmHr: number | null = null,
) {
  const activeReports = reports.filter((report) => isReportActive(report))
  const elevationValues = elevations.map((sample) => sample.meters).sort((a, b) => a - b)
  const medianElevation = elevationValues.length
    ? elevationValues[Math.floor(elevationValues.length / 2)]
    : null

  return activeReports.map((report) => {
    const nearest = nearestElevation(report, elevations)
    const minutesSinceActivity = (Date.now() - (report.lastConfirmedAt ?? report.createdAt)) / 60_000
    const recencyScore = Math.max(0, 12 - minutesSinceActivity / 30)
    const confirmationScore = Math.min(12, report.confirmations * 2)
    const elevationPenalty =
      nearest && medianElevation !== null && distanceMeters(report, nearest) <= 2_500
        ? Math.min(16, Math.max(0, medianElevation - nearest.meters) * 1.8)
        : 0
    const currentRainScore = rainfallMmHr === null ? 0 : Math.max(0, rainfallMmHr) * 1.4
    const forecastRainScore = forecastPeakMmHr === null ? 0 : Math.max(0, forecastPeakMmHr) * 1.1
    const rainScore = Math.min(12, currentRainScore + forecastRainScore)
    const score = Math.min(
      100,
      severityValue(report.severity) * 16 + recencyScore + confirmationScore + elevationPenalty + rainScore,
    )
    const level = riskLevel(score)
    const radius = Math.round(150 + score * 3.1)
    return { id: `zone-${report.id}`, latitude: report.latitude, longitude: report.longitude, level, score, radius, report }
  })
}

function pointToSegmentMeters(point: GeoPoint, start: GeoPoint, end: GeoPoint) {
  const scaleLatitude = 111_320
  const latitudeScale = Math.cos((point.latitude * Math.PI) / 180) * scaleLatitude
  const px = point.longitude * latitudeScale
  const py = point.latitude * scaleLatitude
  const ax = start.longitude * latitudeScale
  const ay = start.latitude * scaleLatitude
  const bx = end.longitude * latitudeScale
  const by = end.latitude * scaleLatitude
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function routeDistanceToReport(coordinates: [number, number][], report: FloodReport) {
  let minimum = Number.POSITIVE_INFINITY
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLongitude, previousLatitude] = coordinates[index - 1]
    const [longitude, latitude] = coordinates[index]
    minimum = Math.min(
      minimum,
      pointToSegmentMeters(report, { latitude: previousLatitude, longitude: previousLongitude }, { latitude, longitude }),
    )
  }
  return minimum
}

export function compareRoutes(routes: RawRoute[], reports: FloodReport[]) {
  const activeReports = reports.filter((report) => isReportActive(report))
  const scored = routes.map((route) => {
    const hazards = activeReports.filter((report) => {
      const radius = 40 + (severityValue(report.severity) - 1) * 36
      return routeDistanceToReport(route.coordinates, report) <= radius
    })
    const severeHazards = hazards.filter((report) => report.severity === 'Impassable')
    const severityCost = hazards.reduce((total, report) => {
      const minutesSinceActivity = (Date.now() - (report.lastConfirmedAt ?? report.createdAt)) / 60_000
      const freshness = Math.max(0.45, 1 - minutesSinceActivity / 720)
      const trust = 1 + Math.min(0.3, report.confirmations * 0.06)
      return total + severityValue(report.severity) * 12 * freshness * trust
    }, 0)
    const finiteElevations = route.elevations.filter(Number.isFinite).sort((a, b) => a - b)
    const median = finiteElevations.length ? finiteElevations[Math.floor(finiteElevations.length / 2)] : null
    const lowElevationPenalty =
      median === null
        ? 0
        : Math.min(20, finiteElevations.filter((value) => value < median - 3).length * 2.5)
    const riskScore = Math.min(100, Math.round(severityCost + lowElevationPenalty))
    return { ...route, hazards, severeHazards, riskScore, label: 'Balanced' }
  })

  if (scored.length === 0) return scored
  const safest = scored.reduce((best, route) => route.riskScore < best.riskScore ? route : best)
  const fastest = scored.reduce((best, route) => route.durationSeconds < best.durationSeconds ? route : best)
  const balanced = scored.reduce((best, route) => {
    const candidateScore = route.riskScore * 0.65 + route.durationSeconds / 60 * 0.35
    const bestScore = best.riskScore * 0.65 + best.durationSeconds / 60 * 0.35
    return candidateScore < bestScore ? route : best
  })

  return scored.map((route) => {
    const labels = [
      route.id === safest.id ? 'Safest' : null,
      route.id === fastest.id ? 'Fastest' : null,
      route.id === balanced.id ? 'Balanced' : null,
    ].filter(Boolean)
    return { ...route, label: labels.join(' · ') || 'Alternative' }
  })
}
