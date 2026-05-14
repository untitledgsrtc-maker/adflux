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
import { MapPin, ChevronDown, ChevronUp, AlertCircle, Crosshair, Loader2 } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { geocodeAndPersistLead, leadAddressLine } from '../../utils/geocode'
import { summariseTrack } from '../../utils/gpsDistance'

// Vadodara fallback center (Untitled Advertising HQ).
const FALLBACK_CENTER = [22.3072, 73.1812]
const FALLBACK_ZOOM   = 7   // shows most of Gujarat

// Phase 34Z.5 — Leaflet's default marker uses 3 PNG assets loaded from
// `leaflet/dist/images/`. Vite's bundler doesn't auto-rewrite those URLs
// so production builds 404 on marker-icon.png and the markers render
// invisible (the 4 PINS chip shows but the map has no visible dots).
// Replace the default icon with an inline brand-yellow SVG divIcon so
// no extra assets are needed and the pin is on-brand. Owner reported
// 14 May 2026: "showing wrong data and not pining properly".
const BRAND_PIN_ICON = L.divIcon({
  className: 'meetings-map-pin',
  html: `
    <svg width="22" height="30" viewBox="0 0 22 30" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M11 0C4.92 0 0 4.92 0 11c0 7.7 9.9 18.2 10.32 18.65a1 1 0 0 0 1.36 0C12.1 29.2 22 18.7 22 11c0-6.08-4.92-11-11-11z" fill="#FFE600" stroke="#0f172a" stroke-width="1.4"/>
      <circle cx="11" cy="11" r="4" fill="#0f172a"/>
    </svg>
  `,
  iconSize:   [22, 30],
  iconAnchor: [11, 30],
  popupAnchor:[0, -26],
})

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
  // Phase 34Z.6 — today's own track (GPS pings since 00:00 local).
  // Drawn as a yellow polyline so the rep sees where they've been.
  // summary = { km, kmRaw, pings, ... } from summariseTrack().
  const [track,   setTrack]   = useState([])           // [{lat,lng,captured_at,accuracy_m}]
  const [trackSummary, setTrackSummary] = useState(null)
  const [pingBusy, setPingBusy] = useState(false)       // Phase 34Z.7 — "Ping now" button
  const mapRef       = useRef(null)
  const mapElRef     = useRef(null)
  const markersRef   = useRef([])
  const trackLayerRef= useRef(null)

  // Phase 34Z.7 — "tracking paused" detection. If the last ping is
  // more than 15 min old (default 5-min interval × 3 = 15), assume
  // iOS Safari paused geolocation and surface a yellow banner so the
  // rep knows to keep the app open during driving. Recomputed every
  // 30s via interval below.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])
  const lastPingAt = track.length > 0
    ? new Date(track[track.length - 1].captured_at).getTime()
    : null
  const minutesSinceLastPing = lastPingAt
    ? Math.floor((now - lastPingAt) / 60000)
    : null
  const trackingPaused = minutesSinceLastPing != null && minutesSinceLastPing > 15

  // Phase 34Z.7 — rough TA estimate so the rep sees the rupee value of
  // their travel. Real TA is computed nightly per-city in
  // compute_daily_ta (bike_per_km varies city to city, ₹3 default).
  // For the live preview we use the ₹3/km floor — actual payout is
  // computed by admin during TA approval. Labelled "≈" so the rep
  // knows it's an estimate.
  const TA_PREVIEW_RATE = 3
  const taEstimate = trackSummary
    ? Math.round(Number(trackSummary.km) * TA_PREVIEW_RATE)
    : 0

  // Load lead pins from THREE sources, union them:
  //   1. Open follow-ups (today → next 7 days, assigned to me)
  //   2. Lead activities I logged today + last 7 days (so the rep
  //      sees where they've BEEN, not just where they're going)
  //   3. Leads I'm assigned to that have city set (background)
  // Owner directive (14 May 2026): "pining not showing in sales side
  // — i need every day pin." Single follow-up query was too narrow.
  useEffect(() => {
    if (!userId || !open) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const today    = new Date()
        const weekEnd  = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
        const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
        const weekAgoIso = weekAgo.toISOString()
        // Phase 34Z.6 — also fetch today's own GPS pings so we can
        // draw the rep's track + sum total km. Local-time midnight
        // start / 23:59 end so the day boundary matches the rep's
        // perception, not UTC.
        const dayStartLocal = new Date()
        dayStartLocal.setHours(0, 0, 0, 0)
        const dayEndLocal = new Date()
        dayEndLocal.setHours(23, 59, 59, 999)

        // Four parallel queries → union of lead_ids + own track.
        const [fuRes, actRes, mineRes, trackRes] = await Promise.all([
          supabase
            .from('follow_ups')
            .select('lead_id')
            .eq('assigned_to', userId)
            .eq('is_done', false)
            .not('lead_id', 'is', null)
            .gte('follow_up_date', ymd(today))
            .lte('follow_up_date', ymd(weekEnd)),
          supabase
            .from('lead_activities')
            .select('lead_id')
            .eq('created_by', userId)
            .not('lead_id', 'is', null)
            .gte('created_at', weekAgoIso),
          supabase
            .from('leads')
            .select('id')
            .eq('assigned_to', userId)
            .not('stage', 'in', '("Won","Lost")')
            .limit(50),
          supabase
            .from('gps_pings')
            .select('lat, lng, captured_at, accuracy_m, source')
            .eq('user_id', userId)
            .gte('captured_at', dayStartLocal.toISOString())
            .lte('captured_at', dayEndLocal.toISOString())
            .order('captured_at', { ascending: true }),
        ])
        if (fuRes.error)    throw fuRes.error
        if (actRes.error)   throw actRes.error
        if (mineRes.error)  throw mineRes.error
        if (trackRes.error) throw trackRes.error

        if (!cancelled) {
          const t = trackRes.data || []
          setTrack(t)
          setTrackSummary(summariseTrack(t))
        }

        const leadIds = [...new Set([
          ...(fuRes.data || []).map(r => r.lead_id),
          ...(actRes.data || []).map(r => r.lead_id),
          ...(mineRes.data || []).map(r => r.id),
        ].filter(Boolean))]

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
      // Phase 35 PR 2 — switched OSM operational tiles to MapTiler. OSM
      // policy explicitly discourages production use of tile.openstreet
      // map.org; MapTiler's free tier covers 100k requests/month, well
      // above the rep team's expected traffic. Key lives in env var so
      // it never enters git. If the key is missing at build time, fall
      // back to OSM with a console warning — better than a blank map.
      const mtKey = import.meta.env.VITE_MAPTILER_KEY
      if (!mtKey) {
        console.warn('[MeetingsMapPanel] VITE_MAPTILER_KEY missing — falling back to OSM')
      }
      const tileUrl = mtKey
        ? `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${mtKey}`
        : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      const attribution = mtKey
        ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        : '&copy; OpenStreetMap'

      // Phase 35 PR 2.4 — dropped `crossOrigin: true`. iOS Safari was
      // failing to paint tiles when the crossorigin attribute was set
      // on tile <img>s even though MapTiler sends Access-Control-Allow-
      // Origin: *. Without the attribute, tiles paint as regular images
      // (no canvas/SW cache benefit — that's the trade). Owner reported
      // map showed zoom + attribution but tile area was black; this is
      // the fix.
      L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution,
      }).addTo(mapRef.current)
    }

    // Phase 34Z.1 (13 May 2026) — owner reported the OSM tiles were
    // never rendering: the map area showed zoom controls + the
    // attribution strip but no tile imagery. Cause: when the panel
    // is collapsed at mount the container has height 0; Leaflet
    // initialises with that size and never requests tiles. After the
    // user expands the panel the container has a real height but
    // Leaflet doesn't know, so no tile request fires. The canonical
    // fix is `invalidateSize()` once the container is visible.
    //
    // Phase 34Z.5 (14 May 2026) — single rAF still leaves the map
    // blank on slow networks / first cold paint (the container is
    // technically visible but layout hasn't fully settled inside the
    // expanded card). Fire invalidateSize at three points: rAF,
    // 120ms, 400ms. Cheap; covers iOS Safari's slower paint pass.
    const sizeKick = () => {
      try { mapRef.current?.invalidateSize() } catch { /* ignore */ }
    }
    requestAnimationFrame(sizeKick)
    const t1 = setTimeout(sizeKick, 120)
    const t2 = setTimeout(sizeKick, 400)

    // Clear existing markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    // Phase 34Z.6 — draw today's track as a yellow polyline + green
    // start dot + red end dot so the rep sees A→B→C→… exactly as
    // owner described. Filter out pings with bogus coords. Cleared
    // and redrawn on every render so updates from interval pings
    // refresh the line cleanly.
    if (trackLayerRef.current) {
      try { trackLayerRef.current.remove() } catch { /* ignore */ }
      trackLayerRef.current = null
    }
    const trackPts = (track || [])
      .map((p) => [Number(p.lat), Number(p.lng)])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    if (trackPts.length >= 2) {
      const grp = L.layerGroup()
      L.polyline(trackPts, { color: '#FFE600', weight: 4, opacity: 0.75 }).addTo(grp)
      // start + end accent dots
      L.circleMarker(trackPts[0], {
        radius: 6, color: '#10B981', weight: 2, fillColor: '#10B981', fillOpacity: 0.9,
      }).bindPopup('Check-in').addTo(grp)
      L.circleMarker(trackPts[trackPts.length - 1], {
        radius: 6, color: '#EF4444', weight: 2, fillColor: '#EF4444', fillOpacity: 0.9,
      }).bindPopup('Latest position').addTo(grp)
      grp.addTo(mapRef.current)
      trackLayerRef.current = grp
    }

    if (leads.length === 0 && trackPts.length === 0) {
      mapRef.current.setView(FALLBACK_CENTER, FALLBACK_ZOOM)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }

    // Seed bounds with the track so the rep's actual path always
    // fits in the visible map area even if there are no lead pins.
    const bounds = trackPts.slice()
    for (const l of leads) {
      const lat = Number(l.lat)
      const lng = Number(l.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const marker = L.marker([lat, lng], { icon: BRAND_PIN_ICON }).addTo(mapRef.current)
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
      // Phase 34Z.5 — fitBounds runs synchronously before tile load
      // completes, so the initial view can be wrong if the container
      // resizes after layout settles. Re-fit on each invalidateSize
      // kick so the pins land in-frame after MapTiler tiles arrive.
      const fit = () => {
        try { mapRef.current?.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 }) } catch { /* ignore */ }
      }
      fit()
      setTimeout(fit, 140)
      setTimeout(fit, 420)
    }

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [open, leads, track])

  // Phase 34Z.7 — "Ping now" button forces an immediate GPS fix and
  // inserts a row into gps_pings (source='manual'). Refreshes the
  // track array so the new pin appears on the map without a reload.
  // Catches the case where the rep parked, walked into a meeting,
  // and wants the visit recorded before the next 5-min tick.
  async function handlePingNow() {
    if (pingBusy) return
    if (!userId) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    setPingBusy(true)
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 15000, maximumAge: 0,
        })
      })
      const row = {
        user_id: userId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: Math.round(pos.coords.accuracy || 0) || null,
        source: 'manual',
      }
      const { error: insErr } = await supabase.from('gps_pings').insert([row])
      if (insErr) throw insErr
      // Locally append so the polyline + km update immediately.
      const localRow = { ...row, captured_at: new Date().toISOString() }
      setTrack((prev) => {
        const next = [...prev, localRow]
        setTrackSummary(summariseTrack(next))
        return next
      })
    } catch (e) {
      setError(e?.message || 'Could not get GPS fix.')
    } finally {
      setPingBusy(false)
    }
  }

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
          {/* Phase 34Z.6 — today's distance chip (yellow accent so
              it pops). Owner: "you will see the total number of
              kilometer he drives or he travel". Reads from the same
              gps_pings the day-track polyline uses, so the number
              always matches the line. */}
          {trackSummary && Number(trackSummary.km) > 0 && (
            <span style={{
              padding: '1px 7px',
              background: 'rgba(255,230,0,0.18)',
              border: '1px solid rgba(255,230,0,0.45)',
              borderRadius: 999,
              color: 'var(--v2-ink-0, #f5f7fb)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            }}>
              {trackSummary.km} km today
            </span>
          )}
          {/* Phase 34Z.7 — TA preview at flat ₹3/km. Real per-city rate
              applied by admin in TA Payouts. */}
          {trackSummary && taEstimate > 0 && (
            <span style={{
              padding: '1px 7px',
              background: 'rgba(16,185,129,0.16)',
              border: '1px solid rgba(16,185,129,0.40)',
              borderRadius: 999,
              color: 'var(--v2-ink-0, #f5f7fb)',
              fontSize: 10,
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            }}>
              ≈ ₹{taEstimate} TA
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

          {/* Phase 34Z.7 — paused-tracking banner. iOS Safari pauses
              geolocation on backgrounded tabs; if the last ping is >15
              min old, surface a yellow strip so the rep knows tracking
              isn't live. The "Ping now" button forces an immediate fix
              and inserts a manual gps_pings row. Pairs with the
              visibility-change auto-ping in WorkV2 — between the two,
              gaps shrink without a Capacitor wrapper. */}
          {trackingPaused && (
            <div style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid var(--warning, #F59E0B)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--v2-ink-1, #a9b3c7)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <AlertCircle size={13} style={{ color: 'var(--warning, #F59E0B)', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                Tracking paused {minutesSinceLastPing} min — keep the app open while driving.
              </span>
              <button
                type="button"
                onClick={handlePingNow}
                disabled={pingBusy}
                className="lead-btn lead-btn-sm"
                style={{ flexShrink: 0 }}
              >
                {pingBusy
                  ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Crosshair size={12} />}
                <span>Ping now</span>
              </button>
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

          {/* Phase 34Z.6 — today's track summary. Green dot = check-in,
              red dot = latest fix, yellow line = path. km count comes
              from haversine sum of consecutive pings (drift + speed
              filters applied so a parked phone doesn't add ghost km).
              Owner directive (14 May 2026): "A→B + B→C + C→D… total
              kilometer counted". */}
          {trackSummary && (trackSummary.pings > 0) && (
            <div style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 11,
              color: 'var(--v2-ink-1, #a9b3c7)',
              flexWrap: 'wrap',
            }}>
              <span>
                <b style={{
                  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                  color: 'var(--v2-ink-0, #f5f7fb)',
                }}>{trackSummary.km}</b> km today
              </span>
              <span>
                ≈ <b style={{
                  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                  color: 'var(--v2-ink-0, #f5f7fb)',
                }}>₹{taEstimate}</b> TA est.
              </span>
              <span>
                {trackSummary.pings} ping{trackSummary.pings === 1 ? '' : 's'}
              </span>
              {trackSummary.capped && (
                <span style={{ color: 'var(--warning, #F59E0B)' }}>
                  capped at 600 km
                </span>
              )}
              {/* Phase 34Z.7 — always-on "Ping now" so the rep can pin
                  a trip-point at a meeting site without waiting for
                  the 5-min tick. Same handler as paused-banner. */}
              {!trackingPaused && (
                <button
                  type="button"
                  onClick={handlePingNow}
                  disabled={pingBusy}
                  className="lead-btn lead-btn-sm"
                  style={{ marginLeft: 'auto' }}
                >
                  {pingBusy
                    ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Crosshair size={12} />}
                  <span>Ping now</span>
                </button>
              )}
            </div>
          )}

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

          {leads.length === 0 && !loading && needsGeo.length === 0 && track.length === 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--v2-ink-1, #a9b3c7)' }}>
              No follow-ups in the next 7 days — nothing to plot.
            </div>
          )}
        </>
      )}
    </div>
  )
}
