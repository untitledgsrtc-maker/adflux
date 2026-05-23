// src/components/leads/RepMapPanel.jsx
//
// Phase 89.11 (2026-05-23) — rep-facing "My day on the map".
// Replaces the Leaflet+MapTiler MeetingsMapPanel that sales reps
// were stuck on while admin TeamDashboard / GpsTrackV2 moved to
// Google Maps in Phase 70.3 + 89.x. Owner directive 23 May 2026:
//   "sales n teleicller have old map view they cant see new
//    google map n their own pin of meetings"
//
// What it renders for one rep:
//   - Google Maps JS API (Phase 70.3 brand-dark styling) + Roads
//     library compatible (geometry only — no road-snap to keep
//     latency low on every reload).
//   - Their own meeting pins: lead_activities where
//     created_by = userId, activity_type IN ('meeting','site_visit'),
//     gps_lat IS NOT NULL.
//   - Their own GPS track today: gps_pings polyline (yellow).
//   - Date picker (default = today, back 7 days max — keeps API
//     read cost in check).
//   - Empty state (no meetings + no track) prompts them to log one.
//
// Mounted on /work + /telecaller. Both pages are §28 frozen sales-
// module files; the mount sites are single-line additions. This
// component is brand-new (not in §28 frozen list), so iteration on
// the map renderer doesn't need guardian re-audits.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import { MapPin, ChevronDown, ChevronUp, Calendar, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'

// ─── Constants ────────────────────────────────────────────────────
// Vadodara HQ fallback when rep has zero pins + zero meetings.
const FALLBACK_CENTER = { lat: 22.3072, lng: 73.1812 }
const FALLBACK_ZOOM   = 11

// Phase 89.9 teardrop pin (same as TeamDashboard for visual parity).
const PIN_PATH = 'M 0,0 c -4.5,-7.5 -10.5,-14.25 -10.5,-19.5 a 10.5,10.5 0 1,1 21,0 c 0,5.25 -6,12 -10.5,19.5 z m 0,-26.25 a 3.75,3.75 0 1,0 0,7.5 a 3.75,3.75 0 1,0 0,-7.5 z'

