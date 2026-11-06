'use client'

import { useState, type FormEvent } from 'react'
import { AlertTriangle, Copy, LifeBuoy, MapPin, Phone, Plus, Share2, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GeoPoint } from '@/lib/floodaware'

type Helpline = { id: string; name: string; phone: string }

export function SafetySection({ point, locationIsDevice }: { point: GeoPoint; locationIsDevice: boolean }) {
  const [helplines, setHelplines] = useState<Helpline[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState('')

  async function shareLocation() {
    const url = `https://www.openstreetmap.org/?mlat=${point.latitude.toFixed(5)}&mlon=${point.longitude.toFixed(5)}#map=17/${point.latitude.toFixed(5)}/${point.longitude.toFixed(5)}`
    const message = `${locationIsDevice ? 'My location' : 'Selected map point'}: ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'FloodAware location', text: message, url })
        setStatus(locationIsDevice ? 'Location shared.' : 'Selected map point shared.')
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message)
        setStatus('Location link copied. Paste it into a message to share.')
        return
      }
      setStatus('Sharing is not available in this browser. Use the coordinates shown below.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setStatus('The location link could not be shared. Try copying the coordinates below.')
    }
  }

  function addHelpline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPhone = phone.trim().replace(/[^0-9+]/g, '')
    if (!name.trim() || !normalizedPhone || !/[0-9]/.test(normalizedPhone)) {
      setStatus('Enter a helpline name and a valid phone number.')
      return
    }
    setHelplines((current) => [...current, { id: crypto.randomUUID(), name: name.trim(), phone: normalizedPhone }])
    setName('')
    setPhone('')
    setStatus('Helpline added for this browser session.')
  }

  return (
    <section id="safety" className="safety-section section-shell" aria-labelledby="safety-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Before, during, and after a flood</p>
          <h2 id="safety-title">Safety & emergency help</h2>
        </div>
        <span className="safety-alert"><AlertTriangle size={17} aria-hidden="true" /> If in immediate danger, call emergency services.</span>
      </div>
      <div className="safety-grid">
        <article className="safety-card emergency-card">
          <div className="safety-card-title"><span className="safety-icon"><LifeBuoy size={22} aria-hidden="true" /></span><div><p className="feature-eyebrow">India emergency numbers</p><h3>Call for urgent help</h3></div></div>
          <p className="safety-body">Use emergency services if someone is trapped, injured, or at immediate risk. Calling may depend on mobile coverage.</p>
          <div className="emergency-links">
            <a className="emergency-link" href="tel:112"><Phone size={20} aria-hidden="true" /><span><strong>112</strong><small>Emergency response</small></span></a>
            <a className="emergency-link" href="tel:108"><Phone size={20} aria-hidden="true" /><span><strong>108</strong><small>Ambulance</small></span></a>
          </div>
          <div className="location-share-block">
            <div><strong>{locationIsDevice ? 'Share your location' : 'Share selected map point'}</strong><span>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</span></div>
            <Button type="button" variant="outline" className="secondary-button" onClick={() => void shareLocation()}>
              <Share2 data-icon="inline-start" aria-hidden="true" /> Share
            </Button>
          </div>
          {status && <p className="safety-status" role="status">{status}</p>}
        </article>

        <article className="safety-card">
          <div className="safety-card-title"><span className="safety-icon"><ShieldCheck size={22} aria-hidden="true" /></span><div><p className="feature-eyebrow">Simple steps</p><h3>Stay safer in floodwater</h3></div></div>
          <ul className="safety-tips">
            <li><strong>Do not walk or drive through moving water.</strong> Depth and current are difficult to judge.</li>
            <li>Move to higher ground and follow local authorities&apos; evacuation instructions.</li>
            <li>Avoid underpasses, drains, and electrical equipment near floodwater.</li>
            <li>Keep your phone charged and share your location with someone you trust.</li>
          </ul>
        </article>

        <article className="safety-card helpline-card">
          <div className="safety-card-title"><span className="safety-icon"><MapPin size={22} aria-hidden="true" /></span><div><p className="feature-eyebrow">Your local contacts</p><h3>Disaster helplines</h3></div></div>
          <p className="safety-body">Add trusted local contacts for this session. They will not be saved after the page closes.</p>
          {helplines.length > 0 && (
            <ul className="helpline-list">
              {helplines.map((helpline) => (
                <li key={helpline.id}>
                  <span><strong>{helpline.name}</strong><small>{helpline.phone}</small></span>
                  <div>
                    <a className="icon-button" href={`tel:${helpline.phone}`} aria-label={`Call ${helpline.name}`}><Phone size={17} aria-hidden="true" /></a>
                    <button className="icon-button" type="button" aria-label={`Remove ${helpline.name}`} onClick={() => setHelplines((current) => current.filter((item) => item.id !== helpline.id))}><Trash2 size={17} aria-hidden="true" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className="helpline-form" onSubmit={addHelpline}>
            <label className="field-label" htmlFor="helpline-name">Contact name</label>
            <input className="form-input" id="helpline-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="District control room" maxLength={80} required />
            <label className="field-label" htmlFor="helpline-phone">Phone number</label>
            <input className="form-input" id="helpline-phone" type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Enter a local number" maxLength={30} required />
            <Button type="submit" variant="outline" className="secondary-button helpline-add"><Plus data-icon="inline-start" aria-hidden="true" /> Add helpline</Button>
          </form>
        </article>
      </div>
      <p className="safety-disclaimer">Safety information is general guidance, not a substitute for instructions from local emergency authorities.</p>
    </section>
  )
}
