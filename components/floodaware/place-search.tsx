'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { MapPin, Search } from 'lucide-react'
import type { CachedResult, Place } from '@/lib/floodaware'
import { searchPlaces } from '@/lib/floodaware-api'

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(timeout)
  }, [value, delay])
  return debouncedValue
}

export type PlaceSearchStatus = 'idle' | 'loading' | 'responded' | 'failed'

type PlaceSearchProps = {
  label: string
  placeholder: string
  value?: Place | null
  onSelect: (place: Place) => void
  onStatusChange?: (status: PlaceSearchStatus) => void
  className?: string
}

export function PlaceSearch({ label, placeholder, value, onSelect, onStatusChange, className = '' }: PlaceSearchProps) {
  const [query, setQuery] = useState(value?.displayName ?? '')
  const [open, setOpen] = useState(false)
  const debouncedQuery = useDebouncedValue(query.trim(), 550)
  const searchKey = debouncedQuery.length >= 3 ? ['geocode', debouncedQuery.toLowerCase()] : null
  const { data, error, isLoading, isValidating, mutate } = useSWR<CachedResult<Place[]>>(
    searchKey,
    ([, normalizedQuery]) => searchPlaces(String(normalizedQuery)),
    { dedupingInterval: 1_000, keepPreviousData: true, revalidateOnFocus: false },
  )
  const places = data?.data ?? []
  const status: PlaceSearchStatus = error ? 'failed' : isValidating ? 'loading' : data ? 'responded' : 'idle'

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  useEffect(() => {
    if (value) setQuery(value.displayName)
  }, [value])

  function selectPlace(place: Place) {
    setQuery(place.displayName)
    setOpen(false)
    onSelect(place)
  }

  return (
    <div className={`place-search ${className}`}>
      <label className="field-label" htmlFor={`place-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
        {label}
      </label>
      <div className="place-search-input-wrap">
        <Search aria-hidden="true" className="place-search-icon" size={18} />
        <input
          id={`place-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          className="form-input place-search-input"
          type="search"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && (places.length > 0 || Boolean(error))}
          aria-controls={`place-results-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229 && places[0]) {
              event.preventDefault()
              selectPlace(places[0])
            }
            if (event.key === 'Escape') setOpen(false)
          }}
        />
      </div>
      {open && (query.trim().length >= 3 || isLoading || error) && (
        <div
          className="place-search-results"
          id={`place-results-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {isLoading && !data && <p className="place-search-message">Searching places…</p>}
          {error && !data && (
            <div className="place-search-message place-search-error">
              <span>Place search is unavailable.</span>
              <button className="text-link" type="button" onClick={() => void mutate()}>
                Retry
              </button>
            </div>
          )}
          {places.map((place) => (
            <button
              className="place-search-option"
              type="button"
              role="option"
              aria-selected={value?.displayName === place.displayName}
              key={`${place.latitude}-${place.longitude}-${place.displayName}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectPlace(place)}
            >
              <MapPin aria-hidden="true" size={17} />
              <span>{place.displayName}</span>
            </button>
          ))}
          {!isLoading && !error && debouncedQuery.length >= 3 && places.length === 0 && (
            <p className="place-search-message">No matching places found.</p>
          )}
        </div>
      )}
    </div>
  )
}
