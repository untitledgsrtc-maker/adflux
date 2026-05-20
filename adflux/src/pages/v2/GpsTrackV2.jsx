// src/pages/v2/GpsTrackV2.jsx
//
// Phase 30F — admin view of a rep's day on the map.
//
// Owner spec (7 May 2026): "in admin dashboard it should show 1 day
// map lines and how many km he drove the bike".
//
// Route: /admin/gps/:userId/:date  (date = YYYY-MM-DD)
// If date is omitted, defaults to today.
//
// We render with Leaflet via CDN to avoid pulling another bundle. The
// Leaflet CSS/JS are injected on first mount; subsequent visits hit
// cache. Tile source: OSM (free, no key needed for low traffic).
//
// Distance: Haversine summed across consecutive pings. iOS PWA
// foreground-only caveat acknowledged in §SQL phase30f comment.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin } from 'lucide-react'
// Phase 32K (10 May 2026) — owner reported map STILL failed after
// Phase 32A's CDN failover ("Map library failed to load: undefined").
// Both unpkg and cdnjs were failing for him — likely network /
// firewall / corporate-proxy interference. Leaflet now bundled via
// npm so it ships in the Vite chunk; no CDN dependency at runtime.
// Adds ~40KB gzip to the GpsTrack chunk only (lazy-loaded).
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatDate } from '../../utils/formatters'

// Phase 34Z.6 — haversine + summariseTrack live in src/utils/
// gpsDistance.js so /work uses the same filter rules.
import { summariseTrack, cleanTrack, detectStops } from '../../utils/gpsDistance'

// Phase 32K — Leaflet imported directly from npm (`import L from 'leaflet'`).
// No more CDN load gymnastics, no failover paths, no timeout guards.
// Vite bundles Leaflet into the GpsTrack chunk so the map works
// offline / on flaky networks / behind firewalls.

