'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ForecastHour } from '@/lib/floodaware'

export function RainChart({ hours, compact = false }: { hours: ForecastHour[]; compact?: boolean }) {
  if (hours.length === 0) {
    return <div className="chart-empty">Forecast values are not available for this location.</div>
  }

  const data = hours.map((hour) => ({
    time: hour.time.slice(11, 16),
    rainfall: hour.precipitationMm ?? undefined,
    probability: hour.probability ?? undefined,
  }))

  return (
    <div className={`rain-chart ${compact ? 'rain-chart-compact' : ''}`} aria-label="12-hour rainfall and precipitation probability chart">
      <ResponsiveContainer width="100%" height={compact ? 112 : 220}>
        <BarChart data={data} margin={{ top: 12, right: compact ? 0 : 8, left: compact ? -28 : -20, bottom: 2 }}>
          <CartesianGrid vertical={false} stroke="var(--sage)" strokeDasharray="3 5" />
          <XAxis
            dataKey="time"
            interval={compact ? 3 : 1}
            tick={{ fill: 'var(--burgundy)', fontSize: 14, fontWeight: 600 }}
            axisLine={{ stroke: 'var(--burgundy)' }}
            tickLine={{ stroke: 'var(--burgundy)' }}
          />
          {!compact && (
            <YAxis
              yAxisId="rain"
              width={34}
              tick={{ fill: 'var(--burgundy)', fontSize: 14, fontWeight: 600 }}
              axisLine={{ stroke: 'var(--burgundy)' }}
              tickLine={{ stroke: 'var(--burgundy)' }}
              label={{ value: 'mm', angle: -90, position: 'insideLeft', fill: 'var(--burgundy)', fontSize: 12 }}
            />
          )}
          {!compact && (
            <YAxis
              yAxisId="probability"
              orientation="right"
              domain={[0, 100]}
              width={38}
              tick={{ fill: 'var(--burgundy)', fontSize: 14, fontWeight: 600 }}
              axisLine={{ stroke: 'var(--burgundy)' }}
              tickLine={{ stroke: 'var(--burgundy)' }}
              label={{ value: '%', angle: 90, position: 'insideRight', fill: 'var(--burgundy)', fontSize: 12 }}
            />
          )}
          <Tooltip
            cursor={{ fill: 'var(--sage)', fillOpacity: 0.28 }}
            contentStyle={{ background: 'var(--cream)', border: '1px solid var(--burgundy)', borderRadius: 12, color: 'var(--burgundy)', fontSize: 14, fontWeight: 600 }}
            labelStyle={{ color: 'var(--burgundy)', fontWeight: 700 }}
            formatter={(value, name) => [
              value === undefined ? 'Unavailable' : name === 'Probability' ? `${value}%` : `${value} mm`,
              name,
            ]}
          />
          <Bar
            yAxisId={compact ? undefined : 'rain'}
            dataKey="rainfall"
            name="Rainfall"
            fill="var(--burgundy)"
            radius={[4, 4, 0, 0]}
            maxBarSize={compact ? 12 : 20}
          />
          <Bar
            yAxisId={compact ? undefined : 'probability'}
            dataKey="probability"
            name="Probability"
            fill="var(--burgundy-tint)"
            radius={[4, 4, 0, 0]}
            maxBarSize={compact ? 12 : 20}
          />
        </BarChart>
      </ResponsiveContainer>
      {!compact && (
        <div className="chart-legend" aria-label="Chart legend">
          <span><i className="chart-key chart-key-solid" aria-hidden="true" /> Rainfall (mm)</span>
          <span><i className="chart-key chart-key-tint" aria-hidden="true" /> Precipitation probability (%)</span>
        </div>
      )}
    </div>
  )
}
