// src/components/leads/CityAutocomplete.jsx
//
// Phase 34Z.11 — typeahead bound to the cities master so reps don't
// type "Anand" / "Adam" / "Anad" three different ways. Owner directive
// (14 May 2026):
//   "i need a prefilled data in the back end. for example, when
//    someone type a-n-d, then he should see Anand and related,
//    filtered name. because some reps add 'Anad', another adds
//    spelling differently, so we cannot filter it out."
//
// Behaviour:
//   • Single text input shaped like the existing .lead-inp.
//   • Fetches `cities` (is_active=true) once on first mount; caches in
//     module scope so other instances reuse the list.
//   • Filters case-insensitive substring as the user types.
//   • Dropdown limited to top 8 matches, click → fills + onChange.
//   • Free-text still allowed — if the rep types a brand-new city,
//     save proceeds (no hard validation). Phase 4+ would auto-create.
//   • Dropdown closes on blur / Escape / outside-click.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

let CITY_CACHE = null
let CITY_INFLIGHT = null

async function loadCities() {
  if (CITY_CACHE) return CITY_CACHE
  if (CITY_INFLIGHT) return CITY_INFLIGHT
  CITY_INFLIGHT = supabase
    .from('cities')
    .select('name')
    .eq('is_active', true)
    .order('name')
    .then(({ data }) => {
      CITY_CACHE = (data || []).map((c) => c.name).filter(Boolean)
      CITY_INFLIGHT = null
      return CITY_CACHE
    })
  return CITY_INFLIGHT
}

export default function CityAutocomplete({
  value,
  onChange,
  onBlur,
  placeholder = 'e.g. Vadodara',
  className = 'lead-inp',
  disabled = false,
  required = false,
}) {
  const [cities, setCities] = useState(CITY_CACHE || [])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!CITY_CACHE) {
      loadCities().then((list) => setCities(list))
    }
  }, [])

  // Close dropdown on outside click.
  useEffect(() => {
    function handleDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [])

  const q = String(value || '').trim().toLowerCase()
  const suggestions = q
    ? cities.filter((c) => c.toLowerCase().includes(q)).slice(0, 8)
    : cities.slice(0, 8)

  // Exact-match check — when a rep types exactly an existing city we
  // hide the dropdown so the suggestion list doesn't hover over the
  // next field unnecessarily.
  const exact = q && cities.some((c) => c.toLowerCase() === q)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className={className}
        value={value || ''}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          // Defer so a click on a suggestion lands before close.
          setTimeout(() => setOpen(false), 120)
          if (onBlur) onBlur(e)
        }}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
      />
      {open && !exact && suggestions.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--v2-bg-1, var(--surface))',
            border: '1px solid var(--v2-line, var(--border))',
            borderRadius: 'var(--radius, 10px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.30)',
            zIndex: 30,
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((name) => (
            <div
              key={name}
              role="option"
              onMouseDown={(e) => {
                // Use onMouseDown (fires before input's blur) so the
                // click doesn't get eaten by the close-on-blur timer.
                e.preventDefault()
                onChange(name)
                setOpen(false)
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--text)',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
