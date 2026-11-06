import type {
  CachedResult,
  ElevationSample,
  ForecastHour,
  GeoPoint,
  Place,
  RawRoute,
  RiverPayload,
  UnderpassSpot,
  WeatherPayload,
  TravelMode,
} from '@/lib/floodaware'

const CACHE_PREFIX = 'floodaware:public-cache:'
const NOMINATIM_GAP_MS = 1_100
let nextNominatimSlot = 0

function readCache<T>(key: string): CachedResult<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${key}`)
    if (!raw) return null
    const value = JSON.parse(raw) as { data: T; updatedAt: number }
    if (!value || typeof value.updatedAt !== 'number' || !('data' in value)) return null
    return { data: value.data, updatedAt: value.updatedAt, stale: false }
  } catch {
    return null
  }
}

async function fetchCached<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<CachedResult<T>> {
  const cached = readCache<T>(key)
  if (!force && cached && Date.now() - cached.updatedAt < ttlMs) return cached

  try {
    const data = await load()
    const result = { data, updatedAt: Date.now(), stale: false }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(result))
      } catch {
        // The live response remains usable when browser storage is unavailable or full.
      }
    }
    return result
  } catch (error) {
    if (cached) return { ...cached, stale: true }
    throw error
  }
}

async function checkedJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Data service returned ${response.status}`)
  return response.json() as Promise<T>
}

function coordinateKey(point: GeoPoint) {
  return `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`
}

export function fetchWeather(point: GeoPoint, force = false) {
  const key = coordinateKey(point)
  return fetchCached<WeatherPayload>(`weather:${key}`, 10 * 60_000, async () => {
    const query = new URLSearchParams({
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      current: 'precipitation,rain',
      hourly: 'precipitation,precipitation_probability',
      daily: 'precipitation_sum',
      forecast_days: '2',
      timezone: 'auto',
    })
    const json = await checkedJson<{
      current?: { time?: string; precipitation?: number | null; rain?: number | null }
      hourly?: { time?: string[]; precipitation?: Array<number | null>; precipitation_probability?: Array<number | null> }
      daily?: { precipitation_sum?: Array<number | null> }
    }>(`https://api.open-meteo.com/v1/forecast?${query}`)

    const times = json.hourly?.time ?? []
    const precipitation = json.hourly?.precipitation ?? []
    const probabilities = json.hourly?.precipitation_probability ?? []
    const nowIndex = Math.max(0, times.findIndex((time) => time >= (json.current?.time ?? '')))
    const hours: ForecastHour[] = times.slice(nowIndex, nowIndex + 12).map((time, index) => {
      const sourceIndex = nowIndex + index
      return {
        time,
        precipitationMm: precipitation[sourceIndex] ?? null,
        probability: probabilities[sourceIndex] ?? null,
      }
    })

    return {
      currentRainMmHr: json.current?.rain ?? json.current?.precipitation ?? null,
      todayTotalMm: json.daily?.precipitation_sum?.[0] ?? null,
      hours,
    }
  }, force)
}

export function fetchRiverOutlook(point: GeoPoint, force = false) {
  const key = coordinateKey(point)
  return fetchCached<RiverPayload>(`river:${key}`, 30 * 60_000, async () => {
    const query = new URLSearchParams({
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      daily: 'river_discharge',
      past_days: '3',
      forecast_days: '5',
      timezone: 'auto',
    })
    const json = await checkedJson<{
      daily?: { time?: string[]; river_discharge?: Array<number | null> }
    }>(`https://flood-api.open-meteo.com/v1/flood?${query}`)
    const dates = json.daily?.time ?? []
    const values = json.daily?.river_discharge ?? []
    const series = dates.map((date, index) => ({ date, discharge: values[index] ?? null }))
    const today = new Intl.DateTimeFormat('en-CA').format(new Date())
    const todayIndex = dates.findIndex((date) => date >= today)
    const currentIndex = todayIndex < 0 ? dates.length - 1 : todayIndex
    const currentDischarge = values[currentIndex] ?? null
    const previous = values[Math.max(0, currentIndex - 1)] ?? null
    const tolerance = previous === null || currentDischarge === null ? 0 : Math.max(0.05, Math.abs(previous) * 0.03)
    const difference = currentDischarge === null || previous === null ? 0 : currentDischarge - previous
    const trend = currentDischarge === null || previous === null
      ? 'Unavailable'
      : difference > tolerance
        ? 'Rising'
        : difference < -tolerance
          ? 'Falling'
          : 'Steady'

    return { currentDischarge, trend, series }
  }, force)
}

