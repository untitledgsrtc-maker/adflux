// src/pages/v2/OpsHeadV2.jsx
//
// /ops-dashboard — Operations module Phase 2 (§230), redesigned to MATCH
// /team-dashboard (owner directive 25 Aug 2026: "op head dashboard must look
// like this, all theme must be same"). Same shape as TeamDashboardV2:
//   • purple KPI hero (screens online/offline · open tickets · techs on duty)
//   • the live field map (LiveFieldMap — the exact team-dashboard widget,
//     scoped to operation_executive via the Phase-0 gps_pings_ops_head RLS)
//   • a per-tech card grid (ops metrics: km · open tickets · screens up/down)
//   • Screens board (reassign a depot) + Tickets board (reassign a ticket)
//
// Reuses the shared lead-* theme classes (globals → leads.css) + LeadAvatar/Pill
// so it's visually identical to /team-dashboard. Additive; TeamDashboardV2 is
// byte-untouched (§45).

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Wrench, Camera, Loader2, RefreshCw, Timer, AlertTriangle, Phone, Plus, Trash2, X, Monitor,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { istTodayISO } from '../../utils/istDate'
import { LeadAvatar, Pill } from '../../components/leads/LeadShared'
import LiveFieldMap from '../../components/ops/LiveFieldMap'

