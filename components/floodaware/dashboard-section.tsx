'use client'

import { Activity, ArrowUpRight, Clock3, MapPin, ShieldAlert } from 'lucide-react'
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import useSWR from 'swr'
import type { CachedResult, FloodReport, RiskZone } from '@/lib/floodaware'
import { isReportActive } from '@/lib/floodaware'
import { reversePlaceName } from '@/lib/floodaware-api'

function HotspotName({ zone }: { zone: RiskZone }) {
  const key = ['reverse-place', zone.latitude.toFixed(4), zone.longitude.toFixed(4)]
  const { data } = useSWR<CachedResult<string>>(key, ([, latitude, longitude]) =>
    reversePlaceName({ latitude: Number(latitude), longitude: Number(longitude) }),
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  )
  return <span>{data?.data ?? 'Locating area name…'}</span>
}

function reportsByFourHourBucket(reports: FloodReport[], now: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const end = now - (5 - index) * 4 * 60 * 60_000
    const start = end - 4 * 60 * 60_000
    const count = reports.filter((report) => report.createdAt > start && report.createdAt <= end).length
    const label = index === 5 ? 'Now' : `${(5 - index) * 4}h ago`
    return { period: label, reports: count }
  })
}

export function DashboardSection({
  reports,
  zones,
  onViewZone,
  now,
}: {
  reports: FloodReport[]
  zones: RiskZone[]
  onViewZone: (zone: RiskZone) => void
  now: number
}) {
  const active = reports.filter((report) => isReportActive(report, now))
  const resolvedToday = reports.filter((report) => report.resolved && report.resolvedAt && now - report.resolvedAt < 24 * 60 * 60_000)
  const recent = reports.filter((report) => now - report.createdAt < 24 * 60 * 60_000)
  const hotspots = zones.filter((zone) => zone.level === 'High' || zone.level === 'Severe').sort((a, b) => b.score - a.score).slice(0, 4)
  const allDemo = reports.length > 0 && reports.every((report) => report.isDemo)
  const chartData = reportsByFourHourBucket(reports, now)

  return (
    <section id="dashboard" className="dashboard-section section-shell" aria-labelledby="dashboard-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Live situation overview</p>
          <h2 id="dashboard-title">Flood dashboard</h2>
        </div>
        <span className="dashboard-scope"><Activity size={17} aria-hidden="true" /> {allDemo ? 'Demo reports · session view' : 'Current browser session'}</span>
      </div>
      <div className="dashboard-grid">
        <article className="dashboard-card dashboard-chart-card">
          <div className="dashboard-card-heading">
            <div><p className="feature-eyebrow">Community activity</p><h3>Reports over the last 24 hours</h3></div>
            <span className="chart-label">{allDemo ? 'Demo + session' : 'Session data'}</span>
          </div>
          {reports.length > 0 ? (
            <div className="dashboard-chart" aria-label="Flood reports grouped into four-hour periods over the last 24 hours">
              <ResponsiveContainer width="100%" height={238}>
                <LineChart data={chartData} margin={{ top: 12, right: 18, left: -15, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--sage)" strokeDasharray="3 5" />
                  <XAxis dataKey="period" tick={{ fill: 'var(--burgundy)', fontSize: 12, fontWeight: 600 }} axisLine={{ stroke: 'var(--burgundy)' }} tickLine={{ stroke: 'var(--burgundy)' }} />
                  <YAxis allowDecimals={false} width={36} tick={{ fill: 'var(--burgundy)', fontSize: 12, fontWeight: 600 }} axisLine={{ stroke: 'var(--burgundy)' }} tickLine={{ stroke: 'var(--burgundy)' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--cream)', border: '1px solid var(--burgundy)', borderRadius: 12, color: 'var(--burgundy)', fontSize: 13, fontWeight: 600 }}
                    labelStyle={{ color: 'var(--burgundy)', fontWeight: 700 }}
                    formatter={(value) => [`${value} reports`, 'Community activity']}
                  />
                  <Line type="monotone" dataKey="reports" stroke="var(--burgundy)" strokeWidth={3} dot={{ r: 4, fill: 'var(--cream)', stroke: 'var(--burgundy)', strokeWidth: 2 }} activeDot={{ r: 6, fill: 'var(--burgundy)' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="dashboard-empty"><Activity size={26} aria-hidden="true" /><p>No community reports are available in this session.</p></div>
          )}
          <p className="dashboard-chart-note">Counts are grouped from reports currently held in this browser session. No report history is stored.</p>
        </article>

        <article className="dashboard-card hotspot-card">
          <div className="dashboard-card-heading">
            <div><p className="feature-eyebrow">Highest advisory score</p><h3>Current hotspots</h3></div>
            <ShieldAlert size={22} aria-hidden="true" />
          </div>
          {hotspots.length ? (
            <ol className="hotspot-list">
              {hotspots.map((zone, index) => (
                <li key={zone.id}>
                  <div className="hotspot-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</div>
                  <div className="hotspot-info">
                    <strong><HotspotName zone={zone} /></strong>
                    <span>{zone.level} advisory · {zone.report.severity} report{zone.report.isDemo ? ' · Demo' : ''}</span>
                  </div>
                  <button className="icon-button hotspot-view" type="button" aria-label={`View ${zone.level.toLowerCase()} risk zone on map`} onClick={() => onViewZone(zone)}>
                    <ArrowUpRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="dashboard-empty"><MapPin size={26} aria-hidden="true" /><p>No high or severe zones are present in the current report set.</p></div>
          )}
          <div className="hotspot-footer"><Clock3 size={16} aria-hidden="true" /><span>Scores update from active reports and available local conditions.</span></div>
        </article>
      </div>
      <div className="dashboard-stats" aria-label="Flood dashboard summary">
        <article className="stat-card"><span>Active reports</span><strong>{active.length || 'None'}</strong><small>{active.length ? 'expire after 6 hours without reconfirmation' : 'no active reports in this session'}</small></article>
        <article className="stat-card"><span>Reports in 24 hours</span><strong>{recent.length || 'None'}</strong><small>{allDemo ? 'includes clearly labeled demo entries' : 'session-only report activity'}</small></article>
        <article className="stat-card"><span>Resolved reports</span><strong>{resolvedToday.length || 'None'}</strong><small>marked cleared in the current session</small></article>
        <article className="stat-card"><span>High-risk zones</span><strong>{hotspots.length || 'None'}</strong><small>derived from reports, rain, and relative elevation</small></article>
      </div>
      <p className="dashboard-disclaimer">No Supabase connection was added. Reports and confirmations are not shared with other users or retained after the page is closed.</p>
    </section>
  )
}
