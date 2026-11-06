import { describe, expect, it } from 'vitest'
import { buildRiskZones, compareRoutes, type FloodReport, type RawRoute } from './floodaware'

function report(overrides: Partial<FloodReport> = {}): FloodReport {
  const now = Date.now()
  return {
    id: 'report-test',
    latitude: 17.38,
    longitude: 78.485,
    severity: 'Knee-deep',
    description: 'Water is covering one lane near the low point.',
    createdAt: now,
    updatedAt: now,
    lastConfirmedAt: now,
    confirmations: 2,
    clearedVotes: 0,
    resolved: false,
    resolvedAt: null,
    isDemo: false,
    reporterName: null,
    photoDataUrl: null,
    ...overrides,
  }
}

function route(id: string, coordinates: [number, number][]): RawRoute {
  return { id, coordinates, distanceMeters: 1200, durationSeconds: 600, elevations: [550, 548, 551] }
}

describe('flood risk scoring', () => {
  it('assigns a higher advisory score to deeper active reports', () => {
    const now = Date.now()
    const ankle = report({ id: 'ankle', severity: 'Ankle-deep', createdAt: now, lastConfirmedAt: now })
    const impassable = report({ id: 'blocked', severity: 'Impassable', createdAt: now, lastConfirmedAt: now })
    const zones = buildRiskZones([ankle, impassable], [], null)

    expect(zones).toHaveLength(2)
    expect(zones.find((zone) => zone.report.id === 'blocked')?.score).toBeGreaterThan(zones.find((zone) => zone.report.id === 'ankle')?.score ?? 0)
  })

  it('omits reports that have expired without reconfirmation', () => {
    const expired = report({ createdAt: Date.now() - 7 * 60 * 60_000, lastConfirmedAt: null })
    expect(buildRiskZones([expired], [], null)).toHaveLength(0)
  })
})

describe('hazard-aware route scoring', () => {
  it('scores a route through an impassable report as riskier than an alternative', () => {
    const hazard = report({ severity: 'Impassable', latitude: 17.38, longitude: 78.485 })
    const exposed = route('exposed', [[78.48, 17.38], [78.49, 17.38]])
    const alternative = route('alternative', [[78.48, 17.39], [78.49, 17.39]])
    const scored = compareRoutes([exposed, alternative], [hazard])
    const exposedScore = scored.find((item) => item.id === 'exposed')
    const alternativeScore = scored.find((item) => item.id === 'alternative')

    expect(exposedScore?.severeHazards).toHaveLength(1)
    expect(exposedScore?.riskScore).toBeGreaterThan(alternativeScore?.riskScore ?? 0)
    expect(alternativeScore?.label).toContain('Safest')
  })
})