// Brand-dark map style (mirrors TeamDashboardV2 inline style).
const DARK_MAP_STYLE = [
  { elementType: 'geometry',            stylers: [{ color: '#1d2129' }] },
  { elementType: 'labels.text.stroke',  stylers: [{ color: '#1d2129' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'administrative',      elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#f1f5f9' }] },
  { featureType: 'poi',                 elementType: 'labels',   stylers: [{ visibility: 'off' }] },
  { featureType: 'road',                elementType: 'geometry', stylers: [{ color: '#64748b' }] },
  { featureType: 'road',                elementType: 'geometry.stroke', stylers: [{ color: '#475569' }] },
  { featureType: 'road',                elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.arterial',       elementType: 'geometry', stylers: [{ color: '#94a3b8' }] },
  { featureType: 'road.highway',        elementType: 'geometry', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.highway',        elementType: 'geometry.stroke', stylers: [{ color: '#64748b' }] },
  { featureType: 'road.local',          elementType: 'geometry', stylers: [{ color: '#475569' }] },
  { featureType: 'transit',             elementType: 'labels',   stylers: [{ visibility: 'off' }] },
  { featureType: 'water',               elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water',               elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
]

// Outcome colour map (matches Phase 89.4 admin pins).
function pinColorFor(outcome) {
  switch (outcome) {
    case 'positive': return '#10B981'
    case 'neutral':  return '#F59E0B'
    case 'negative': return '#EF4444'
    default:         return '#3B82F6'
  }
}

// XSS-safe attribute escape for InfoWindow HTML.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
}

// IST day-boundary helpers. Wall-clock UTC `new Date()` returns
// yesterday before 05:30 IST → must anchor in Asia/Kolkata.
function dayStartIso(ymd) {
  return `${ymd}T00:00:00+05:30`
}
function dayEndIso(ymd) {
  return `${ymd}T23:59:59.999+05:30`
}

export default function RepMapPanel({ userId, defaultCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [dateYmd, setDateYmd] = useState(() => istTodayISO())
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [meetings, setMeetings] = useState([])  // { id, lat, lng, ts, outcome, kind, lead_id, company, name }
  const [trackPts, setTrackPts] = useState([])  // [{ lat, lng, t }]
  const [mapReady, setMapReady] = useState(false)

  const mapElRef    = useRef(null)
  const mapRef      = useRef(null)
  const markersRef  = useRef({})
  const polylineRef = useRef(null)
  const startMarkerRef = useRef(null)
  const endMarkerRef   = useRef(null)
  const fitDoneRef     = useRef(false)

  // ─── Fetch meetings + track for the selected date ─────────────
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setError('')
    fitDoneRef.current = false
    ;(async () => {
      try {
        const fromIso = dayStartIso(dateYmd)
        const toIso   = dayEndIso(dateYmd)
        const [actRes, pingRes] = await Promise.all([
          supabase.from('lead_activities')
            .select('id, created_at, activity_type, outcome, gps_lat, gps_lng, lead:lead_id(id, name, company)')
            .eq('created_by', userId)
            .in('activity_type', ['meeting', 'site_visit'])
            .gte('created_at', fromIso)
            .lte('created_at', toIso)
            .order('created_at', { ascending: true }),
          supabase.from('gps_pings')
            .select('lat, lng, captured_at')
            .eq('user_id', userId)
            .gte('captured_at', fromIso)
            .lte('captured_at', toIso)
            .order('captured_at', { ascending: true })
            .limit(2000),
        ])
        if (cancelled) return
        if (actRes.error) throw actRes.error
        if (pingRes.error) throw pingRes.error

        const ms = (actRes.data || [])
          .filter(a => a.gps_lat != null && a.gps_lng != null
                    && Number.isFinite(Number(a.gps_lat))
                    && Number.isFinite(Number(a.gps_lng)))
          .map(a => ({
            id: a.id,
            lat: Number(a.gps_lat),
            lng: Number(a.gps_lng),
            ts: a.created_at,
            outcome: a.outcome,
            kind: a.activity_type,
            lead_id: a.lead?.id || null,
            company: a.lead?.company || '',
            name:    a.lead?.name    || '',
          }))
        setMeetings(ms)

        const pts = (pingRes.data || [])
          .filter(p => p.lat != null && p.lng != null)
          .map(p => ({ lat: Number(p.lat), lng: Number(p.lng), t: p.captured_at }))
          .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        setTrackPts(pts)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load map data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId, dateYmd])

  // ─── Mount Google Maps once (when card opens, container in DOM) ─
  useEffect(() => {
    if (collapsed) return
    if (mapRef.current) return
    const MAPS_KEY = import.meta.env.VITE_GOOGLE_ROADS_KEY || ''
    if (!MAPS_KEY) {
      setError('Map key missing — admin to set VITE_GOOGLE_ROADS_KEY.')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const loader = new Loader({
          apiKey: MAPS_KEY,
          version: 'weekly',
          // Phase 70.6.1 — geometry MUST match other Loader callers'
          // libraries to keep @googlemaps/js-api-loader singleton happy.
          libraries: ['geometry'],
        })
        const google = await loader.load()
        if (cancelled) return
        if (!mapElRef.current) return
        if (mapRef.current) return
        const map = new google.maps.Map(mapElRef.current, {
          center: FALLBACK_CENTER,
          zoom: FALLBACK_ZOOM,
          styles: DARK_MAP_STYLE,
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        })
        mapRef.current = map
        map.__google = google
        setMapReady(true)
      } catch (e) {
        if (!cancelled) setError('Google Maps load failed: ' + (e?.message || e))
      }
    })()
    return () => {
      cancelled = true
      // Cleanup: drop map ref so reopening rebuilds.
      mapRef.current = null
      markersRef.current = {}
      polylineRef.current = null
      startMarkerRef.current = null
      endMarkerRef.current = null
      setMapReady(false)
    }
  }, [collapsed])

  // ─── Render polyline (track) ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const google = map.__google
    if (!google) return
    // Remove previous polyline + endpoints.
    try { polylineRef.current?.setMap(null) } catch { /* */ }
    try { startMarkerRef.current?.setMap(null) } catch { /* */ }
    try { endMarkerRef.current?.setMap(null) } catch { /* */ }
    polylineRef.current = null
    startMarkerRef.current = null
    endMarkerRef.current = null
    if (!trackPts.length) return
    polylineRef.current = new google.maps.Polyline({
      path: trackPts.map(p => ({ lat: p.lat, lng: p.lng })),
      geodesic: true,
      strokeColor: '#FFE600',
      strokeOpacity: 0.95,
      strokeWeight: 4,
      map,
      zIndex: 0,
    })
    // Start dot (green) + end dot (red) for orientation.
    startMarkerRef.current = new google.maps.Marker({
      position: trackPts[0],
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#10B981',
        fillOpacity: 1,
        strokeColor: '#0f172a',
        strokeWeight: 1.5,
      },
      title: 'Day start',
      zIndex: 2,
    })
    endMarkerRef.current = new google.maps.Marker({
      position: trackPts[trackPts.length - 1],
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#EF4444',
        fillOpacity: 1,
        strokeColor: '#0f172a',
        strokeWeight: 1.5,
      },
      title: 'Latest position',
      zIndex: 2,
    })
  }, [trackPts, mapReady])

  // ─── Render meeting pins ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const google = map.__google
    if (!google) return
    const seen = new Set()
    for (const m of meetings) {
      seen.add(m.id)
      const pos = { lat: m.lat, lng: m.lng }
      const timeStr = new Date(m.ts).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
      })
      const heading = m.company || m.name || (m.lead_id ? 'Lead' : 'Field visit')
      const sub = m.company && m.name ? esc(m.name) : ''
      const kind = m.kind === 'site_visit' ? 'Site visit' : 'Meeting'
      const outcomeColor = m.outcome === 'positive' ? '#34d399'
                         : m.outcome === 'negative' ? '#f87171'
                         : m.outcome === 'neutral'  ? '#fbbf24'
                         : '#98a4bf'
      const outcomeBit = m.outcome
        ? ` · <span style="text-transform:capitalize;color:${outcomeColor};font-weight:700">${esc(m.outcome)}</span>`
        : ''
      const html = `
        <div style="font-family:'DM Sans','Inter',sans-serif;min-width:180px;">
          <div style="font-size:9.5px;color:#98a4bf;letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">${kind} · ${timeStr}${outcomeBit}</div>
          <div style="font-weight:700;font-size:14px;color:#f5f7fb;border-bottom:2px solid #FFE600;padding-bottom:3px;display:inline-block;">${esc(heading)}</div>
          ${sub ? `<div style="font-size:11px;color:#98a4bf;margin-top:6px;">${sub}</div>` : ''}
          ${m.lead_id ? `<a href="/leads/${esc(m.lead_id)}" style="display:inline-block;margin-top:10px;font-size:11px;color:#FFE600;text-decoration:none;font-weight:700;letter-spacing:.04em;">Open lead →</a>` : ''}
        </div>
      `
      const icon = {
        path:         PIN_PATH,
        fillColor:    pinColorFor(m.outcome),
        fillOpacity:  1,
        strokeColor:  '#0f172a',
        strokeWeight: 1.5,
        scale:        1.4,
        anchor:       new google.maps.Point(0, 0),
        labelOrigin:  new google.maps.Point(0, -20),
      }
      const existing = markersRef.current[m.id]
      if (existing) {
        existing.setPosition(pos)
        existing.setIcon(icon)
        existing.__iw?.setContent(html)
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon,
          title: heading,
          zIndex: 1,
        })
        const iw = new google.maps.InfoWindow({ content: html })
        marker.addListener('click', () => iw.open({ anchor: marker, map }))
        marker.__iw = iw
        markersRef.current[m.id] = marker
      }
    }
    // Cleanup pins no longer in the set (date changed / outcome reload).
    for (const id of Object.keys(markersRef.current)) {
      if (!seen.has(id)) {
        try { markersRef.current[id].setMap(null) } catch { /* */ }
        delete markersRef.current[id]
      }
    }
    // Fit bounds on first render with data, then leave alone so the
    // rep can pan/zoom freely.
    if (!fitDoneRef.current && (meetings.length || trackPts.length)) {
      try {
        const bounds = new google.maps.LatLngBounds()
        for (const m of meetings) bounds.extend({ lat: m.lat, lng: m.lng })
        for (const p of trackPts) bounds.extend({ lat: p.lat, lng: p.lng })
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 64)
          fitDoneRef.current = true
        }
      } catch { /* */ }
    }
  }, [meetings, trackPts, mapReady])

  // ─── Counts for header chip ───────────────────────────────────
  const meetingCount = meetings.length
  const trackKm = useMemo(() => {
    if (trackPts.length < 2) return 0
    // Crude great-circle sum so we don't need to wait for Roads API.
    const R = 6371
    let km = 0
    for (let i = 1; i < trackPts.length; i++) {
      const a = trackPts[i - 1], b = trackPts[i]
      const dLat = (b.lat - a.lat) * Math.PI / 180
      const dLng = (b.lng - a.lng) * Math.PI / 180
      const la1 = a.lat * Math.PI / 180
      const la2 = b.lat * Math.PI / 180
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
      km += 2 * R * Math.asin(Math.sqrt(x))
    }
    return km
  }, [trackPts])

  const isToday = dateYmd === istTodayISO()
  const headerLabel = isToday ? 'Today on the map' : `Map · ${dateYmd}`

  // ─── Date dropdown options (last 7 IST days) ──────────────────
  const dateOptions = useMemo(() => {
    const today = istTodayISO()
    const [y, m, d] = today.split('-').map(Number)
    const out = []
    for (let i = 0; i < 7; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d - i))
      const ymd = dt.toISOString().slice(0, 10)
      out.push({
        value: ymd,
        label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : ymd,
      })
    }
    return out
  }, [])

  return (
    <div
      className="v2-card"
      style={{
        background: 'var(--v2-bg-1)',
        border: '1px solid var(--v2-line)',
        borderRadius: 14,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          color: 'var(--v2-ink-0)',
          fontFamily: 'inherit',
        }}
      >
        <span style={{
          width: 34, height: 34, borderRadius: 10,
          background: 'rgba(255,230,0,.14)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <MapPin size={18} strokeWidth={1.6} style={{ color: 'var(--v2-yellow, #FFE600)' }} />
        </span>
        <span style={{ flex: 1, textAlign: 'left' }}>
          <span style={{ fontSize: 14, fontWeight: 700, display: 'block' }}>
            {headerLabel}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--v2-ink-2)', marginTop: 2, display: 'block' }}>
            {loading ? 'Loading…' : (
              meetingCount > 0 || trackPts.length > 0
                ? `${meetingCount} meeting${meetingCount === 1 ? '' : 's'} · ${trackKm.toFixed(1)} km`
                : 'No activity yet'
            )}
          </span>
        </span>
        {collapsed
          ? <ChevronDown size={18} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)' }} />
          : <ChevronUp   size={18} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)' }} />}
      </button>

      {/* Body — only renders when expanded so the map ref attaches. */}
      {!collapsed && (
        <div style={{ borderTop: '1px solid var(--v2-line)' }}>
          {/* Date filter row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', borderBottom: '1px solid var(--v2-line)',
          }}>
            <Calendar size={14} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)' }} />
            <select
              value={dateYmd}
              onChange={e => setDateYmd(e.target.value)}
              style={{
                background: 'var(--v2-bg-2)',
                color: 'var(--v2-ink-0)',
                border: '1px solid var(--v2-line)',
                borderRadius: 10,
                padding: '6px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {dateOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {loading && (
              <Loader2 size={14} strokeWidth={1.6} className="spin"
                style={{ color: 'var(--v2-yellow, #FFE600)' }} />
            )}
          </div>

          {/* Map container */}
          <div
            ref={mapElRef}
            style={{
              width: '100%', height: 280,
              // Tokenised dark canvas backing so the WebView doesn't
              // white-flash while Google Maps tiles fetch. Matches
              // DARK_MAP_STYLE geometry colour so the seam is invisible
              // once tiles render. Guardian P2 fix.
              background: 'var(--v2-bg-0, #1d2129)',
              position: 'relative',
            }}
          />

          {/* Error banner */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 16px',
              background: 'rgba(239,68,68,.10)',
              borderTop: '1px solid rgba(239,68,68,.32)',
              color: '#fca5a5',
              fontSize: 12.5,
            }}>
              <AlertCircle size={14} strokeWidth={1.8} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Empty hint */}
          {!loading && !error && meetingCount === 0 && trackPts.length === 0 && (
            <div style={{
              padding: '14px 16px',
              borderTop: '1px solid var(--v2-line)',
              fontSize: 12.5,
              color: 'var(--v2-ink-2)',
              textAlign: 'center',
            }}>
              No meetings or GPS pings logged for this day.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
