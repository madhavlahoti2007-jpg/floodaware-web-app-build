'use client'

import { useState } from 'react'
import { ArrowUpRight, CloudRain, Database, Map, RotateCcw, ShieldAlert, Waves } from 'lucide-react'
import { Button } from '@/components/ui/button'

const sources = [
  { name: 'Open-Meteo Forecast API', description: 'Current rainfall and hourly precipitation forecast.', href: 'https://open-meteo.com/en/docs' },
  { name: 'Open-Meteo Flood API', description: 'Daily river-discharge outlook where coverage is available.', href: 'https://open-meteo.com/en/docs/flood-api' },
  { name: 'OpenStreetMap', description: 'Map tiles and community-mapped underpass features.', href: 'https://www.openstreetmap.org/copyright' },
  { name: 'Nominatim', description: 'Place search and area labels, rate-limited to one request per second.', href: 'https://operations.osmfoundation.org/policies/nominatim/' },
  { name: 'OSRM', description: 'Road-route alternatives used for route comparison.', href: 'https://project-osrm.org/' },
]

export function AboutSection({ onResetDemo }: { onResetDemo: () => void }) {
  const [showReset, setShowReset] = useState(false)

  return (
    <section id="about" className="about-section section-shell" aria-labelledby="about-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">How the signals are assembled</p>
          <h2 id="about-title">About FloodAware</h2>
        </div>
        <span className="about-mark"><ShieldAlert size={20} aria-hidden="true" /> Advisory, not an authority</span>
      </div>
      <p className="about-lede">FloodAware brings public rainfall and map data together with community observations so people can make more informed choices during heavy rain.</p>
      <div className="data-flow" aria-label="FloodAware data flow">
        <div className="data-flow-card"><span><CloudRain size={22} aria-hidden="true" /></span><strong>Public conditions</strong><small>Rainfall · river outlook · elevation</small></div>
        <div className="data-flow-arrow" aria-hidden="true">→</div>
        <div className="data-flow-card"><span><Map size={22} aria-hidden="true" /></span><strong>Community + map</strong><small>Reports · mapped low spots · routes</small></div>
        <div className="data-flow-arrow" aria-hidden="true">→</div>
        <div className="data-flow-card"><span><Waves size={22} aria-hidden="true" /></span><strong>Local advisories</strong><small>Risk zones · route comparisons · safety</small></div>
      </div>
      <div className="about-data-note"><Database size={20} aria-hidden="true" /><p><strong>No database is connected.</strong> The initial map uses clearly marked demo reports. New reports, confirmations, and local helplines exist only in the current browser session.</p></div>
      <div className="source-list-heading"><h3>Data sources & attribution</h3><p>Live availability depends on the upstream public service.</p></div>
      <ul className="source-list">
        {sources.map((source) => (
          <li key={source.name}>
            <div><strong>{source.name}</strong><span>{source.description}</span></div>
            <a href={source.href} target="_blank" rel="noreferrer" aria-label={`Open ${source.name} in a new tab`}><ArrowUpRight size={18} aria-hidden="true" /></a>
          </li>
        ))}
      </ul>
      <p className="about-disclaimer">FloodAware is an informational prototype. Public data may be delayed or incomplete; route safety is not guaranteed. Never use the app as a substitute for emergency instructions.</p>
      <details className="demo-controls">
        <summary>Demo data controls</summary>
        <p>Restore the clearly marked starter reports after testing report creation, confirmation, or clear-vote actions.</p>
        <Button type="button" variant="outline" className="secondary-button" onClick={() => { onResetDemo(); setShowReset(true) }}>
          <RotateCcw data-icon="inline-start" aria-hidden="true" /> Reset demo reports
        </Button>
        {showReset && <span className="sr-only" aria-live="polite">Demo reports restored.</span>}
      </details>
    </section>
  )
}
