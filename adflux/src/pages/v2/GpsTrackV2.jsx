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
import { summariseTrack } from '../../utils/gpsDistance'

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
      const center = [Number(pings[0].lat), Number(pings[0].lng)]
      const map = L.map(containerRef.current).setView(center, 13)
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