export function fetchElevationGrid(point: GeoPoint, force = false) {
  const key = coordinateKey(point)
  return fetchCached<ElevationSample[]>(`elevation:${key}`, 30 * 60_000, async () => {
    const offsets = [-0.02, 0, 0.02]
    const coordinates = offsets.flatMap((latitudeOffset) =>
      offsets.map((longitudeOffset) => ({
        latitude: point.latitude + latitudeOffset,
        longitude: point.longitude + longitudeOffset,
      })),
    )
    const query = new URLSearchParams({
      latitude: coordinates.map((coordinate) => coordinate.latitude.toFixed(5)).join(','),
      longitude: coordinates.map((coordinate) => coordinate.longitude.toFixed(5)).join(','),
    })
    const json = await checkedJson<{ elevation?: Array<number | null> }>(`https://api.open-meteo.com/v1/elevation?${query}`)
    return coordinates.flatMap((coordinate, index) => {
      const meters = json.elevation?.[index]
      return typeof meters === 'number' && Number.isFinite(meters) ? [{ ...coordinate, meters }] : []
    })
  }, force)
}

export function fetchUnderpasses(point: GeoPoint, force = false) {
  const key = coordinateKey(point)
  return fetchCached<UnderpassSpot[]>(`underpasses:${key}`, 30 * 60_000, async () => {
    const query = `[out:json][timeout:25];(way(around:3000,${point.latitude},${point.longitude})[highway][tunnel~"^(yes|culvert|building_passage)$"];way(around:3000,${point.latitude},${point.longitude})[highway][layer="-1"];way(around:3000,${point.latitude},${point.longitude})[highway][bridge="underpass"];way(around:3000,${point.latitude},${point.longitude})[highway][bridge][maxheight];node(around:3000,${point.latitude},${point.longitude})[tunnel="yes"];);out center tags 100;`
    const url = `https://overpass-api.de/api/interpreter?${new URLSearchParams({ data: query })}`
    const json = await checkedJson<{
      elements?: Array<{
        id: number
        lat?: number
        lon?: number
        center?: { lat?: number; lon?: number }
        tags?: Record<string, string>
      }>
    }>(url)
    const unique = new Map<string, UnderpassSpot>()
    for (const element of json.elements ?? []) {
      const latitude = element.lat ?? element.center?.lat
      const longitude = element.lon ?? element.center?.lon
      if (typeof latitude !== 'number' || typeof longitude !== 'number') continue
      const tags = element.tags ?? {}
      const kind = tags.tunnel ?? (tags.layer === '-1' ? 'layer -1' : 'underpass')
      unique.set(String(element.id), {
        id: String(element.id),
        latitude,
        longitude,
        name: tags.name || tags.ref || 'OSM-tagged low spot',
        kind,
      })
    }
    return [...unique.values()]
  }, force)
}

function queueNominatimRequest<T>(request: () => Promise<T>) {
  const scheduledAt = Math.max(Date.now(), nextNominatimSlot)
  nextNominatimSlot = scheduledAt + NOMINATIM_GAP_MS
  return new Promise<T>((resolve, reject) => {
    window.setTimeout(() => {
      request().then(resolve, reject)
    }, Math.max(0, scheduledAt - Date.now()))
  })
}

