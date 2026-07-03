// src/pages/v2/TeamMonitorV2.jsx
//
// Phase 193 — lightweight "team monitor" for a team-dashboard viewer (a TC
// supervisor with can_view_team_dashboard). Shows WHERE every rep is (live
// Leaflet map) + today's per-rep activity (calls / connected / meetings /
// leads). ALL data comes from ONE gated RPC (team_monitor_snapshot) that runs
// SECURITY DEFINER + is gated on is_team_viewer() OR admin — so the viewer sees
// team rollups here WITHOUT any broad table grant leaking into her other pages
// (she stays own-only on /leads, /work, etc). Route guard = RequireTeamView.

import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Users, Phone, CalendarCheck, UserPlus, RefreshCw, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const GUJARAT = [22.6, 71.6]

function minsAgo(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.round(ms / 60000))
}
// freshness → colour (green ≤5m, amber ≤30m, grey older / never)
function freshColor(mins) {
  if (mins == null) return '#64748b'
  if (mins <= 5) return '#10B981'
  if (mins <= 30) return '#F59E0B'
  return '#94a3b8'
}
function lastSeen(mins) {
  if (mins == null) return 'no location yet'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h}h ${mins % 60}m ago`
}

export default function TeamMonitorV2() {
  const [reps, setReps] = useState(null) // null=loading, []=none
  const [err, setErr] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(null)
  const mapRef = useRef(null)       // Leaflet map instance
  const mapElRef = useRef(null)     // the div
  const markersRef = useRef(null)   // layerGroup

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('team_monitor_snapshot')
    if (error) { setErr('Could not load the team monitor.'); return }
    setErr(null)
    setReps(Array.isArray(data) ? data : [])
    setRefreshedAt(new Date())
  }, [])

  // initial + 20s auto-refresh + refetch on focus
  useEffect(() => {
    load()
    const iv = setInterval(load, 20000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [load])

  // init the map once
  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return
    const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: false })
      .setView(GUJARAT, 7)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)
    markersRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // redraw markers when reps change
  useEffect(() => {
    const map = mapRef.current, grp = markersRef.current
    if (!map || !grp || !reps) return
    grp.clearLayers()
    const pts = []
    reps.forEach((r) => {
      if (r.lat == null || r.lng == null) return
      const mins = minsAgo(r.last_ping_at)
      const m = L.circleMarker([r.lat, r.lng], {
        radius: 8, color: '#0c1224', weight: 2,
        fillColor: freshColor(mins), fillOpacity: 0.95,
      }).bindPopup(`<b>${r.name || 'Rep'}</b><br/>${lastSeen(mins)}`)
      m.addTo(grp)
      pts.push([r.lat, r.lng])
    })
    if (pts.length) {
      try { map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }) } catch (e) { /* single point */ }
    }
    setTimeout(() => { try { map.invalidateSize() } catch (e) {} }, 60)
  }, [reps])

  const onCount = reps ? reps.filter((r) => minsAgo(r.last_ping_at) != null && minsAgo(r.last_ping_at) <= 5).length : 0

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--accent-soft, rgba(255,230,0,0.14))', color: 'var(--accent, #FFE600)',
        }}>
          <Users size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text, #f1f5f9)' }}>Team monitor</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>
            {reps == null ? 'Loading…' : `${reps.length} reps · ${onCount} live now`}
            {refreshedAt && ` · updated ${refreshedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
        <button type="button" onClick={load} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          borderRadius: 10, border: '1px solid var(--border, #334155)', cursor: 'pointer',
          background: 'transparent', color: 'var(--text-muted, #94a3b8)', fontSize: 13, fontWeight: 600,
        }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {err && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13,
          color: 'var(--danger, #EF4444)', background: 'var(--danger-soft, rgba(239,68,68,0.12))',
        }}>{err}</div>
      )}

      {/* live map */}
      <div ref={mapElRef} style={{
        height: 360, width: '100%', borderRadius: 14, overflow: 'hidden',
        border: '1px solid var(--border, #334155)', marginBottom: 16, background: 'var(--surface-2, #334155)',
      }} />

      {/* rep cards */}
      {reps == null ? (
        <div style={{ color: 'var(--text-subtle, #64748b)', fontSize: 13, padding: 20 }}>Loading team…</div>
      ) : reps.length === 0 ? (
        <div style={{ color: 'var(--text-subtle, #64748b)', fontSize: 13, padding: 20 }}>No active reps.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {reps.map((r) => {
            const mins = minsAgo(r.last_ping_at)
            const dot = freshColor(mins)
            const rate = r.calls > 0 ? Math.round((r.connected / r.calls) * 100) : null
            return (
              <div key={r.id} style={{
                padding: '14px 16px', borderRadius: 14,
                background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{
                    width: 34, height: 34, borderRadius: 999, flex: '0 0 auto',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--surface-2, #334155)', color: 'var(--text, #f1f5f9)',
                    fontWeight: 700, fontSize: 14, overflow: 'hidden',
                  }}>
                    {r.avatar
                      ? <img src={r.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (r.name || '?').charAt(0).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #f1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.name || 'Rep'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle, #64748b)', textTransform: 'capitalize' }}>{r.role}</div>
                  </div>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: dot, flex: '0 0 auto' }} title={lastSeen(mins)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-subtle, #64748b)', marginBottom: 10 }}>
                  <MapPin size={12} /> {lastSeen(mins)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Kpi icon={<Phone size={13} />} label="Calls" value={r.calls} sub={rate != null ? `${rate}% conn` : null} />
                  <Kpi icon={<CalendarCheck size={13} />} label="Meetings" value={r.meetings} />
                  <Kpi icon={<UserPlus size={13} />} label="New leads" value={r.leads} />
                  <Kpi icon={<Phone size={13} />} label="Connected" value={r.connected} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, label, value, sub }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2, #334155)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-subtle, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {icon} {label}
      </div>
      <div className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text, #f1f5f9)', lineHeight: 1.1 }}>
        {value ?? 0}{sub && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #94a3b8)', marginLeft: 5 }}>{sub}</span>}
      </div>
    </div>
  )
}