export default function GpsTrackV2() {
  const navigate = useNavigate()
  const { userId, date } = useParams()
  const targetDate = date || new Date().toISOString().slice(0, 10)
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)

  const [pings, setPings]   = useState([])
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  // Phase 32E — rep-day view from owner request: clicking a rep card
  // on Team Live should show the FULL day (map + activities + counters
  // + voice logs), not just GPS. Loading those alongside.
  const [session, setSession] = useState(null)
  const [activities, setActivities] = useState([])
  const [voiceLogs, setVoiceLogs] = useState([])
  const mapRef     = useRef(null)
  const containerRef = useRef(null)

  // Fetch the rep + their pings + their day-activity for the date.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      const start = `${targetDate}T00:00:00`
      const end   = `${targetDate}T23:59:59`
      const [userRes, pingsRes, sessionRes, actsRes, voiceRes] = await Promise.all([
        supabase.from('users').select('id, name, role, team_role, city').eq('id', userId).maybeSingle(),
        supabase.from('gps_pings')
          .select('id, captured_at, lat, lng, accuracy_m, source')
          .eq('user_id', userId)
          .gte('captured_at', start)
          .lte('captured_at', end)
          .order('captured_at', { ascending: true }),
        // Phase 32E — work_sessions row gives check-in/out times,
        // morning plan, counters. One row per (user_id, work_date).
        supabase.from('work_sessions')
          .select('check_in_at, check_out_at, daily_counters, planned_meetings, morning_plan_text, evening_summary')
          .eq('user_id', userId)
          .eq('work_date', targetDate)
          .maybeSingle(),
        // Phase 32E — every lead activity created by this rep on this
        // date. created_at filtered to the IST day window so the
        // timeline matches the chosen date.
        supabase.from('lead_activities')
          .select('id, created_at, activity_type, outcome, notes, next_action, lead:lead_id(id, name, company)')
          .eq('created_by', userId)
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: false })
          .limit(50),
        // Phase 32E — voice logs filed by this rep that day.
        supabase.from('voice_logs')
          .select('id, created_at, transcript, language_detected, status, classified, lead:lead_id(id, name, company)')
          .eq('user_id', userId)
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (cancelled) return
      if (userRes.error)  { setError(userRes.error.message);  setLoading(false); return }
      if (pingsRes.error) { setError(pingsRes.error.message); setLoading(false); return }
      setUser(userRes.data || null)
      setPings(pingsRes.data || [])
      setSession(sessionRes.data || null)
      setActivities(actsRes.data || [])
      setVoiceLogs(voiceRes.data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId, targetDate])

  // Total km driven, computed via filtered Haversine sum.
  //
  // Phase 34I — owner reported Kevin's 13 May actual 200-300 km drive
  // showed up as 1,300 km on this page. Root cause: this page summed
  // RAW haversine between every consecutive ping with NO filter, so:
  //   * Low-accuracy pings (cell-tower fallback indoors, ±500 m) get
  //     counted as if the rep teleported 500 m every 5 min.
  //   * GPS drift while parked (10-30 m / poll) accumulates over a
  //     full day to tens of kilometres of fake "movement".
  //   * Any single bad-fix outlier ping creates a huge spike (rep
  //     jumps from Vadodara to Anand and back in 2 min).
  //
  // Same filter thresholds as Phase 33H TA module SQL
  // (compute_daily_ta) so map display agrees with TA payouts:
  //
  //   * Discard pings with accuracy_m > 100 m (bad GPS fix).
  //   * Discard segments shorter than 30 m (drift at standstill).
  //   * Discard segments implying speed > 200 km/h (bad data /
  //     impossible bike trip).
  //   * Daily total cap at 600 km — sanity ceiling. Anything past
  //     that almost certainly = bad data.
  //
  // Raw km is exposed in the stats object too so the rep-day page
  // can show "filtered 215 km · raw 1,303 km" if needed for audit.
  const stats = useMemo(() => {
    // Phase 34Z.6 — distance logic lives in src/utils/gpsDistance.js
    // now (same function /work uses for the rep-side km chip), so
    // both views always agree. first/last captured_at stays here
    // because only this page renders them.
    const base = summariseTrack(pings)
    return {
      ...base,
      first: pings[0]?.captured_at,
      last:  pings[pings.length - 1]?.captured_at,
    }
  }, [pings])

  // Render the Leaflet map once pings load. Phase 32K — direct L
  // import; no CDN wrap, no failover, no error path needed.
  useEffect(() => {
    if (loading) return
    if (!containerRef.current) return
    if (pings.length === 0) return
    // Clean up any earlier map on this node (StrictMode double-mounts).
    if (mapRef.current) {
      try { mapRef.current.remove() } catch (_) {}
      mapRef.current = null
    }
    try {
      // Phase 61.3 (19 May 2026) — owner reported the map showed
      // clusters of dots and a noisy polyline instead of a clean
      // route. Three changes:
      //   1. Polyline now uses cleanTrack() — drops accuracy outliers
      //      + sub-30m drift + speed spikes. Visualization matches
      //      the km math.
      //   2. Drop the 394 yellow interval-ping circles. Only
      //      check-in (green) + check-out (red) markers remain.
      //   3. Numbered stop markers (1, 2, 3, ...) at every place
      //      the rep stayed >= 10 minutes within an 80m radius —
      //      mirrors the reference design owner showed.
      const cleaned = cleanTrack(pings)
      const stops   = detectStops(pings, { radiusM: 80, minMinutes: 10 })

      const center = cleaned.length > 0
        ? [Number(cleaned[0].lat), Number(cleaned[0].lng)]
        : [Number(pings[0].lat), Number(pings[0].lng)]
      const map = L.map(containerRef.current).setView(center, 13)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // Phase 61.5 (19 May 2026) — road snap via OSRM. Owner reported
      // "pining not aline with route of road" — even after cleanTrack
      // drops drift / spike pings, the polyline still cuts across
      // buildings between the remaining points because raw GPS
      // doesn't sit perfectly on road centerlines.
      //
      // OSRM /match endpoint returns a road-network-matched geometry
      // for a sequence of coordinates + timestamps. Free public
      // demo server (routing.openstreetmap.de) — rate-limited but
      // fine for occasional admin review pages.
      //
      // Render strategy:
      //   1. Draw the cleaned-but-raw polyline immediately in a faint
      //      yellow so the page paints without waiting.
      //   2. Fire the OSRM POST in parallel.
      //   3. When OSRM returns, replace the raw polyline with the
      //      matched (road-snapped) geometry in bright yellow.
      //
      // Failures (network down, OSRM 4xx/5xx, >100 pings = batch too
      // large) silently leave the raw polyline in place.
      // Phase 65 (20 May 2026) — owner reported "gps km not properly
      // working" with raw 46.7 km but only a tiny polyline showing.
      // Bug: previous Phase 61.5 code REMOVED the raw cleaned polyline
      // when OSRM matched, but OSRM often matches only partial route
      // (confidence drops on highway gaps, low-speed dwell etc.) so
      // the user lost visibility of the actual route.
      // Fix: always render the raw cleaned polyline as a yellow base
      // layer. OSRM matched legs overlay in a slightly brighter yellow
      // on top WHEN available, never replacing the underlying line.
      // Sample size bumped 100 → 200 (OSRM /match limit is 100 per
      // request — chunk in 2 batches now). Map fitBounds anchored to
      // the RAW cleaned set so the whole route stays in view.
      let rawLine = null
      if (cleaned.length >= 2) {
        const latlngs = cleaned.map(p => [Number(p.lat), Number(p.lng)])
        rawLine = L.polyline(latlngs, {
          color:    '#FFE600',
          weight:   4,
          opacity:  0.75,        // visible always; OSRM overlays on top
          lineCap:  'round',
          lineJoin: 'round',
        }).addTo(map)
        map.fitBounds(rawLine.getBounds(), { padding: [40, 40] })

        // OSRM /match — best-effort overlay. Chunk the cleaned set
        // into batches of 100 (OSRM hard limit). For each batch,
        // request the matched geometry. Failures silently leave the
        // raw line visible underneath.
        const BATCH = 100
        const chunks = []
        for (let i = 0; i < cleaned.length; i += BATCH) {
          chunks.push(cleaned.slice(i, i + BATCH))
        }
        const fetchOne = (sample) => {
          if (sample.length < 2) return Promise.resolve(null)
          const coordStr = sample
            .map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`)
            .join(';')
          const tsStr = sample
            .map(p => Math.floor(new Date(p.captured_at).getTime() / 1000))
            .join(';')
          const url = `https://routing.openstreetmap.de/routed-car/match/v1/driving/${coordStr}`
            + `?steps=false&geometries=geojson&overview=full&timestamps=${tsStr}`
          return fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)
        }
        Promise.all(chunks.map(fetchOne))
          .then(results => {
            if (!mapRef.current) return
            for (const json of results) {
              if (!json || json.code !== 'Ok' || !Array.isArray(json.matchings)) continue
              for (const m of json.matchings) {
                const coords = m?.geometry?.coordinates
                if (!Array.isArray(coords) || coords.length < 2) continue
                const latlngs = coords.map(c => [c[1], c[0]])  // GeoJSON is lng,lat
                L.polyline(latlngs, {
                  color:    '#FFE600',
                  weight:   6,
                  opacity:  1,
                  lineCap:  'round',
                  lineJoin: 'round',
                }).addTo(mapRef.current)
              }
            }
          })
          .catch(() => { /* raw line stays as fallback */ })
      } else if (cleaned.length === 1) {
        map.setView([Number(cleaned[0].lat), Number(cleaned[0].lng)], 14)
      }

      // Check-in (green) + check-out (red) pins only — drop the
      // interval circles that used to clutter the map.
      const first = pings[0]
      const last  = pings[pings.length - 1]
      if (first) {
        L.circleMarker([Number(first.lat), Number(first.lng)], {
          radius: 9, color: '#10B981', weight: 3,
          fillColor: '#10B981', fillOpacity: 0.92,
        })
        .addTo(map)
        .bindPopup(
          `<b>Check-in</b><br/>${new Date(first.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
        )
      }
      if (last && last !== first) {
        L.circleMarker([Number(last.lat), Number(last.lng)], {
          radius: 9, color: '#EF4444', weight: 3,
          fillColor: '#EF4444', fillOpacity: 0.92,
        })
        .addTo(map)
        .bindPopup(
          `<b>Check-out</b><br/>${new Date(last.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
        )
      }

      // Numbered stop markers.
      for (const s of stops) {
        const icon = L.divIcon({
          className: 'gps-stop-pin',
          html: `
            <div style="
              width: 32px; height: 32px;
              background: #F59E0B;
              border: 2px solid #fff;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              display: flex; align-items: center; justify-content: center;
              box-shadow: 0 4px 10px rgba(0,0,0,0.35);
            ">
              <span style="
                transform: rotate(45deg);
                color: #fff;
                font-weight: 700;
                font-size: 13px;
                font-family: 'Space Grotesk', sans-serif;
              ">${s.id}</span>
            </div>
          `,
          iconSize:   [32, 32],
          iconAnchor: [16, 32],
        })
        L.marker([s.lat, s.lng], { icon })
          .addTo(map)
          .bindPopup(
            `<b>Stop ${s.id}</b><br/>` +
            `${new Date(s.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ` +
            `– ${new Date(s.ended_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}<br/>` +
            `<small>${s.minutes} min dwell</small>`
          )
      }
    } catch (e) {
      setError('Map render failed: ' + (e?.message || String(e)))
    }
    return () => {
      if (mapRef.current) {
        try { mapRef.current.remove() } catch (_) {}
        mapRef.current = null
      }
    }
  }, [loading, pings])

  if (!isPrivileged) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        Admin / co-owner access only.
      </div>
    )
  }

  return (
    <div className="lead-root" style={{ padding: 16 }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontSize: 12, marginBottom: 12, cursor: 'pointer',
        }}
      >
        <ArrowLeft size={12} /> Back
      </button>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 16,
        alignItems: 'flex-start', marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
            Rep day track
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>
            {user?.name || '—'}
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
              {user?.team_role || user?.role || ''}
              {user?.city ? ` · ${user.city}` : ''}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {formatDate(targetDate)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
            Distance
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--accent, #FFE600)' }}>
            {stats.km} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>km</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {stats.pings} pings
            {stats.pings !== stats.usablePings && ` · ${stats.pings - stats.usablePings} low-accuracy dropped`}
          </div>
          {/* Phase 34I — show raw vs filtered so owner can audit
              drift. Hidden unless they diverge by 10%+. */}
          {stats.kmRaw && Math.abs(Number(stats.kmRaw) - Number(stats.km)) > Number(stats.km) * 0.1 && (
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
              raw {stats.kmRaw} km · {stats.droppedSegs} drift/spike segments dropped
              {stats.capped ? ' · capped at 600 km' : ''}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: 'var(--danger-soft)', border: '1px solid var(--danger)',
          color: 'var(--danger)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginBottom: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading track…
        </div>
      ) : pings.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center', color: 'var(--text-muted)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12,
        }}>
          <MapPin size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No GPS pings recorded for {formatDate(targetDate)}.</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            The rep may have been off the /work tab or denied location permission.
          </div>
        </div>
      ) : (
        <>
          <div
            ref={containerRef}
            style={{
              width: '100%', height: '60vh', minHeight: 420,
              borderRadius: 12, overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          />
          <div style={{
            display: 'flex', gap: 16, marginTop: 12, fontSize: 12,
            color: 'var(--text-muted)', flexWrap: 'wrap',
          }}>
            <span><span style={{ color: '#10B981' }}>●</span> Check-in {stats.first ? new Date(stats.first).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <span><span style={{ color: '#EF4444' }}>●</span> Check-out {stats.last ? new Date(stats.last).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <span><span style={{ color: '#F59E0B' }}>●</span> Interval pings (every ~5 min while /work was open)</span>
          </div>
        </>
      )}

      {/* Phase 32E — rep-day view extras: counters + activity timeline +
          voice logs. Owner directive: clicking a rep card on Team Live
          should give the FULL day picture, not just the GPS map. */}
      {!loading && (
        <RepDaySections session={session} activities={activities} voiceLogs={voiceLogs} navigate={navigate} />
      )}
    </div>
  )
}

/* Phase 32E — extracted into a sub-component so the main render
   stays readable. Renders three stacked sections: today's counters
   from work_sessions.daily_counters, the lead-activities timeline
   (scoped to this rep + this day), and voice logs filed today. */
function RepDaySections({ session, activities, voiceLogs, navigate }) {
  const counters = session?.daily_counters || {}
  const checkIn  = session?.check_in_at
  const checkOut = session?.check_out_at
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
      {/* Counters strip */}
      {(checkIn || activities.length > 0) && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}>
          <RepDayStat label="Check-in"  value={checkIn  ? new Date(checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'} />
          <RepDayStat label="Check-out" value={checkOut ? new Date(checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Open'} tone={checkOut ? '' : 'warn'} />
          <RepDayStat label="Meetings"  value={counters.meetings || 0} />
          <RepDayStat label="Calls"     value={counters.calls || 0} />
          <RepDayStat label="New leads" value={counters.new_leads || 0} />
          <RepDayStat label="Voice notes" value={voiceLogs.length} />
        </div>
      )}

      {/* Activity timeline */}
      <div className="lead-card">
        <div className="lead-card-head">
          <div>
            <div className="lead-card-title">Activity timeline · {activities.length}</div>
            <div className="lead-card-sub">Every call / WhatsApp / meeting / note logged today</div>
          </div>
        </div>
        {activities.length === 0 ? (
          <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No activities logged on this date.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activities.map(a => {
              const t = new Date(a.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
              return (
                <div
                  key={a.id}
                  onClick={() => a.lead?.id && navigate(`/leads/${a.lead.id}`)}
                  style={{
                    cursor: a.lead?.id ? 'pointer' : 'default',
                    padding: '10px 14px',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11,
                      color: 'var(--text-muted)', minWidth: 44,
                    }}>{t}</span>
                    <span style={{
                      fontWeight: 700, color: 'var(--text)',
                      textTransform: 'capitalize',
                    }}>{a.activity_type}</span>
                    {a.outcome && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: a.outcome === 'positive' ? 'var(--success)'
                              : a.outcome === 'negative' ? 'var(--danger)' : 'var(--text-muted)',
                      }}>{a.outcome}</span>
                    )}
                    <span style={{ color: 'var(--text-muted)' }}>
                      → {a.lead?.company || a.lead?.name || '—'}
                    </span>
                  </div>
                  {a.notes && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 52, lineHeight: 1.5 }}>
                      {a.notes.slice(0, 200)}{a.notes.length > 200 ? '…' : ''}
                    </div>
                  )}
                  {a.next_action && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, marginLeft: 52 }}>
                      Next: {a.next_action}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Voice logs */}
      {voiceLogs.length > 0 && (
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Voice notes · {voiceLogs.length}</div>
              <div className="lead-card-sub">Recordings filed today</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {voiceLogs.map(v => {
              const t = new Date(v.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
              const lang = v.language_detected ? String(v.language_detected).toUpperCase() : ''
              const snippet = (v.transcript || '').trim().slice(0, 160)
              return (
                <div
                  key={v.id}
                  onClick={() => v.lead?.id && navigate(`/leads/${v.lead.id}`)}
                  style={{
                    cursor: v.lead?.id ? 'pointer' : 'default',
                    padding: '10px 14px',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11,
                      color: 'var(--text-muted)', minWidth: 44,
                    }}>{t}</span>
                    {lang && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.08em',
                        color: 'var(--accent)',
                        background: 'var(--accent-soft)',
                        padding: '1px 6px', borderRadius: 999,
                      }}>{lang}</span>
                    )}
                    <span style={{ color: 'var(--text-muted)' }}>
                      → {v.lead?.company || v.lead?.name || '—'}
                    </span>
                  </div>
                  {snippet && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 52, lineHeight: 1.5 }}>
                      {snippet}{v.transcript && v.transcript.length > 160 ? '…' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Morning plan reference */}
      {session?.morning_plan_text && (
        <details className="lead-card" style={{ padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Morning plan
          </summary>
          <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {session.morning_plan_text}
          </div>
        </details>
      )}
    </div>
  )
}

function RepDayStat({ label, value, tone }) {
  const color = tone === 'warn' ? 'var(--warning)' : 'var(--text)'
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-strong, #475569)',
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{
        fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
        color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 18, color,
      }}>
        {value}
      </div>
    </div>
  )
}