export function searchPlaces(query: string) {
  const normalized = query.trim()
  return fetchCached<Place[]>(`geocode:${normalized.toLowerCase()}`, 24 * 60 * 60_000, async () => {
    const results = await queueNominatimRequest(() => checkedJson<Array<{
      lat: string
      lon: string
      display_name: string
    }>>(`/api/geocode?q=${encodeURIComponent(normalized)}`))
    return results.flatMap((result) => {
      const latitude = Number(result.lat)
      const longitude = Number(result.lon)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
      return [{ latitude, longitude, displayName: result.display_name }]
    })
  })
}

export function reversePlaceName(point: GeoPoint) {
  const key = coordinateKey(point)
  return fetchCached<string>(`reverse:${key}`, 24 * 60 * 60_000, async () => {
    const result = await queueNominatimRequest(() => checkedJson<{
      name?: string
      display_name?: string
      address?: Record<string, string>
    }>(`/api/geocode?latitude=${point.latitude}&longitude=${point.longitude}`))
    const address = result.address ?? {}
    return result.name || address.neighbourhood || address.suburb || address.quarter || address.city_district || address.city || address.town || address.village || result.display_name || 'Area name unavailable'
  })
}

function sampleRouteCoordinates(coordinates: [number, number][], count = 10) {
  if (coordinates.length === 0) return []
  if (coordinates.length <= count) return coordinates
  const samples: [number, number][] = []
  const step = (coordinates.length - 1) / (count - 1)
  for (let index = 0; index < count; index += 1) samples.push(coordinates[Math.round(index * step)])
  return samples
}

export function fetchRoutes(start: GeoPoint, destination: GeoPoint, force = false, mode: TravelMode = 'drive') {
  const key = `${mode}:${coordinateKey(start)}:${coordinateKey(destination)}`
  return fetchCached<{ routes: RawRoute[] }>(`routes:${key}`, 60_000, async () => {
    const service = mode === 'drive' ? 'https://router.project-osrm.org/route/v1/driving' : mode === 'walk' ? 'https://routing.openstreetmap.de/routed-foot/route/v1/driving' : 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
    const url = `${service}/${start.longitude},${start.latitude};${destination.longitude},${destination.latitude}?alternatives=true&geometries=geojson&overview=full&steps=false`
    const response = await checkedJson<{
      code?: string
      routes?: Array<{
        distance: number
        duration: number
        geometry?: { coordinates?: [number, number][] }
      }>
    }>(url)
    if (response.code !== 'Ok' || !response.routes?.length) throw new Error('No road route was returned for those locations.')

    const routeSamples = response.routes.map((route) => sampleRouteCoordinates(route.geometry?.coordinates ?? []))
    const allSamples = routeSamples.flat()
    let elevationValues: Array<number | null> = []
    if (allSamples.length > 0) {
      try {
        const query = new URLSearchParams({
          latitude: allSamples.map((coordinate) => coordinate[1].toFixed(5)).join(','),
          longitude: allSamples.map((coordinate) => coordinate[0].toFixed(5)).join(','),
        })
        const elevation = await checkedJson<{ elevation?: Array<number | null> }>(`https://api.open-meteo.com/v1/elevation?${query}`)
        elevationValues = elevation.elevation ?? []
      } catch {
        elevationValues = []
      }
    }

    let offset = 0
    const routes = response.routes.flatMap((route, index) => {
      const coordinates = route.geometry?.coordinates ?? []
      if (coordinates.length < 2) return []
      const samples = routeSamples[index]
      const elevations = elevationValues.slice(offset, offset + samples.length).flatMap((value) =>
        typeof value === 'number' && Number.isFinite(value) ? [value] : [],
      )
      offset += samples.length
      return [{
        id: `route-${index + 1}`,
        coordinates,
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        elevations,
      }]
    })
    return { routes }
  }, force)
}
