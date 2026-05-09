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
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatDate } from '../../utils/formatters'

// Haversine — straight-line km between two lat/lng pairs.
function haversineKm(a, b) {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// Inject Leaflet CSS + JS once. Returns a promise that resolves with
// window.L when ready.
// Phase 32A — owner reported (10 May 2026) "Map library failed to
// load: undefined" — unpkg.com flaky / blocked / slow. Switched to
// cdnjs.cloudflare.com which is more reliably reachable from India.
// Also: explicit window.L verify after onload (some flaky CDN paths
// resolve onload but never populate window.L), 10s timeout, and a
// fallback path that swaps to unpkg.com if cdnjs fails.
function loadLeafletFrom(cssUrl, jsUrl) {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L)
    let timer
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = cssUrl
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = jsUrl
    js.async = true
    js.onload = () => {
      clearTimeout(timer)
      if (window.L) resolve(window.L)
      else reject(new Error('Leaflet script loaded but window.L undefined'))
    }
    js.onerror = (e) => { clearTimeout(timer); reject(e || new Error('Leaflet script failed')) }
    document.head.appendChild(js)
    timer = setTimeout(() => reject(new Error('Leaflet load timed out after 10s')), 10000)
  })
}

function loadLeaflet() {
  if (window._leafletPromise) return window._leafletPromise
  window._leafletPromise = (async () => {
    if (window.L) return window.L
    try {
      return await loadLeafletFrom(
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
        'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
      )
    } catch (_e1) {
      // Fall back to unpkg if cdnjs is blocked. Don't reuse the cached
      // failed promise — try again from scratch.
      return await loadLeafletFrom(
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
      )
    }
  })()
  // If the promise rejects, clear the cache so retries can try again.
  window._leafletPromise.catch(() => { delete window._leafletPromise })
  return window._leafletPromise
}

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
  const mapRef     = useRef(null)
  const containerRef = useRef(null)

  // Fetch the rep + their pings for the selected day.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      const start = `${targetDate}T00:00:00`
      const end   = `${targetDate}T23:59:59`
      const [userRes, pingsRes] = await Promise.all([
        supabase.from('users').select('id, name, role, team_role, city').eq('id', userId).maybeSingle(),
        supabase.from('gps_pings')
          .select('id, captured_at, lat, lng, accuracy_m, source')
          .eq('user_id', userId)
          .gte('captured_at', start)
          .lte('captured_at', end)
          .order('captured_at', { ascending: true }),
      ])
      if (cancelled) return
      if (userRes.error)  { setError(userRes.error.message);  setLoading(false); return }
      if (pingsRes.error) { setError(pingsRes.error.message); setLoading(false); return }
      setUser(userRes.data || null)
      setPings(pingsRes.data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId, targetDate])

  // Total km driven, computed via Haversine sum.
  const stats = useMemo(() => {
    let km = 0
    for (let i = 1; i < pings.length; i++) {
      km += haversineKm(
        { lat: Number(pings[i - 1].lat), lng: Number(pings[i - 1].lng) },
        { lat: Number(pings[i].lat),     lng: Number(pings[i].lng) },
      )
    }
    return {
      km:    km.toFixed(1),
      pings: pings.length,
      first: pings[0]?.captured_at,
      last:  pings[pings.length - 1]?.captured_at,
    }
  }, [pings])

  // Render the Leaflet map once pings load.
  useEffect(() => {
    if (loading) return
    if (!containerRef.current) return
    if (pings.length === 0) return
    let map
    let cancelled = false
    loadLeaflet().then(L => {
      if (cancelled) return
      // Clean up any earlier map on this node (StrictMode double-mounts).
      if (mapRef.current) {
        try { mapRef.current.remove() } catch (_) {}
        mapRef.current = null
      }
      const center = [Number(pings[0].lat), Number(pings[0].lng)]
      map = L.map(containerRef.current).setView(center, 13)
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      // Polyline of the day.
      const latlngs = pings.map(p => [Number(p.lat), Number(p.lng)])
      const line = L.polyline(latlngs, { color: '#FFE600', weight: 4, opacity: 0.85 }).addTo(map)
      map.fitBounds(line.getBounds(), { padding: [30, 30] })

      // Start (green), end (red), interval pings (small yellow circles).
      pings.forEach((p, i) => {
        const isStart = i === 0
        const isEnd   = i === pings.length - 1
        const color = isStart ? '#10B981' : isEnd ? '#EF4444' : '#F59E0B'
        const radius = isStart || isEnd ? 8 : 4
        L.circleMarker([Number(p.lat), Number(p.lng)], {
          radius, color, weight: 2, fillColor: color, fillOpacity: 0.9,
        })
        .addTo(map)
        .bindPopup(
          `<b>${isStart ? 'Check-in' : isEnd ? 'Check-out' : p.source}</b><br/>` +
          `${new Date(p.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` +
          (p.accuracy_m ? `<br/><small>±${p.accuracy_m}m accuracy</small>` : '')
        )
      })
    }).catch(e => setError('Map library failed to load: ' + e?.message))
    return () => {
      cancelled = true
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
          </div>
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
    </div>
  )
}
