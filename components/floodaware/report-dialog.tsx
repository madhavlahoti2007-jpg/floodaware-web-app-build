'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Crosshair, MapPin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FLOOD_LEVELS, type FloodReport, type GeoPoint } from '@/lib/floodaware'

export type NewReportInput = Pick<
  FloodReport,
  'latitude' | 'longitude' | 'severity' | 'description' | 'reporterName' | 'photoDataUrl'
>

type ReportDialogProps = {
  open: boolean
  point: GeoPoint
  onClose: () => void
  onPickOnMap: () => void
  onUseMyLocation: () => void
  onSubmit: (report: NewReportInput) => Promise<{ error?: string } | void>
  backendReady: boolean
}

export function ReportDialog({ open, point, onClose, onPickOnMap, onUseMyLocation, onSubmit, backendReady }: ReportDialogProps) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [severity, setSeverity] = useState<(typeof FLOOD_LEVELS)[number]['name']>('Knee-deep')
  const [description, setDescription] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    const timeout = window.setTimeout(() => descriptionRef.current?.focus(), 50)
    return () => {
      document.body.style.overflow = ''
      window.clearTimeout(timeout)
    }
  }, [open])

  if (!open) return null

  function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setError('')
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.')
      event.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Images must be 2 MB or smaller.')
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPhotoDataUrl(typeof reader.result === 'string' ? reader.result : null)
      setPhotoName(file.name)
    }
    reader.onerror = () => setError('That image could not be read. Try another file.')
    reader.readAsDataURL(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedDescription = description.trim()
    if (trimmedDescription.length < 10) {
      setError('Add at least 10 characters so others can understand the hazard.')
      return
    }
    if (trimmedDescription.length > 500) {
      setError('Keep the description under 500 characters.')
      return
    }
    if (point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
      setError('Choose a valid map location before submitting.')
      return
    }
    if (!backendReady) {
      setError('Supabase reporting is not ready. No report was saved.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      const result = await onSubmit({
        latitude: point.latitude,
        longitude: point.longitude,
        severity,
        description: trimmedDescription,
        reporterName: reporterName.trim() || null,
        photoDataUrl,
      })
      if (result?.error) {
        setError(result.error)
        return
      }
      setDescription('')
      setReporterName('')
      setPhotoDataUrl(null)
      setPhotoName('')
      setSeverity('Knee-deep')
      setError('')
    } catch {
      setError('The report could not be submitted. Try again when the connection is available.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" aria-describedby="report-description">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Community report</p>
            <h2 id="report-title">Report waterlogging</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close report form" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p id="report-description" className="dialog-intro">
          Share what you can see. Reports are advisory and should not include private or identifying details.
        </p>
        {!backendReady && <p className="panel-notice panel-notice--warning" role="status">Supabase reporting is not set up yet. This form will not save a report until database setup is complete.</p>}
        <form className="report-form" onSubmit={handleSubmit}>
          <fieldset className="form-fieldset">
            <legend className="field-label">Water depth</legend>
            <div className="severity-options" role="radiogroup" aria-label="Water depth">
              {FLOOD_LEVELS.map((level) => (
                <button
                  className={`severity-option ${severity === level.name ? 'severity-option-active' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={severity === level.name}
                  key={level.name}
                  onClick={() => setSeverity(level.name)}
                >
                  <span className={`severity-dot severity-dot--${level.name.toLowerCase().replace('-deep', '').replace(' ', '-')}`} aria-hidden="true" />
                  {level.name}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="form-field">
            <label className="field-label" htmlFor="report-description-input">What is happening?</label>
            <textarea
              ref={descriptionRef}
              id="report-description-input"
              className="form-input report-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="For example: water is covering the left lane near the underpass."
              minLength={10}
              maxLength={500}
              rows={3}
              required
            />
            <p className="field-hint">{description.length} / 500 characters · Avoid entering private details.</p>
          </div>

          <div className="form-field">
            <span className="field-label">Report location</span>
            <div className="pin-summary">
              <MapPin size={18} aria-hidden="true" />
              <span>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</span>
            </div>
            <div className="pin-actions">
              <button className="secondary-action" type="button" onClick={onPickOnMap}>
                <MapPin size={17} aria-hidden="true" /> Pick on map
              </button>
              <button className="secondary-action" type="button" onClick={onUseMyLocation}>
                <Crosshair size={17} aria-hidden="true" /> Use my location
              </button>
            </div>
          </div>

          <div className="form-field">
            <label className="field-label" htmlFor="report-photo">Photo (optional)</label>
            <label className="upload-control" htmlFor="report-photo">
              <Camera size={18} aria-hidden="true" />
              <span>{photoName || 'Add a photo · image up to 2 MB'}</span>
            </label>
            <input id="report-photo" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} />
            {photoDataUrl && <img className="report-photo-preview" src={photoDataUrl} alt="Preview of selected flood report photo" />}
          </div>

          <div className="form-field">
            <label className="field-label" htmlFor="reporter-name">Name (optional)</label>
            <input
              id="reporter-name"
              className="form-input"
              value={reporterName}
              onChange={(event) => setReporterName(event.target.value)}
              placeholder="Report anonymously"
              maxLength={60}
            />
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button type="button" variant="outline" className="secondary-button" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="primary-button" disabled={isSubmitting || !backendReady}>{isSubmitting ? 'Submitting…' : 'Submit verification report'}</Button>
          </div>
          <p className="form-privacy-note">Do not enter sensitive personal information. Reports are advisory, not emergency dispatch.</p>
        </form>
      </section>
    </div>
  )
}
