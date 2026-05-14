// src/components/leads/MeetingsMapPanel.jsx
//
// Phase 34G — "Today on the map" panel for /work.
//
// Renders a Leaflet map (OpenStreetMap tiles, already used elsewhere
// in GpsTrackV2) with pins for the rep's open follow-ups in the next
// 7 days. Leads without lat/lng are geocoded on demand via Nominatim
// (free, no API key) and the result persists back to the DB.
//
// Layout:
//   ┌───────────────────────────────────────┐
//   │ Today on the map · 12 pins            │
//   │ [▼ collapse]                          │
//   ├───────────────────────────────────────┤
//   │   [LEAFLET MAP, height: 260px]        │
//   │   Pins clickable → opens /leads/:id   │
//   ├───────────────────────────────────────┤
//   │ 3 leads need address — tap to fix     │
//   └───────────────────────────────────────┘
//
// Mounted as a collapsible card on WorkV2 between TodayTasksPanel
// and UpcomingTasksCard.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { geocodeAndPersistLead, leadAddressLine } from '../../utils/geocode'

// Vadodara fallback center (Untitled Advertising HQ).
const FALLBACK_CENTER = [22.3072, 73.1812]
const FALLBACK_ZOOM   = 7   // shows most of Gujarat

function ymd(d) {
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

export default function MeetingsMapPanel({ userId }) {
  const navigate = useNavigate()
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [leads,   setLeads]   = useState([])           // { id, name, company, lat, lng, address, city }
  const [needsGeo, setNeedsGeo] = useState([])         // leads we tried to geocode but couldn't
  const mapRef       = useRef(null)
  const mapElRef     = useRef(null)
  const markersRef   = useRef([])

  // Load this rep's upcoming follow-ups (today + next 7 days).
  useEffect(() => {
    if (!userId || !open) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const today    = new Date()
        const weekEnd  = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)

        // Get all open follow-ups for me, this week.
        const { data: fus, error: fuErr } = await supabase
          .from('follow_ups')
          .select('lead_id')
          .eq('assigned_to', userId)
          .eq('is_done', false)
          .not('lead_id', 'is', null)
          .gte('follow_up_date', ymd(today))
          .lte('follow_up_date', ymd(weekEnd))

        if (fuErr) throw fuErr
        const leadIds = [...new Set((fus || []).map((r) => r.lead_id))]
        if (leadIds.length === 0) {
          if (!cancelled) { setLeads([]); setNeedsGeo([]); setLoading(false) }
          return
        }

        // Pull lead rows + their geo. Note: `address` is not a column
        // on the current leads schema — we keep the select to `city`
        // only. If a future migration adds `address`, restore here.
        const { data: leadRows, error: lErr } = await supabase
          .from('leads')
          .select('id, name, company, city, lat, lng, stage')
          .in('id', leadIds)
        if (lErr) throw lErr

        if (cancelled) return

        const withCoords = leadRows.filter((r) => r.lat != null && r.lng != null)
        const without    = leadRows.filter((r) => (r.lat == null || r.lng == null)
                                                && leadAddressLine(r))

        setLeads(withCoords)
        setNeedsGeo(without)
        setLoading(false)

        // Background geocode the missing ones (max 5 per open to
        // respect Nominatim TOS; rep gets more pins each time they
        // reopen the map). Each success refreshes our state.
        for (const r of without.slice(0, 5)) {
          if (cancelled) return
          try {
            const res = await geocodeAndPersistLead(r)
            if (res && !cancelled) {
              setLeads((prev) => prev.concat({
                ...r, lat: res.lat, lng: res.lng,
              }))
              setNeedsGeo((prev) => prev.filter((x) => x.id !== r.id))
            }
          } catch { /* network failure — silently move on */ }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not load map data.')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [userId, open])

  // Initialize / refresh map when open + leads change.
  useEffect(() => {
    if (!open || !mapElRef.current) return

    if (!mapRef.current) {
      mapRef.current = L.map(mapElRef.current, {
        center: FALLBACK_CENTER,
        zoom:   FALLBACK_ZOOM,
        scrollWheelZoom: false,
      })
      // Phase 34Z.2 (13 May 2026) — owner reported tiles STILL not
      // loading after Phase 34Z.1's invalidateSize fix. Diagnosis:
      // {s} subdomain rotation was producing `a/b/c.tile.openstreet
      // map.org` URLs, but the OSM operational policy has been
      // discouraging the legacy lettered subdomains since 2023 and
      // some networks (incl. Indian ISPs) refuse them. Switching to
      // the canonical `tile.openstreetmap.org` host with no subdomain
      // template. Also bumped tile cross-origin to anonymous so the
      // browser cache works across same-origin views and the service
      // worker (Phase 34G) can hit-cache them properly.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
        crossOrigin: true,
      }).addTo(mapRef.current)
    }

    // Phase 34Z.1 (13 May 2026) — owner reported the OSM tiles were
    // never rendering: the map area showed zoom controls + the
    // attribution strip but no tile imagery. Cause: when the panel
    // is collapsed at mount the container has height 0; Leaflet
    // initialises with that size and never requests tiles. After the
    // user expands the panel the container has a real height but
    // Leaflet doesn't know, so no tile request fires. The canonical
    // fix is `invalidateSize()` once the container is visible. Two
    // ticks (microtask + ~80 ms) covers both the first render and
    // any CSS transition timing.
    requestAnimationFrame(() => {
      try { mapRef.current?.invalidateSize() } catch { /* ignore */ }
    })
    setTimeout(() => {
      try { mapRef.current?.invalidateSize() } catch { /* ignore */ }
    }, 80)

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    if (leads.length === 0) {
      mapRef.current.setView(FALLBACK_CENTER, FALLBACK_ZOOM)
      return
    }

    const bounds = []
    for (const l of leads) {
      const lat = Number(l.lat)
      const lng = Number(l.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const marker = L.marker([lat, lng]).addTo(mapRef.current)
      const labelHtml = [
        `<strong>${l.name || '—'}</strong>`,
        l.company ? `<br/>${l.company}` : '',
        l.city    ? `<br/><small>${l.city}</small>` : '',
      ].join('')
      marker.bindPopup(`<div style="min-width:160px">${labelHtml}<br/><a href="/leads/${l.id}">Open lead →</a></div>`)
      markersRef.current.push(marker)
      bounds.push([lat, lng])
    }
    if (bounds.length > 0) {
      mapRef.current.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 })
    }
  }, [open, leads])

  // Tear down map on unmount.
  useEffect(() => () => {
    if (mapRef.current) {
      try { mapRef.current.remove() } catch { /* ignore */ }
      mapRef.current = null
    }
  }, [])

  return (
    <div style={{
      background: 'var(--v2-bg-1, #111a2e)',
      border: '1px solid var(--v2-line, #1f2b47)',
      borderRadius: 'var(--v2-r, 14px)',
      padding: '12px 14px',
      marginTop: 12,
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'inherit',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'inherit',
        }}
        aria-expanded={open}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--v2-ink-1, #a9b3c7)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          <MapPin size={12} />
          <span>This week on the map</span>
          {leads.length > 0 && (
            <span style={{
              padding: '1px 7px',
              background: 'var(--v2-bg-2, #1a2742)',
              borderRadius: 999,
              color: 'var(--v2-ink-0, #f5f7fb)',
              fontSize: 10,
            }}>
              {leads.length} pin{leads.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <>
          {loading && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--v2-ink-1, #a9b3c7)' }}>
              Loading map…
            </div>
          )}
          {error && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #EF4444)' }}>
              {error}
            </div>
          )}

          <div
            ref={mapElRef}
            style={{
              marginTop: 10,
              height: 260,
              borderRadius: 10,
              overflow: 'hidden',
              background: 'var(--v2-bg-0, #0b1220)',
            }}
          />

          {needsGeo.length > 0 && (
            <div style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid var(--warning, #F59E0B)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--v2-ink-1, #a9b3c7)',
            }}>
              <AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {needsGeo.length} lead{needsGeo.length === 1 ? '' : 's'} need clearer address before showing on map.
              <div style={{ marginTop: 4 }}>
                {needsGeo.slice(0, 3).map((l, i) => (
                  <span
                    key={l.id}
                    onClick={() => navigate(`/leads/${l.id}`)}
                    style={{ cursor: 'pointer', textDecoration: 'underline', marginRight: 8 }}
                  >
                    {l.name || l.company || 'Lead'}
                  </span>
                ))}
                {needsGeo.length > 3 ? `+${needsGeo.length - 3} more` : ''}
              </div>
            </div>
          )}

          {leads.length === 0 && !loading && needsGeo.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--v2-ink-1, #a9b3c7)' }}>
              No follow-ups in the next 7 days — nothing to plot.
            </div>
          )}
        </>
      )}
    </div>
  )
}