const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700, padding: '9px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.04em' }
const td = { fontSize: 14, color: 'var(--text)', padding: '11px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }
const selBox = { background: 'var(--surface-2, var(--surface))', color: 'var(--text)', border: '1px solid var(--border-strong, var(--border))', borderRadius: 8, padding: '7px 9px', fontSize: 13, maxWidth: 190 }
const inp = { width: '100%', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border-strong, var(--border))', borderRadius: 'var(--radius, 10px)', padding: '10px 12px', fontSize: 14, boxSizing: 'border-box' }

function HeroStat({ label, value, delta, up, down }) {
  return (
    <div className="lead-hero-stat">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      <div className={`delta ${up ? 'up' : down ? 'down' : ''}`}>{delta}</div>
    </div>
  )
}

function chipInline(text, color, bg) {
  return <span style={{ background: bg, color, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{text}</span>
}
// circular tinted status badge — green (up) / red (down) / grey (unknown/no camera)
function StatusIcon({ Icon, on, title }) {
  const color = on === true ? 'var(--success)' : on === false ? 'var(--danger)' : 'var(--text-subtle, var(--text-muted))'
  const bg = on === true ? 'var(--success-soft, rgba(16,185,129,.12))' : on === false ? 'var(--danger-soft, rgba(239,68,68,.12))' : 'rgba(148,163,184,.12)'
  return (
    <span title={title} style={{ display: 'inline-flex', width: 34, height: 34, borderRadius: 999, background: bg, alignItems: 'center', justifyContent: 'center', color, opacity: on === null || on === undefined ? 0.5 : 1 }}>
      <Icon size={17} strokeWidth={1.7} />
    </span>
  )
}

export default function OpsHeadV2() {
  const profile = useAuthStore(s => s.profile)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [snapping, setSnapping] = useState(false)

  const [techs, setTechs] = useState([])       // operation_executive users
  const [screens, setScreens] = useState([])
  const [depots, setDepots] = useState([])
  const [tickets, setTickets] = useState([])
  const [pingByUser, setPingByUser] = useState({})
  const [sessByUser, setSessByUser] = useState({})
  const [kmByUser, setKmByUser] = useState({})
  const [uptimeByUser, setUptimeByUser] = useState({})
  const [contactsByDepot, setContactsByDepot] = useState({})   // depot_id -> [contact]
  const [camByScreen, setCamByScreen] = useState({})           // screen_id -> camera_active
  const [scrStation, setScrStation] = useState('all')          // screen-list station filter
  const [scrOffOnly, setScrOffOnly] = useState(false)          // screen-list: offline only

  // depot-contacts manager ("Who to call" — the exec Call-the-depot data)
  const [cDepot, setCDepot] = useState(null)                   // depot being managed
  const [cForm, setCForm] = useState({ role_en: '', name: '', phone: '' })
  const [cBusy, setCBusy] = useState(false)

  const today = istTodayISO()

  const load = useCallback(async () => {
    setErr('')
    try {
      const [tkUsers, scRes, depRes, tickRes, conRes] = await Promise.all([
        supabase.from('users').select('id, name, profile_image_url').eq('role', 'operation_executive').eq('is_active', true).order('name'),
        supabase.from('ops_screens').select('id, name, status, depot_id').eq('is_active', true).order('name'),
        supabase.from('ops_depots').select('id, name, assigned_to, city:cities!ops_depots_city_id_fkey(name)').eq('is_active', true).order('name'),
        supabase.from('ops_tickets')
          .select('id, type, status, priority, assigned_to, opened_at, ' +
                  'screen:ops_screens!ops_tickets_screen_id_fkey(name), ' +
                  'depot:ops_depots!ops_tickets_depot_id_fkey(name), ' +
                  'issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en)')
          .in('status', ['open', 'in_progress'])
          .order('priority', { ascending: false }).order('opened_at', { ascending: true }),
        supabase.from('ops_depot_contacts').select('id, depot_id, role_en, role_gu, name, phone').order('display_order'),
      ])
      if (scRes.error) throw scRes.error
      const execs = tkUsers.data || []
      setTechs(execs)
      setScreens(scRes.data || [])
      setDepots(depRes.data || [])
      setTickets(tickRes.data || [])
      const cbd = {}; (conRes.data || []).forEach(c => { (cbd[c.depot_id] = cbd[c.depot_id] || []).push(c) })
      setContactsByDepot(cbd)
      // per-screen camera status — resilient (the column may not exist before the SQL runs)
      const camRes = await supabase.from('ops_screens').select('id, camera_active').eq('is_active', true)
      const cm = {}; (camRes.data || []).forEach(c => { cm[c.id] = c.camera_active })
      setCamByScreen(cm)

      const execIds = execs.map(e => e.id)
      if (execIds.length) {
        const mStart = `${today.slice(0, 8)}01`   // first of this IST month
        const [pingRes, wsRes, taRes, upRes] = await Promise.all([
          supabase.rpc('latest_ping_per_user', { p_since: `${today}T00:00:00+05:30`, p_until: `${today}T23:59:59+05:30` }),
          supabase.from('work_sessions').select('user_id, check_in_at, check_out_at, auto_checked_out').eq('work_date', today).in('user_id', execIds),
          supabase.from('daily_ta').select('user_id, km_traveled').eq('ta_date', today).in('user_id', execIds),
          supabase.from('ops_uptime_daily').select('user_id, uptime_pct, screens_total').gte('work_date', mStart).in('user_id', execIds),
        ])
        const pm = {}; (pingRes.data || []).forEach(p => { if (!pm[p.user_id]) pm[p.user_id] = { lat: p.lat, lng: p.lng, captured_at: p.captured_at } })
        const sm = {}; (wsRes.data || []).forEach(w => { sm[w.user_id] = w })
        const km = {}; (taRes.data || []).forEach(k => { km[k.user_id] = k.km_traveled })
        // avg uptime this month per tech (rows with real measurement only)
        const acc = {}; (upRes.data || []).forEach(r => { if (r.screens_total > 0) { const a = (acc[r.user_id] ||= { sum: 0, n: 0 }); a.sum += Number(r.uptime_pct); a.n += 1 } })
        const up = {}; Object.keys(acc).forEach(id => { up[id] = Math.round((acc[id].sum / acc[id].n) * 10) / 10 })
        setPingByUser(pm); setSessByUser(sm); setKmByUser(km); setUptimeByUser(up)
      } else { setPingByUser({}); setSessByUser({}); setKmByUser({}); setUptimeByUser({}) }
    } catch (e) { setErr(e?.message || 'load failed') } finally { setLoading(false) }
  }, [today])

  useEffect(() => { load() }, [load])

  const health = useMemo(() => {
    const h = { total: screens.length, online: 0, offline: 0, unknown: 0 }
    screens.forEach(s => { h[s.status] = (h[s.status] || 0) + 1 })
    return h
  }, [screens])

  const screensByDepot = useMemo(() => {
    const m = {}
    screens.forEach(s => { const d = (m[s.depot_id] ||= { online: 0, offline: 0, total: 0 }); d[s.status] = (d[s.status] || 0) + 1; d.total += 1 })
    return m
  }, [screens])

  // per-tech: screens up/down (over the depots they own) + open tickets
  const perTech = useMemo(() => {
    const depotsOf = {}; depots.forEach(d => { if (d.assigned_to) (depotsOf[d.assigned_to] ||= []).push(d.id) })
    const tkCount = {}; tickets.forEach(t => { if (t.assigned_to) tkCount[t.assigned_to] = (tkCount[t.assigned_to] || 0) + 1 })
    const out = {}
    techs.forEach(t => {
      let up = 0, down = 0
      ;(depotsOf[t.id] || []).forEach(did => { const s = screensByDepot[did]; if (s) { up += s.online; down += s.offline } })
      const w = sessByUser[t.id]
      const ping = pingByUser[t.id]
      const ageMin = ping?.captured_at ? (Date.now() - new Date(ping.captured_at).getTime()) / 60000 : Infinity
      out[t.id] = {
        working: !!(w?.check_in_at && !w?.check_out_at && !w?.auto_checked_out),
        km: kmByUser[t.id] || 0, up, down, openTickets: tkCount[t.id] || 0,
        uptime: uptimeByUser[t.id] ?? null,
        depotNames: (depotsOf[t.id] || []).map(did => depots.find(d => d.id === did)?.name).filter(Boolean),
        ageMin,
      }
    })
    return out
  }, [techs, depots, screensByDepot, tickets, sessByUser, pingByUser, kmByUser, uptimeByUser])

  // overdue tickets — open past 48h (SLA band)
  const overdue = useMemo(() => tickets.filter(t => t.opened_at && (Date.now() - new Date(t.opened_at).getTime()) > 48 * 3600 * 1000), [tickets])

  // per-screen status list (screen online/offline + camera on/off), filterable
  const screenRows = useMemo(() => {
    const nameOf = {}; depots.forEach(d => { nameOf[d.id] = d.name })
    let list = screens.map(s => ({ id: s.id, name: s.name, status: s.status, depot_id: s.depot_id, station: nameOf[s.depot_id] || '—', cam: camByScreen[s.id] }))
    if (scrStation !== 'all') list = list.filter(s => s.depot_id === scrStation)
    if (scrOffOnly) list = list.filter(s => s.status !== 'online' || s.cam === false)
    return list.sort((a, b) => (a.station || '').localeCompare(b.station || '') || (a.name || '').localeCompare(b.name || ''))
  }, [screens, depots, camByScreen, scrStation, scrOffOnly])

  const activeIds = useMemo(() => new Set(techs.filter(t => perTech[t.id]?.working).map(t => t.id)), [techs, perTech])
  const mapUsers = useMemo(() => techs.map(t => ({
    id: t.id, name: t.name, profile_image_url: t.profile_image_url,
    meta: (perTech[t.id]?.depotNames || []).slice(0, 2).join(' · ') || 'Field tech',
  })), [techs, perTech])
  const liveCount = activeIds.size

  async function reassignDepot(depotId, techId) {
    const { error } = await supabase.from('ops_depots').update({ assigned_to: techId || null }).eq('id', depotId)
    if (error) return toastError(error, 'Reassign failed')
    toastSuccess('Depot reassigned'); load()
  }
  async function reassignTicket(ticketId, techId) {
    const { error } = await supabase.from('ops_tickets').update({ assigned_to: techId || null }).eq('id', ticketId)
    if (error) return toastError(error, 'Reassign failed')
    toastSuccess('Ticket reassigned'); load()
  }
  async function snapshotUptime() {
    setSnapping(true)
    try {
      const { error } = await supabase.rpc('ops_recompute_uptime_today')
      if (error) throw error
      toastSuccess("Today's uptime recorded")
    } catch (e) { toastError(e, 'Uptime snapshot needs the Phase 4 SQL run first') } finally { setSnapping(false) }
  }
  async function addContact() {
    const name = cForm.name.trim(), phone = cForm.phone.trim(), role_en = cForm.role_en.trim()
    if (!cDepot || (!name && !phone)) return
    setCBusy(true)
    const { error } = await supabase.from('ops_depot_contacts').insert([{
      depot_id: cDepot.id, role_en: role_en || null, name: name || null, phone: phone || null,
      display_order: (contactsByDepot[cDepot.id]?.length || 0) + 1,
    }])
    setCBusy(false)
    if (error) return toastError(error, 'Could not add contact')
    setCForm({ role_en: '', name: '', phone: '' })
    toastSuccess('Contact added'); load()
  }
  async function delContact(id) {
    const { error } = await supabase.from('ops_depot_contacts').delete().eq('id', id)
    if (error) return toastError(error, 'Could not remove')
    toastSuccess('Removed'); load()
  }

  const niceTime = new Date().toLocaleString('en-IN', { weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false })

  if (loading) {
    return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} strokeWidth={1.6} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  }

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Screen network · {health.total} screens · live</div>
          <div className="lead-page-title">Operations</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="lead-btn" onClick={snapshotUptime} disabled={snapping}>
            {snapping ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Timer size={14} />} Record uptime
          </button>
          <button className="lead-btn lead-btn-primary" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {err && (
        <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13 }}>{err}</div>
      )}

      {/* purple hero (matches /team-dashboard) */}
      <div className="lead-hero-strip" style={{ background: 'radial-gradient(700px 220px at 100% 0%, rgba(192,132,252,.22), transparent 60%), linear-gradient(120deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)', borderColor: '#4338ca' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>
            <span className="lead-live-dot" />&nbsp;&nbsp;Network activity · live
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{niceTime} IST</span>
        </div>
        <div className="lead-hero-stats">
          <HeroStat label="Screens online"  value={health.online}  delta={`of ${health.total}`}       up={health.online > 0} />
          <HeroStat label="Screens offline" value={health.offline} delta={health.offline ? 'down now' : 'all up'} down={health.offline > 0} />
          <HeroStat label="Open tickets"    value={tickets.length} delta="fault + photo"              down={tickets.length > 0} />
          <HeroStat label="Techs on duty"   value={`${liveCount} / ${techs.length}`} delta={`${techs.length - liveCount} off`} down={liveCount < techs.length} />
        </div>
      </div>

      {/* overdue-tickets SLA band */}
      {overdue.length > 0 && (
        <div className="lead-card" style={{ marginBottom: 14, borderColor: 'var(--danger)', background: 'var(--danger-soft, rgba(239,68,68,.08))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap' }}>
            <AlertTriangle size={18} style={{ color: 'var(--danger)' }} />
            <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{overdue.length} ticket{overdue.length === 1 ? '' : 's'} overdue</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>open more than 48h — {overdue.slice(0, 3).map(t => t.depot?.name).filter(Boolean).join(', ')}{overdue.length > 3 ? '…' : ''}</span>
          </div>
        </div>
      )}

      {/* live field map */}
      <div className="lead-card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px' }}>
          <div>
            <div className="lead-card-title">Live field map</div>
            <div className="lead-card-sub">Where the field team is right now. Tap a face to see who.</div>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#10B981', marginRight: 4 }} />fresh</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#F59E0B', marginRight: 4 }} />5-30min</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#EF4444', marginRight: 4 }} />stale</span>
          </div>
        </div>
        <LiveFieldMap users={mapUsers} pingByUser={pingByUser} activeIds={activeIds} height={360} />
      </div>

      {/* per-tech cards */}
      {techs.length === 0 ? (
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          No field techs yet. Create operation_executive users (with manager_id set to you) + assign them depots.
        </div>
      ) : (
        <div className="lead-team-grid">
          {techs.map(t => {
            const p = perTech[t.id] || {}
            return (
              <div className={`lead-rep-card ${p.working ? 'live' : ''}`} key={t.id}>
                <div className="lead-rep-head">
                  <LeadAvatar name={t.name} userId={t.id} imageUrl={t.profile_image_url} />
                  <div>
                    <div className="lead-rep-name">{t.name}</div>
                    <div className="lead-rep-meta">{(p.depotNames || []).slice(0, 2).join(' · ') || 'Field tech'}</div>
                  </div>
                  <div className="lead-rep-status" style={{ marginLeft: 'auto' }}>
                    {p.working
                      ? <Pill tone="success"><span className="lead-live-dot" style={{ marginRight: 5, width: 6, height: 6 }} /> in field</Pill>
                      : <Pill title="Not checked in today">off</Pill>}
                  </div>
                </div>
                <div className="lead-rep-kpis">
                  <div className="lead-rep-kpi"><div className="num">{Number(p.km || 0).toFixed(1)}</div><div className="lbl">Km today</div></div>
                  <div className="lead-rep-kpi"><div className={`num ${p.openTickets ? 'dng' : ''}`}>{p.openTickets || 0}</div><div className="lbl">Open tickets</div></div>
                  <div className="lead-rep-kpi"><div className={`num ${p.up ? 'suc' : ''}`}>{p.up || 0}</div><div className="lbl">Screens up</div></div>
                  <div className="lead-rep-kpi"><div className={`num ${p.down ? 'dng' : ''}`}>{p.down || 0}</div><div className="lbl">Screens down</div></div>
                  <div className="lead-rep-kpi"><div className={`num ${p.uptime == null ? '' : p.uptime >= 90 ? 'suc' : 'warn'}`}>{p.uptime == null ? '—' : `${p.uptime}%`}</div><div className="lbl">Uptime (mo)</div></div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Screens board — reassign a depot */}
      <div className="lead-card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px' }}>
          <div><div className="lead-card-title">Screens by station</div><div className="lead-card-sub">Reassign a station, and set who a tech should call for each depot.</div></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr><th style={th}>Station</th><th style={th}>City</th><th style={th}>Screens</th><th style={th}>Online</th><th style={th}>Offline</th><th style={th}>Assigned tech</th><th style={th}>Who to call</th></tr></thead>
            <tbody>
              {depots.length === 0 && <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={7}>No stations.</td></tr>}
              {depots.map(d => {
                const s = screensByDepot[d.id] || { online: 0, offline: 0, total: 0 }
                const nc = contactsByDepot[d.id]?.length || 0
                return (
                  <tr key={d.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                    <td style={{ ...td, color: 'var(--text-muted)' }}>{d.city?.name || '—'}</td>
                    <td style={td}>{s.total}</td>
                    <td style={{ ...td, color: 'var(--success)', fontWeight: 700 }}>{s.online}</td>
                    <td style={{ ...td, color: s.offline ? 'var(--danger)' : 'var(--text-muted)', fontWeight: s.offline ? 700 : 400 }}>{s.offline}</td>
                    <td style={td}>
                      <select value={d.assigned_to || ''} onChange={e => reassignDepot(d.id, e.target.value)} style={selBox}>
                        <option value="">— unassigned —</option>
                        {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <button className="btn btn-sec btn-sm" onClick={() => { setCDepot(d); setCForm({ role_en: '', name: '', phone: '' }) }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: nc ? 'var(--text)' : 'var(--warning)' }}>
                        <Phone size={14} strokeWidth={1.6} /> {nc || 'Add'} {nc ? `contact${nc === 1 ? '' : 's'}` : ''}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Screen-wise status — each screen's display + camera badge */}
      <div className="lead-card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px', flexWrap: 'wrap', gap: 10 }}>
          <div><div className="lead-card-title">Screens</div><div className="lead-card-sub">Every screen — display + camera status. {screenRows.length} shown.</div></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
            <select value={scrStation} onChange={e => setScrStation(e.target.value)} style={selBox}>
              <option value="all">All stations</option>
              {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button onClick={() => setScrOffOnly(v => !v)} className="btn btn-sec btn-sm"
              style={{ color: scrOffOnly ? 'var(--danger)' : 'var(--text-muted)' }}>
              {scrOffOnly ? 'Showing down only' : 'Show down only'}
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead><tr>
              <th style={th}>Screen</th><th style={th}>Station</th>
              <th style={{ ...th, textAlign: 'center' }}>Status</th>
            </tr></thead>
            <tbody>
              {screenRows.length === 0 && <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={3}>No screens.</td></tr>}
              {screenRows.map(s => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{s.station}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', gap: 8, justifyContent: 'center' }}>
                      <StatusIcon Icon={Monitor} on={s.status === 'online'} title={s.status === 'online' ? 'Screen online' : 'Screen offline'} />
                      <StatusIcon Icon={Camera} on={s.cam === true ? true : s.cam === false ? false : null} title={s.cam === true ? 'Camera active' : s.cam === false ? 'Camera inactive' : 'No camera'} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tickets board — reassign a ticket */}
      <div className="lead-card" style={{ marginTop: 14, padding: 0, overflow: 'hidden' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px' }}>
          <div><div className="lead-card-title">Open tickets</div><div className="lead-card-sub">Reassign a job to another tech.</div></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr><th style={th}>Type</th><th style={th}>Screen · Station</th><th style={th}>Issue</th><th style={th}>Priority</th><th style={th}>Status</th><th style={th}>Assigned tech</th></tr></thead>
            <tbody>
              {tickets.length === 0 && <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={6}>No open tickets.</td></tr>}
              {tickets.map(tk => (
                <tr key={tk.id}>
                  <td style={td}>{tk.type === 'photo_request'
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--blue)' }}><Camera size={14} strokeWidth={1.6} />Photo</span>
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Wrench size={14} strokeWidth={1.6} />Fault</span>}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{[tk.screen?.name, tk.depot?.name].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ ...td, color: 'var(--text-muted)' }}>{tk.issue?.issue_en || (tk.type === 'photo_request' ? 'Live photo' : '—')}</td>
                  <td style={td}>{tk.priority === 'high' ? chipInline('High', 'var(--warning)', 'var(--warning-soft, rgba(245,158,11,.12))') : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tk.priority}</span>}</td>
                  <td style={td}>{tk.status === 'in_progress' ? chipInline('In progress', 'var(--blue)', 'rgba(59,130,246,.12)') : chipInline('Open', 'var(--danger)', 'var(--danger-soft, rgba(239,68,68,.12))')}</td>
                  <td style={td}>
                    <select value={tk.assigned_to || ''} onChange={e => reassignTicket(tk.id, e.target.value)} style={selBox}>
                      <option value="">— unassigned —</option>
                      {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* depot-contacts manager — the exec "Call the depot" data (was seed-only) */}
      {cDepot && (
        <div onClick={() => !cBusy && setCDepot(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)', padding: 20, maxHeight: '86vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>Who to call · {cDepot.name}</div>
              <button onClick={() => !cBusy && setCDepot(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
              The field tech sees these numbers on a ticket at this station — electrician, depot manager, screen service, etc.
            </p>
            {(contactsByDepot[cDepot.id] || []).length === 0 && (
              <div style={{ fontSize: 13.5, color: 'var(--text-muted)', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>No contacts yet — add the first one below.</div>
            )}
            {(contactsByDepot[cDepot.id] || []).map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name || c.role_en || 'Contact'}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{[c.role_en, c.phone].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <button onClick={() => delContact(c.id)} title="Remove" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}><Trash2 size={16} /></button>
              </div>
            ))}
            <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
              <input value={cForm.role_en} onChange={e => setCForm(f => ({ ...f, role_en: e.target.value }))} placeholder="Role (e.g. Electrician, Depot manager)" style={inp} />
              <input value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} placeholder="Name (optional)" style={inp} />
              <input value={cForm.phone} onChange={e => setCForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone number" inputMode="tel" style={inp} />
              <button className="btn btn-primary" onClick={addContact} disabled={cBusy || (!cForm.name.trim() && !cForm.phone.trim())}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2 }}>
                {cBusy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={16} />} Add contact
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
