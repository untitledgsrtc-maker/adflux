// src/pages/v2/OpsHeadV2.jsx
//
// /ops-dashboard — Operations module Phase 2 (§230).
//
// The Operation Head's desk console. English (desk role). Four tabs:
//   • Overview  — network health KPIs + "record today's uptime" snapshot.
//   • Screens   — depot board; reassign a depot to another field tech.
//   • Tickets   — every open/in-progress ticket; reassign to another tech.
//   • Field team — roster of the roving techs: checked-in?, km today,
//     last-GPS-ping freshness, open-ticket count (reuses the sales
//     tracking infra via the Phase 0 ops-head RLS grants).
//
// The Head has FOR ALL on ops_depots/screens/tickets (Phase 0), so the
// reassign writes go straight through RLS. Field tracking reads gps_pings
// (via latest_ping_per_user, SECURITY INVOKER → scoped by gps_pings_ops_head),
// daily_ta (ta_ops_head), and work_sessions (manager_id chain — needs the
// exec's manager_id = the head).
//
// Additive module — no sales/frozen contract touched.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Tv, Wrench, Camera, Loader2, RefreshCw, Users, AlertTriangle,
  Wifi, WifiOff, HelpCircle, Timer,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { istTodayISO } from '../../utils/istDate'

/* ─── styling (v2 tokens) ──────────────────────────────────────────── */
const card = { background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)', borderRadius: 'var(--v2-r)', padding: 16 }
const th = { textAlign: 'left', fontSize: 12, color: 'var(--v2-ink-2)', fontWeight: 700, padding: '9px 12px', borderBottom: '1px solid var(--v2-line)', whiteSpace: 'nowrap' }
const td = { fontSize: 14, color: 'var(--v2-ink-0)', padding: '11px 12px', borderBottom: '1px solid var(--v2-line)', verticalAlign: 'middle' }
const selBox = { background: 'var(--v2-bg-2)', color: 'var(--v2-ink-0)', border: '1px solid var(--v2-surface-3)', borderRadius: 'var(--v2-r-sm)', padding: '7px 9px', fontSize: 13, maxWidth: 190 }

