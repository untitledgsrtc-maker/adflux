// src/components/leads/PlaceSuggest.jsx
//
// Company-name input with Google listing suggestions (Log Meeting only).
// Same look as the other .lead-inp fields. The rep types 3+ letters, picks a
// listing, and onPick() hands back name / address / city / phone / website to
// fill the rest of the form. Free typing always works; if the search endpoint
// is unavailable the dropdown just never shows (no error, no blocking).
//
// Search goes through /api/directions?places=1 (server key, same-origin only). Only
// text the rep actually types is searched, never a prefilled or scanned value.

import { useEffect, useRef, useState } from 'react'

export default function PlaceSuggest({ value, onChange, onPick, near, placeholder }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const wrapRef = useRef(null)
  const typedRef = useRef(false)       // true only after the rep types in this field
  const brokenRef = useRef(false)      // endpoint failed once: stop calling it
  const pickLatchRef = useRef(false)   // ghost-click guard, same family as the save latches

  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q = String(value || '').trim()
  const nearLat = near?.lat
  const nearLng = near?.lng

  useEffect(() => {
    if (!typedRef.current || brokenRef.current || q.length < 3) { setResults([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const qs = new URLSearchParams({ q })
        if (Number.isFinite(nearLat) && Number.isFinite(nearLng)) {
          qs.set('lat', String(nearLat)); qs.set('lng', String(nearLng))
        }
        const r = await fetch(`/api/directions?places=1&${qs.toString()}`, { signal: ctrl.signal })
        if (!r.ok) { brokenRef.current = true; setResults([]); return }
        const j = await r.json()
        setResults(Array.isArray(j.results) ? j.results : [])
        setOpen(true)
      } catch (e) {
        if (e?.name !== 'AbortError') { brokenRef.current = true; setResults([]) }
      } finally {
        if (!ctrl.signal.aborted) setBusy(false)
      }
    }, 500)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q, nearLat, nearLng])

  async function pick(p) {
    if (pickLatchRef.current) return
    pickLatchRef.current = true
    setPicking(true)
    setOpen(false)
    onChange(p.name)
    typedRef.current = false   // the fill below must not trigger another search
    try {
      const r = await fetch(`/api/directions?places=1&id=${encodeURIComponent(p.id)}`)
      if (r.ok) {
        const { place } = await r.json()
        // National number -> bare digits; drop a leading trunk 0 (0265... / 098...).
        let digits = String(place?.phone || '').replace(/\D/g, '')
        if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
        onPick({
          name:    place?.name || p.name,
          address: place?.address || p.address,
          city:    place?.city || '',
          phone:   digits.length === 10 ? digits : '',
          website: place?.website || '',
        })
      } else {
        onPick({ name: p.name, address: p.address, city: '', phone: '', website: '' })
      }
    } catch {
      onPick({ name: p.name, address: p.address, city: '', phone: '', website: '' })
    }
    setPicking(false)
    pickLatchRef.current = false
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="lead-inp"
        value={value || ''}
        onChange={(e) => { typedRef.current = true; onChange(e.target.value); setOpen(true) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (busy || picking || results.length > 0) && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--v2-bg-1, var(--surface))',
            border: '1px solid var(--v2-line, var(--border))',
            borderRadius: 'var(--radius, 10px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.30)',
            zIndex: 30, maxHeight: 280, overflowY: 'auto',
          }}
        >
          {busy && results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--v2-ink-2, var(--text-muted))' }}>
              Searching Google…
            </div>
          )}
          {results.map((p) => (
            <div
              key={p.id}
              role="option"
              onMouseDown={(e) => { e.preventDefault(); pick(p) }}
              style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
              <div style={{ fontSize: 12, color: 'var(--v2-ink-2, var(--text-muted))', marginTop: 2 }}>{p.address}</div>
            </div>
          ))}
          <div style={{ padding: '6px 12px', fontSize: 12, color: 'var(--v2-ink-2, var(--text-muted))' }}>
            Results from Google
          </div>
        </div>
      )}
    </div>
  )
}
