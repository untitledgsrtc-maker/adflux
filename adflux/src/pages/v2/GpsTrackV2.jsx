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
import { Loader } from '@googlemaps/js-api-loader'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatDate } from '../../utils/formatters'

// Phase 34Z.6 — haversine + summariseTrack live in src/utils/
// gpsDistance.js so /work uses the same filter rules.
import { summariseTrack, cleanTrack, detectStops } from '../../utils/gpsDistance'

// Phase 70.7 (22 May 2026) — dark Google Maps style that matches the
// v2 chrome but keeps road network legible. Previous palette had
// roads only ~30% lighter than ground; new palette lifts roads to
// ~70% lighter so streets stand out clearly against the dark
// background. Locality / arterial labels also bumped for readability.
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
          .select('id, created_at, activity_type, outcome, notes, next_action, gps_lat, gps_lng, lead:lead_id(id, name, company)')
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
      mapRef.current = null
    }
    // Wrap async work inside a self-invoking async fn — useEffect
    // can't return a Promise directly.
    ;(async () => {
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

      // Phase 70.3 (22 May 2026) — swap Leaflet+OSM tiles for Google
      // Maps JS API. Owner: "we paid for Google Maps API, use it".
      // Free tier 10K map loads/month covers our usage. Roads API
      // snap still applies; result rendered as google.maps.Polyline
      // on top of the Google tiles.
      const MAPS_KEY = import.meta.env.VITE_GOOGLE_ROADS_KEY || ''
      if (!MAPS_KEY) {
        setError('Google Maps key missing — set VITE_GOOGLE_ROADS_KEY in Vercel env.')
        return
      }
      const loader = new Loader({
        apiKey: MAPS_KEY,
        version: 'weekly',
        // Phase 70.6 — geometry library needed for decodePath() to
        // render the Directions API encoded polyline.
        libraries: ['geometry'],
      })
      const google = await loader.load()

      const center = cleaned.length > 0
        ? { lat: Number(cleaned[0].lat), lng: Number(cleaned[0].lng) }
        : { lat: Number(pings[0].lat), lng: Number(pings[0].lng) }
      const map = new google.maps.Map(containerRef.current, {
        center,
        zoom: 13,
        // Phase 70.7 (22 May 2026) — lightened dark style so streets
        // read clearly against the dark canvas. Previous palette had
        // roads at #334155 which was almost the same value as the
        // ground (#1d2129) — owner reported "map tiles too dark, road
        // network barely visible".
        styles: DARK_MAP_STYLE,
        disableDefaultUI: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
      mapRef.current = map

      const bounds = new google.maps.LatLngBounds()

      // Phase 70.7 — raw cleaned polyline is the fallback. Drawn at low
      // opacity so the user has SOMETHING visible until the Directions
      // API result lands. Once Directions returns a real road-following
      // polyline, the raw line is removed (rawLine.setMap(null)).
      let rawLine = null
      if (cleaned.length >= 2) {
        const path = cleaned.map(p => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        }))
        path.forEach(pt => bounds.extend(pt))
        rawLine = new google.maps.Polyline({
          path,
          strokeColor:    '#FFE600',
          strokeOpacity:  0.45,
          strokeWeight:   3,
          map,
        })
        map.fitBounds(bounds, 60)

        // Phase 70.6 (22 May 2026) — owner reported "still direct line".
        // Real cause: 46 raw pings cluster at 2-3 spots (rep had GPS at
        // checkin + parked + checkout, missed in-vehicle travel pings).
        // Roads API snapToRoads can't reconstruct a 7km route from 2
        // distinct geographic points; interpolate=true only works for
        // points along the same road.
        //
        // Switch to Directions API via a server-side proxy
        // (/api/directions). Server proxy avoids the Chrome
        // referrer-policy block that hits client-side Roads API calls
        // restricted by Websites referers. Server key is stored in
        // Vercel env as ROADS_KEY_SERVER (no VITE_ prefix → never in
        // client bundle).
        //
        // Strategy:
        //   • origin      = first raw ping (check-in)
        //   • destination = last raw ping (check-out)
        //   • waypoints   = up to 8 intermediate stop centroids (from
        //                   detectStops) so the route hits where the
        //                   rep actually parked, not just start→end
        //
        // Directions API returns the encoded polyline; we decode via
        // google.maps.geometry.encoding.decodePath().
        const ACC_LOOSE = 200
        const sortedRaw = pings
          .filter(p => {
            const a = Number(p.accuracy_m)
            return !Number.isFinite(a) || a <= ACC_LOOSE
          })
          .slice()
          .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at))

        if (sortedRaw.length >= 2) {
          const origin = sortedRaw[0]
          const dest   = sortedRaw[sortedRaw.length - 1]
          const wayPts = (stops || [])
            .slice(0, 8)
            .map(s => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`)
            .join('|')
          const qs = new URLSearchParams({
            origin:      `${Number(origin.lat).toFixed(6)},${Number(origin.lng).toFixed(6)}`,
            destination: `${Number(dest.lat).toFixed(6)},${Number(dest.lng).toFixed(6)}`,
            mode:        'driving',
          })
          if (wayPts) qs.set('waypoints', wayPts)

          // Need google.maps.geometry to decode polyline.
          const geometry = await google.maps.importLibrary
            ? await google.maps.importLibrary('geometry')
            : null
          // (older API: geometry library loaded via `libraries: ['geometry']`
          // in Loader. We add it below if importLibrary not available.)

          fetch(`/api/directions?${qs.toString()}`)
            .then(r => r.ok ? r.json() : null)
            .then(json => {
              if (!mapRef.current) return
              if (!json?.polyline) return
              let decoded = null
              try {
                if (geometry?.encoding?.decodePath) {
                  decoded = geometry.encoding.decodePath(json.polyline)
                } else if (google.maps.geometry?.encoding?.decodePath) {
                  decoded = google.maps.geometry.encoding.decodePath(json.polyline)
                }
              } catch (_) { /* fall through */ }
              if (!decoded || decoded.length < 2) return
              new google.maps.Polyline({
                path: decoded,
                strokeColor:   '#FFE600',
                strokeOpacity: 1,
                strokeWeight:  6,
                map: mapRef.current,
              })
              // Phase 70.7 — remove the raw fallback line now that the
              // road-snapped polyline is on the map.
              if (rawLine) {
                try { rawLine.setMap(null) } catch { /* swallow */ }
              }
            })
            .catch(() => { /* raw line stays as fallback */ })
        }
      } else if (cleaned.length === 1) {
        map.setCenter(center)
        map.setZoom(14)
      }

      // Check-in + check-out markers.
      const first = pings[0]
      const last  = pings[pings.length - 1]
      const dotIcon = (color) => ({
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: color,
        fillOpacity: 0.92,
        strokeColor: '#ffffff',
        strokeWeight: 3,
      })
      if (first) {
        const m1 = new google.maps.Marker({
          position: { lat: Number(first.lat), lng: Number(first.lng) },
          map,
          icon: dotIcon('#10B981'),
        })
        const iw1 = new google.maps.InfoWindow({
          content: `<b>Check-in</b><br/>${new Date(first.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
        })
        m1.addListener('click', () => iw1.open({ anchor: m1, map }))
      }
      if (last && last !== first) {
        const m2 = new google.maps.Marker({
          position: { lat: Number(last.lat), lng: Number(last.lng) },
          map,
          icon: dotIcon('#EF4444'),
        })
        const iw2 = new google.maps.InfoWindow({
          content: `<b>Check-out</b><br/>${new Date(last.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
        })
        m2.addListener('click', () => iw2.open({ anchor: m2, map }))
      }

      // Phase 70.8 (22 May 2026) — owner directive: punched meetings
      // show on the day-track map with a blue pin + lead name. Click
      // the lead name in the popup → navigate to /leads/:id. Activity
      // types meeting + site_visit count.
      const meetingActs = (activities || []).filter(a =>
        (a.activity_type === 'meeting' || a.activity_type === 'site_visit')
        && Number.isFinite(Number(a.gps_lat))
        && Number.isFinite(Number(a.gps_lng))
        && a.lead?.id
      )
      for (const a of meetingActs) {
        const m = new google.maps.Marker({
          position: { lat: Number(a.gps_lat), lng: Number(a.gps_lng) },
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#3B82F6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        })
        const leadName = a.lead.company || a.lead.name || 'Lead'
        const leadHref = `/leads/${a.lead.id}`
        const iw = new google.maps.InfoWindow({
          content:
            `<div style="font-family: inherit; min-width: 160px;">` +
            `<a href="${leadHref}" data-lead-id="${a.lead.id}" style="color: #FFE600; font-weight: 600; text-decoration: underline; font-size: 14px;">` +
            `${leadName}` +
            `</a></div>`,
        })
        // Intercept the link click so we use React Router navigation
        // (avoids full-page reload).
        iw.addListener('domready', () => {
          const link = document.querySelector(`a[data-lead-id="${a.lead.id}"]`)
          if (link) {
            link.addEventListener('click', (ev) => {
              ev.preventDefault()
              navigate(leadHref)
            })
          }
        })
        m.addListener('click', () => iw.open({ anchor: m, map }))
      }

      // Numbered stop markers — Google Maps Marker with custom label.
      for (const s of stops) {
        const m = new google.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map,
          label: {
            text: String(s.id),
            color: '#ffffff',
            fontWeight: '700',
            fontSize: '13px',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: '#F59E0B',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        })
        const iw = new google.maps.InfoWindow({
          content:
            `<b>Stop ${s.id}</b><br/>` +
            `${new Date(s.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ` +
            `– ${new Date(s.ended_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}<br/>` +
            `<small>${s.minutes} min dwell</small>`,
        })
        m.addListener('click', () => iw.open({ anchor: m, map }))
      }
    } catch (e) {
      setError('Map render failed: ' + (e?.message || String(e)))
    }
    })()
    // Google Maps doesn't expose a .remove() like Leaflet; clearing
    // mapRef is enough — React unmounts the container and GC handles
    // the rest.
    return () => {
      mapRef.current = null
    }
  }, [loading, pings, activities])

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