function chip(text, bg, fg) {
  return <span style={{ background: bg, color: fg, fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>{text}</span>
}
const STATUS_CHIP = {
  open:        () => chip('Open', 'var(--v2-rose-soft)', 'var(--v2-rose)'),
  in_progress: () => chip('In progress', 'var(--v2-tint-blue)', 'var(--v2-blue)'),
  resolved:    () => chip('Resolved', 'var(--v2-green-soft)', 'var(--v2-green)'),
}

export default function OpsHeadV2() {
  const profile = useAuthStore(s => s.profile)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [snapping, setSnapping] = useState(false)

  const [techs, setTechs] = useState([])        // operation_executive users
  const [screens, setScreens] = useState([])    // {status, depot_id}
  const [depots, setDepots] = useState([])       // {id,name,assigned_to, city}
  const [tickets, setTickets] = useState([])
  const [field, setField] = useState([])         // roster rows

  const today = istTodayISO()

  const load = useCallback(async () => {
    setErr('')
    try {
      const [tkUsers, scRes, depRes, tickRes] = await Promise.all([
        supabase.from('users').select('id, name').eq('role', 'operation_executive').eq('is_active', true).order('name'),
        supabase.from('ops_screens').select('id, status, depot_id').eq('is_active', true),
        supabase.from('ops_depots').select('id, name, assigned_to, city:cities!ops_depots_city_id_fkey(name)').eq('is_active', true).order('name'),
        supabase.from('ops_tickets')
          .select('id, type, status, priority, assigned_to, opened_at, ' +
                  'screen:ops_screens!ops_tickets_screen_id_fkey(name), ' +
                  'depot:ops_depots!ops_tickets_depot_id_fkey(name), ' +
                  'issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en)')
          .in('status', ['open', 'in_progress'])
          .order('priority', { ascending: false }).order('opened_at', { ascending: true }),
      ])
      if (scRes.error) throw scRes.error
      const execs = tkUsers.data || []
      setTechs(execs)
      setScreens(scRes.data || [])
      setDepots(depRes.data || [])
      setTickets(tickRes.data || [])

      // Field roster — mirrors TeamDashboardV2 (ops-head RLS scopes to execs).
      const execIds = execs.map(e => e.id)
      if (execIds.length) {
        const [pingRes, wsRes, taRes, tkCountRes] = await Promise.all([
          supabase.rpc('latest_ping_per_user', { p_since: `${today}T00:00:00+05:30`, p_until: `${today}T23:59:59+05:30` }),
          supabase.from('work_sessions').select('user_id, check_in_at, check_out_at, auto_checked_out').eq('work_date', today).in('user_id', execIds),
          supabase.from('daily_ta').select('user_id, km_traveled').eq('ta_date', today).in('user_id', execIds),
          supabase.from('ops_tickets').select('assigned_to').in('status', ['open', 'in_progress']).in('assigned_to', execIds),
        ])
        const pingMap = {}; (pingRes.data || []).forEach(p => { if (!pingMap[p.user_id]) pingMap[p.user_id] = p })
        const wsMap = {}; (wsRes.data || []).forEach(w => { wsMap[w.user_id] = w })
        const kmMap = {}; (taRes.data || []).forEach(k => { kmMap[k.user_id] = k.km_traveled })
        const tkMap = {}; (tkCountRes.data || []).forEach(r => { tkMap[r.assigned_to] = (tkMap[r.assigned_to] || 0) + 1 })
        setField(execs.map(e => {
          const w = wsMap[e.id]
          const ping = pingMap[e.id]
          const ageMin = ping?.captured_at ? (Date.now() - new Date(ping.captured_at).getTime()) / 60000 : Infinity
          return {
            id: e.id, name: e.name,
            working: !!(w?.check_in_at && !w?.check_out_at && !w?.auto_checked_out),
            checkedInAt: w?.check_in_at || null,
            km: kmMap[e.id] || 0,
            lastPingAt: ping?.captured_at || null,
            ageMin, openTickets: tkMap[e.id] || 0,
          }
        }))
      } else {
        setField([])
      }
    } catch (e) {
      setErr(e?.message || 'load failed')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => { load() }, [load])

  // screen health
  const health = useMemo(() => {
    const h = { total: screens.length, online: 0, offline: 0, unknown: 0 }
    screens.forEach(s => { h[s.status] = (h[s.status] || 0) + 1 })
    return h
  }, [screens])

  const screensByDepot = useMemo(() => {
    const m = {}
    screens.forEach(s => {
      const d = (m[s.depot_id] ||= { online: 0, offline: 0, unknown: 0, total: 0 })
      d[s.status] = (d[s.status] || 0) + 1; d.total += 1
    })
    return m
  }, [screens])

  async function reassignDepot(depotId, techId) {
    const { error } = await supabase.from('ops_depots').update({ assigned_to: techId || null }).eq('id', depotId)
    if (error) { toastError(error, 'Reassign failed'); return }
    toastSuccess('Depot reassigned'); load()
  }
  async function reassignTicket(ticketId, techId) {
    const { error } = await supabase.from('ops_tickets').update({ assigned_to: techId || null }).eq('id', ticketId)
    if (error) { toastError(error, 'Reassign failed'); return }
    toastSuccess('Ticket reassigned'); load()
  }

  async function snapshotUptime() {
    setSnapping(true)
    try {
      // Phase 4 helper — snapshots current screen statuses into
      // ops_uptime_daily per exec (the pay signal). No-ops safely
      // (rpc error) until the Phase 4 SQL is run by the owner.
      const { error } = await supabase.rpc('ops_recompute_uptime_today')
      if (error) throw error
      toastSuccess("Today's uptime recorded")
    } catch (e) {
      toastError(e, 'Uptime snapshot needs the Phase 4 SQL run first')
    } finally { setSnapping(false) }
  }

  const wrap = { maxWidth: 1100, margin: '0 auto', padding: '18px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }

  if (loading) return <div style={{ ...wrap, alignItems: 'center', paddingTop: 60 }}><Loader2 size={30} strokeWidth={1.6} style={{ color: 'var(--v2-ink-2)', animation: 'spin 1s linear infinite' }} /></div>

  const TABS = [
    ['overview', 'Overview', Tv],
    ['screens', 'Screens', Wifi],
    ['tickets', 'Tickets', Wrench],
    ['field', 'Field team', Users],
  ]

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--v2-display)' }}>Operations</div>
        <button onClick={load} style={{ marginLeft: 'auto', background: 'var(--v2-bg-2)', border: '1px solid var(--v2-line)', color: 'var(--v2-ink-1)', borderRadius: 'var(--v2-r-sm)', padding: '7px 12px', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={15} strokeWidth={1.6} />Refresh
        </button>
      </div>

      {err && (
        <div style={{ ...card, borderColor: 'var(--v2-rose)', display: 'flex', gap: 10, alignItems: 'center', color: 'var(--v2-ink-1)' }}>
          <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-rose)' }} />
          <span style={{ fontSize: 13, wordBreak: 'break-word' }}>{err}</span>
        </div>
      )}

      {/* tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--v2-bg-2)', borderRadius: 999, padding: 3, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {TABS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            border: 'none', cursor: 'pointer', borderRadius: 999, padding: '8px 15px', fontSize: 13.5, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: tab === k ? 'var(--v2-yellow)' : 'transparent',
            color: tab === k ? 'var(--v2-yellow-ink)' : 'var(--v2-ink-1)',
          }}><Icon size={15} strokeWidth={1.6} />{label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Kpi n={health.total} label="Total screens" icon={Tv} color="var(--v2-ink-0)" />
            <Kpi n={health.online} label="Online" icon={Wifi} color="var(--v2-green)" />
            <Kpi n={health.offline} label="Offline" icon={WifiOff} color="var(--v2-rose)" />
            <Kpi n={health.unknown} label="Unknown" icon={HelpCircle} color="var(--v2-ink-2)" />
            <Kpi n={tickets.length} label="Open tickets" icon={Wrench} color="var(--v2-rose)" />
            <Kpi n={field.filter(f => f.working).length} label="Techs on duty" icon={Users} color="var(--v2-blue)" />
          </div>
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>Record today's uptime</div>
              <div style={{ fontSize: 13, color: 'var(--v2-ink-2)' }}>
                Snapshots each screen's current status into every tech's daily uptime — the pay signal.
                Meaningful once statuses reflect real data (aiadflux sync, Phase 5).
              </div>
            </div>
            <button onClick={snapshotUptime} disabled={snapping} style={{ background: 'var(--v2-yellow)', color: 'var(--v2-yellow-ink)', border: 'none', borderRadius: 'var(--v2-r-sm)', padding: '11px 16px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {snapping ? <Loader2 size={16} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} /> : <Timer size={16} strokeWidth={1.6} />}
              Record uptime
            </button>
          </div>
        </>
      )}

      {/* ── SCREENS (depot board + reassign) ── */}
      {tab === 'screens' && (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>
              <th style={th}>Bus station (depot)</th><th style={th}>City</th>
              <th style={th}>Screens</th><th style={th}>Online</th><th style={th}>Offline</th>
              <th style={th}>Assigned tech</th>
            </tr></thead>
            <tbody>
              {depots.length === 0 && <tr><td style={{ ...td, color: 'var(--v2-ink-2)' }} colSpan={6}>No depots.</td></tr>}
              {depots.map(d => {
                const s = screensByDepot[d.id] || { online: 0, offline: 0, total: 0 }
                return (
                  <tr key={d.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                    <td style={{ ...td, color: 'var(--v2-ink-2)' }}>{d.city?.name || '—'}</td>
                    <td style={td}>{s.total}</td>
                    <td style={{ ...td, color: 'var(--v2-green)', fontWeight: 700 }}>{s.online}</td>
                    <td style={{ ...td, color: s.offline ? 'var(--v2-rose)' : 'var(--v2-ink-2)', fontWeight: s.offline ? 700 : 400 }}>{s.offline}</td>
                    <td style={td}>
                      <select value={d.assigned_to || ''} onChange={e => reassignDepot(d.id, e.target.value)} style={selBox}>
                        <option value="">— unassigned —</option>
                        {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TICKETS (all open + reassign) ── */}
      {tab === 'tickets' && (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead><tr>
              <th style={th}>Type</th><th style={th}>Screen · Depot</th><th style={th}>Issue</th>
              <th style={th}>Priority</th><th style={th}>Status</th><th style={th}>Assigned tech</th>
            </tr></thead>
            <tbody>
              {tickets.length === 0 && <tr><td style={{ ...td, color: 'var(--v2-ink-2)' }} colSpan={6}>No open tickets.</td></tr>}
              {tickets.map(tk => (
                <tr key={tk.id}>
                  <td style={td}>{tk.type === 'photo_request' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--v2-blue)' }}><Camera size={14} strokeWidth={1.6} />Photo</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Wrench size={14} strokeWidth={1.6} />Fault</span>}</td>
                  <td style={{ ...td, color: 'var(--v2-ink-1)' }}>{[tk.screen?.name, tk.depot?.name].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{ ...td, color: 'var(--v2-ink-1)' }}>{tk.issue?.issue_en || (tk.type === 'photo_request' ? 'Live photo' : '—')}</td>
                  <td style={td}>{tk.priority === 'high' ? chip('High', 'var(--v2-tint-warning)', 'var(--warning)') : <span style={{ color: 'var(--v2-ink-2)', fontSize: 13 }}>{tk.priority}</span>}</td>
                  <td style={td}>{(STATUS_CHIP[tk.status] || STATUS_CHIP.open)()}</td>
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
      )}

      {/* ── FIELD TEAM roster ── */}
      {tab === 'field' && (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr>
              <th style={th}>Field tech</th><th style={th}>On duty</th><th style={th}>Km today</th>
              <th style={th}>Last GPS</th><th style={th}>Open tickets</th>
            </tr></thead>
            <tbody>
              {field.length === 0 && <tr><td style={{ ...td, color: 'var(--v2-ink-2)' }} colSpan={5}>No field techs. Create operation_executive users with manager_id set to you.</td></tr>}
              {field.map(f => {
                const dot = f.ageMin <= 5 ? 'var(--v2-green)' : f.ageMin <= 30 ? 'var(--warning)' : 'var(--v2-rose)'
                return (
                  <tr key={f.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{f.name || '—'}</td>
                    <td style={td}>{f.working ? chip('On duty', 'var(--v2-green-soft)', 'var(--v2-green)') : <span style={{ color: 'var(--v2-ink-2)', fontSize: 13 }}>—</span>}</td>
                    <td style={{ ...td, fontFamily: 'var(--v2-display)' }}>{Number(f.km || 0).toFixed(1)} km</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 999, background: dot, display: 'inline-block' }} />
                        <span style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>{fmtAge(f.ageMin)}</span>
                      </span>
                    </td>
                    <td style={{ ...td, color: f.openTickets ? 'var(--v2-rose)' : 'var(--v2-ink-2)', fontWeight: f.openTickets ? 700 : 400 }}>{f.openTickets}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kpi({ n, label, icon: Icon, color }) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} strokeWidth={1.6} style={{ color }} />
        <span style={{ fontFamily: 'var(--v2-display)', fontSize: 28, fontWeight: 800, color }}>{n}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function fmtAge(min) {
  if (!Number.isFinite(min)) return 'no ping today'
  if (min < 1) return 'just now'
  if (min < 60) return `${Math.round(min)} min ago`
  const h = Math.floor(min / 60)
  return `${h}h ${Math.round(min % 60)}m ago`
}
