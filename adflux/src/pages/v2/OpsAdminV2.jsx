// src/pages/v2/OpsAdminV2.jsx
//
// /ops-admin - Operations owner view (rebuilt Oct 2026 to the Adflux Design Rules v1: one teal hero with
// the ONE number, tinted icon tiles, plain words, one yellow action). It answers "Is the network OK?":
//   1. hero  = screens working now
//   2. tiles = jobs open / waiting for a technician / can't fix / month uptime
//   3. needs you now = can't-fix reasons, jobs nobody has, jobs open over 2 days
//   4. stations with problems + technicians
//   5. month report (uptime trend, time-to-fix, admin-only pay estimate) folded away
// Data: ops_admin_cockpit (gated RPC) + a few read-only queries the admin may read directly. Display only.

import { useCallback, useEffect, useMemo, useState } from 'react'
import OpsSectionNav from '../../components/ops/OpsSectionNav'
import { useNavigate } from 'react-router-dom'
import { Tv, Wrench, Camera, Users as UsersIcon, Loader2, RefreshCw, ArrowRight, Clock, AlertTriangle, CheckCircle2, UserX, MonitorOff, BarChart3, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { estVariable } from '../../utils/opsPay'
import { isOnHours } from '../../utils/opsHours'
import UserAvatar from '../../components/common/UserAvatar'

const eyebrow = { fontSize: 12, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }
const th = { textAlign: 'left', ...eyebrow, padding: '9px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { fontSize: 14, color: 'var(--text)', padding: '11px 12px', borderBottom: '1px solid var(--border)' }
const TONES = {
  success: ['var(--success-soft)', 'var(--success)'],
  warning: ['var(--warning-soft)', 'var(--warning)'],
  danger: ['var(--danger-soft)', 'var(--danger)'],
  blue: ['var(--blue-soft)', 'var(--blue)'],
}

function IconTile({ icon: Icon, tone = 'blue', size = 36 }) {
  const [bg, fg] = TONES[tone]
  return (
    <span style={{ width: size, height: size, borderRadius: 10, background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={size > 32 ? 18 : 16} strokeWidth={1.6} />
    </span>
  )
}

function StatTile({ icon, tone, label, value, sub, onClick }) {
  const El = onClick ? 'button' : 'div'
  return (
    <El onClick={onClick} className="lead-card" style={{ padding: 16, textAlign: 'left', cursor: onClick ? 'pointer' : 'default', color: 'inherit', font: 'inherit', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <IconTile icon={icon} tone={tone} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </El>
  )
}

function TrendChart({ points }) {
  if (!points || points.length < 2) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 4px' }}>No uptime recorded yet. This fills in as the screens report each day.</div>
  }
  const W = 620, H = 110, pad = 8
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = points.map(p => H - pad - (Math.max(0, Math.min(100, p.pct)) / 100) * (H - 2 * pad))
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 110 }} preserveAspectRatio="none" role="img" aria-label="Uptime over the last 30 days">
      <path d={`${path} L${xs[xs.length - 1].toFixed(1)},${H - pad} L${xs[0].toFixed(1)},${H - pad} Z`} fill="var(--success-soft)" />
      <path d={path} fill="none" stroke="var(--success)" strokeWidth="2" />
    </svg>
  )
}

export default function OpsAdminV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isAdmin = profile?.role === 'admin'
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [jobs, setJobs] = useState([])        // open + in-process tickets
  const [depots, setDepots] = useState([])    // [{ id, name, assigned_to }]
  const [people, setPeople] = useState({})    // user id -> name
  const [err, setErr] = useState('')
  const [ft, setFt] = useState(null)   // faults today (Phase 505), best-effort
  const [showMonth, setShowMonth] = useState(false)
  const onHours = isOnHours()

  const load = useCallback(async () => {
    setErr('')
    try {
      supabase.rpc('ops_head_fault_report').then(({ data: fr }) => { if (fr && fr.ok) setFt(fr.totals || null) }, () => {})
      const [c, t, d] = await Promise.all([
        supabase.rpc('ops_admin_cockpit', { p_days: 30 }),
        supabase.from('ops_tickets').select('id, status, depot_id, assigned_to, opened_at, cant_fix_reason, type').in('status', ['open', 'in_progress']).limit(1000),
        supabase.from('ops_depots').select('id, name, assigned_to').eq('is_active', true),
      ])
      if (c.error) throw c.error
      setData(c.data || {})
      setJobs(t.data || [])
      setDepots(d.data || [])
      const ids = [...new Set([...(t.data || []).map(x => x.assigned_to), ...(d.data || []).map(x => x.assigned_to)].filter(Boolean))]
      if (ids.length) {
        const u = await supabase.from('users').select('id, name').in('id', ids)
        setPeople(Object.fromEntries((u.data || []).map(x => [x.id, x.name])))
      }
    } catch (e) { setErr(e?.message || 'Could not load.') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const d = data || {}
  const sc = d.screens || {}
  const tk = d.tickets || {}
  const payroll = d.payroll || null
  const payTotal = useMemo(() => (payroll || []).reduce((s, r) => s + estVariable(r.salary, r.uptime_pct), 0), [payroll])
  const salTotal = useMemo(() => (payroll || []).reduce((s, r) => s + (Number(r.salary) || 0), 0), [payroll])

  const depotName = useMemo(() => Object.fromEntries(depots.map(x => [x.id, x.name])), [depots])
  const ownerByDepotName = useMemo(() => Object.fromEntries(depots.map(x => [x.name, people[x.assigned_to] || null])), [depots, people])
  const waiting = jobs.filter(j => j.status === 'open').length
  const inProcess = jobs.filter(j => j.status === 'in_progress').length
  const cantFix = jobs.filter(j => j.cant_fix_reason)
  const nobody = jobs.filter(j => !j.assigned_to)
  const old = jobs.filter(j => j.opened_at && Date.now() - new Date(j.opened_at).getTime() > 48 * 3600e3)

  const needs = [
    ...cantFix.map(j => ({ key: 'c' + j.id, tone: 'danger', icon: Wrench, text: `${depotName[j.depot_id] || 'Station'}: ${people[j.assigned_to] || 'technician'} says can't fix. "${j.cant_fix_reason}"`, to: '/ops-tickets?tab=proc' })),
    ...(nobody.length ? [{ key: 'n', tone: 'warning', icon: UserX, text: `${nobody.length} job${nobody.length > 1 ? 's' : ''} with no technician`, to: '/ops-dashboard' }] : []),
    ...(old.length ? [{ key: 'o', tone: 'warning', icon: Clock, text: `${old.length} job${old.length > 1 ? 's' : ''} open for more than 2 days`, to: '/ops-tickets?tab=proc' }] : []),
  ]

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>

  const up = sc.online ?? 0
  const total = sc.total ?? 0
  const off = sc.offline ?? 0

  return (
    <div className="lead-root">
      <OpsSectionNav />
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Operations · owner view</div>
          <div className="lead-page-title">Is the network OK?</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="lead-btn" onClick={load}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/ops-dashboard')}>Live console <ArrowRight size={14} strokeWidth={1.6} /></button>
        </div>
      </div>

      {err && <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13 }}>{err} <button className="lead-btn" onClick={load} style={{ marginLeft: 8 }}>Retry</button></div>}

      {/* hero - the one number */}
      <div className="lead-hero-strip">
        <div style={{ ...eyebrow, color: 'rgba(255,255,255,.7)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}><span className="lead-live-dot" />Screens working now</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 46, fontWeight: 600, color: 'var(--accent)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{up}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'rgba(255,255,255,.75)' }}>of {total}</span>
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,.8)', marginTop: 8 }}>
          {off > 0
            ? (onHours ? `${off} screen${off > 1 ? 's are' : ' is'} off right now.` : `${off} screens are off. At night this is normal, the timers switch them off.`)
            : 'Every screen is on.'}
          {(sc.unknown ?? 0) > 0 ? ` ${sc.unknown} not reporting.` : ''}
        </div>
      </div>

      {/* four tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 14 }}>
        <StatTile icon={Wrench} tone="warning" label="Jobs open" value={jobs.length} sub={`${waiting} waiting, ${inProcess} in process`} onClick={() => navigate('/ops-tickets')} />
        <StatTile icon={UserX} tone={nobody.length ? 'danger' : 'success'} label="With no technician" value={nobody.length} sub={nobody.length ? 'Give them to someone' : 'Everything has an owner'} onClick={() => navigate('/ops-dashboard')} />
        <StatTile icon={AlertTriangle} tone={cantFix.length ? 'danger' : 'success'} label="Can't fix" value={cantFix.length} sub={cantFix.length ? 'Technician needs your help' : 'None right now'} onClick={() => navigate('/ops-tickets?tab=proc')} />
        {ft && <StatTile icon={Wrench} tone={ft.pending > 0 ? 'warning' : 'success'} label="Faults today" value={ft.went_off} sub={`${ft.fixed} fixed · ${ft.pending} pending`} onClick={() => navigate('/ops-command')} />}
        <StatTile icon={BarChart3} tone="blue" label="Uptime this month" value={`${d.uptime_month ?? 0}%`} sub="average of daily uptime" />
      </div>

      {/* needs you now */}
      <div className="lead-card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden', borderColor: needs.length ? 'var(--danger)' : 'var(--border)' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px' }}>
          <div><div className="lead-card-title">Needs you now</div><div className="lead-card-sub">{needs.length ? `${needs.length} thing${needs.length > 1 ? 's' : ''} waiting for you` : 'Nothing is waiting for you.'}</div></div>
        </div>
        {needs.length === 0 ? (
          <div style={{ padding: '4px 16px 16px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--success)', fontSize: 14, fontWeight: 600 }}><CheckCircle2 size={18} strokeWidth={1.6} /> All handled</div>
        ) : needs.map(n => (
          <button key={n.key} onClick={() => navigate(n.to)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'none', border: 'none', borderTop: '1px solid var(--border)', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', minHeight: 52 }}>
            <IconTile icon={n.icon} tone={n.tone} size={32} />
            <span style={{ flex: 1, fontSize: 14 }}>{n.text}</span>
            <ArrowRight size={16} strokeWidth={1.6} style={{ color: 'var(--text-muted)' }} />
          </button>
        ))}
      </div>

      {/* stations with problems + technicians */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14, alignItems: 'start' }}>
        <div className="lead-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="lead-card-head" style={{ padding: '12px 16px' }}><div><div className="lead-card-title">Stations with problems</div><div className="lead-card-sub">Worst first, and who has each one.</div></div></div>
          {(d.worst_stations || []).length === 0 ? (
            <div style={{ padding: '4px 16px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{onHours ? 'No station has a screen down.' : 'Screens are off for the night.'}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Station</th><th style={th}>Down</th><th style={th}>Who has it</th></tr></thead>
                <tbody>
                  {(d.worst_stations || []).map(w => (
                    <tr key={w.name}>
                      <td style={{ ...td, fontWeight: 600 }}>{w.name}</td>
                      <td style={{ ...td, color: w.offline >= w.screens ? 'var(--danger)' : 'var(--warning)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{w.offline} of {w.screens}</td>
                      <td style={{ ...td, color: ownerByDepotName[w.name] ? 'var(--text)' : 'var(--danger)' }}>{ownerByDepotName[w.name] || 'Nobody'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lead-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="lead-card-head" style={{ padding: '12px 16px' }}><div><div className="lead-card-title">Technicians</div><div className="lead-card-sub">Who is keeping the network up.</div></div></div>
          {(d.leaderboard || []).length === 0 && <div style={{ padding: '4px 16px 16px', color: 'var(--text-muted)', fontSize: 13 }}>No field technicians yet.</div>}
          {(d.leaderboard || []).map(r => {
            const open = jobs.filter(j => j.assigned_to === r.user_id).length
            return (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                <UserAvatar name={r.name} userId={r.user_id} size={38} className="ua-default" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{open} jobs open · {r.tickets_closed} fixed this month · {r.km} km</div>
                </div>
                {r.on_duty != null && <span style={{ background: r.on_duty ? 'var(--success-soft)' : 'var(--surface-3)', color: r.on_duty ? 'var(--success)' : 'var(--text-muted)', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>{r.on_duty ? 'On duty' : 'Off duty'}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* month report, folded away */}
      <button className="lead-card" onClick={() => setShowMonth(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left', marginBottom: showMonth ? 14 : 0, minHeight: 52 }}>
        <IconTile icon={BarChart3} tone="blue" size={32} />
        <span style={{ flex: 1 }}><span style={{ fontWeight: 600, fontSize: 14 }}>Month report</span><span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)' }}>Uptime trend, time to fix{isAdmin ? ', pay estimate' : ''}</span></span>
        <ChevronDown size={18} strokeWidth={1.6} style={{ color: 'var(--text-muted)', transform: showMonth ? 'rotate(180deg)' : 'none' }} />
      </button>

      {showMonth && (
        <>
          <div className="lead-card" style={{ marginBottom: 14 }}>
            <div className="lead-card-head"><div><div className="lead-card-title">Uptime, last 30 days</div><div className="lead-card-sub">Network-wide daily uptime.</div></div></div>
            <div style={{ padding: '4px 16px 14px' }}><TrendChart points={d.uptime_trend} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 14 }}>
            <StatTile icon={Wrench} tone="warning" label="Jobs this month" value={tk.faults_month ?? 0} sub="all jobs opened in 30 days" />
            <StatTile icon={Clock} tone="blue" label="Average time to fix" value={tk.avg_fix_hours ? `${tk.avg_fix_hours}h` : '-'} sub={tk.avg_fix_hours ? 'from open to fixed' : 'nothing fixed in the app yet'} />
            <StatTile icon={Camera} tone="success" label="Photos delivered" value={tk.photo_month ?? 0} sub={tk.avg_photo_hours ? `average ${tk.avg_photo_hours}h` : 'no photo requests done yet'} />
          </div>
          {isAdmin && payroll && (
            <div className="lead-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="lead-card-head" style={{ padding: '12px 16px' }}>
                <div><div className="lead-card-title">Pay estimate</div><div className="lead-card-sub">Uptime decides the 30% variable. Indicative only, the Salary sheet has the real pay.</div></div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead><tr><th style={th}>Technician</th><th style={th}>Salary</th><th style={th}>Uptime</th><th style={th}>Variable (est.)</th></tr></thead>
                  <tbody>
                    {payroll.map(r => (
                      <tr key={r.name}>
                        <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                        <td style={{ ...td, fontFamily: 'var(--font-display)' }}>₹{Number(r.salary || 0).toLocaleString('en-IN')}</td>
                        <td style={td}>{r.uptime_pct}%</td>
                        <td style={{ ...td, fontFamily: 'var(--font-display)', color: 'var(--success)' }}>₹{estVariable(r.salary, r.uptime_pct).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                    {payroll.length > 0 && (
                      <tr>
                        <td style={{ ...td, fontWeight: 600 }}>Total</td>
                        <td style={{ ...td, fontWeight: 600, fontFamily: 'var(--font-display)' }}>₹{salTotal.toLocaleString('en-IN')}</td>
                        <td style={td} />
                        <td style={{ ...td, fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--success)' }}>₹{payTotal.toLocaleString('en-IN')}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
