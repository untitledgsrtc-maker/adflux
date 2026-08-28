// src/pages/v2/OpsAdminV2.jsx
//
// /ops-admin — Operations owner cockpit (Phase 6, §233). The admin's WIDER
// view over the ops network: uptime health + 30-day trend, per-tech
// leaderboard, ticket flow, and (admin only) payroll. Reads ONE gated
// aggregation RPC (ops_admin_cockpit). Team-dashboard theme (lead-* classes).
//
// Everything reads mostly zeros until real uptime + ticket history exist
// (aiadflux Phase 5 / the Head records uptime daily + tickets accumulate) —
// built-and-waiting, like the Head's map is empty until techs check in.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tv, Wifi, WifiOff, Wrench, Camera, Users as UsersIcon, Loader2, RefreshCw, ArrowRight, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { estVariable } from '../../utils/opsPay'

const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700, padding: '9px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.04em' }
const td = { fontSize: 14, color: 'var(--text)', padding: '11px 12px', borderBottom: '1px solid var(--border)' }

function HeroStat({ label, value, delta, up, down }) {
  return (
    <div className="lead-hero-stat">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      <div className={`delta ${up ? 'up' : down ? 'down' : ''}`}>{delta}</div>
    </div>
  )
}

// indicative uptime bonus = utils/opsPay.estVariable (the ONE curve, §71/§258).

function TrendChart({ points }) {
  if (!points || points.length < 2) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 4px' }}>No uptime recorded yet — this fills in as the field team (or the aiadflux sync) reports screen status daily.</div>
  }
  const W = 620, H = 120, pad = 8
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (W - 2 * pad))
  const ys = points.map(p => H - pad - (Math.max(0, Math.min(100, p.pct)) / 100) * (H - 2 * pad))
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120 }} preserveAspectRatio="none">
      {[25, 50, 75, 100].map(g => {
        const y = H - pad - (g / 100) * (H - 2 * pad)
        return <line key={g} x1={pad} y1={y} x2={W - pad} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
      })}
      <path d={`${path} L${xs[xs.length - 1].toFixed(1)},${H - pad} L${xs[0].toFixed(1)},${H - pad} Z`} fill="rgba(16,185,129,.10)" />
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
  const [err, setErr] = useState('')

  async function load() {
    setErr('')
    try {
      const { data: d, error } = await supabase.rpc('ops_admin_cockpit', { p_days: 30 })
      if (error) throw error
      setData(d || {})
    } catch (e) { setErr(e?.message || 'load failed') } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const d = data || {}
  const sc = d.screens || {}
  const tk = d.tickets || {}
  const payroll = d.payroll || null
  const payTotal = useMemo(() => (payroll || []).reduce((s, r) => s + estVariable(r.salary, r.uptime_pct), 0), [payroll])
  const salTotal = useMemo(() => (payroll || []).reduce((s, r) => s + (Number(r.salary) || 0), 0), [payroll])

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Operations · owner view</div>
          <div className="lead-page-title">Operations</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="lead-btn" onClick={load}><RefreshCw size={14} /> Refresh</button>
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/ops-dashboard')}>Live console <ArrowRight size={14} /></button>
        </div>
      </div>

      {err && <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13 }}>{err}</div>}

      {/* hero */}
      <div className="lead-hero-strip" style={{ background: 'radial-gradient(700px 220px at 100% 0%, rgba(192,132,252,.22), transparent 60%), linear-gradient(120deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)', borderColor: '#4338ca' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}><span className="lead-live-dot" />&nbsp;&nbsp;Network health</div>
        </div>
        <div className="lead-hero-stats">
          <HeroStat label="Uptime today"   value={`${d.uptime_today ?? 0}%`}  delta={`${sc.online ?? 0}/${(sc.online ?? 0) + (sc.offline ?? 0)} reporting`} up={(d.uptime_today ?? 0) >= 90} down={(d.uptime_today ?? 0) < 90 && (sc.online ?? 0) + (sc.offline ?? 0) > 0} />
          <HeroStat label="Uptime (month)" value={`${d.uptime_month ?? 0}%`}  delta="avg this month" up={(d.uptime_month ?? 0) >= 90} />
          <HeroStat label="Offline now"    value={sc.offline ?? 0}            delta={`of ${sc.total ?? 0} screens`} down={(sc.offline ?? 0) > 0} />
          <HeroStat label="Not reporting"  value={sc.unknown ?? 0}            delta={(sc.unknown ?? 0) > 0 ? 'live sync off / unmeasured' : 'all screens measured'} down={(sc.unknown ?? 0) > 0} />
          <HeroStat label="Open tickets"   value={tk.open ?? 0}               delta={`${tk.faults_month ?? 0} faults this month`} down={(tk.open ?? 0) > 0} />
        </div>
      </div>

      {/* uptime trend + worst stations */}
      <div className="lead-card" style={{ marginBottom: 14 }}>
        <div className="lead-card-head"><div><div className="lead-card-title">Uptime — last 30 days</div><div className="lead-card-sub">Network-wide daily uptime %.</div></div></div>
        <div style={{ padding: '4px 16px 14px' }}><TrendChart points={d.uptime_trend} /></div>
        {(d.worst_stations || []).length > 0 && (
          <div style={{ padding: '0 16px 14px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Worst stations right now</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(d.worst_stations || []).map(w => (
                <span key={w.name} style={{ background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 600 }}>
                  {w.name} · {w.offline}/{w.screens} down
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ticket flow */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
        <FlowCard icon={Wrench} label="Faults this month" value={tk.faults_month ?? 0} />
        <FlowCard icon={Clock} label="Avg time-to-fix" value={`${tk.avg_fix_hours ?? 0}h`} />
        <FlowCard icon={Camera} label="Photos delivered" value={tk.photo_month ?? 0} />
        <FlowCard icon={Clock} label="Avg photo turnaround" value={`${tk.avg_photo_hours ?? 0}h`} />
      </div>

      {/* team leaderboard */}
      <div className="lead-card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px' }}><div><div className="lead-card-title">Field team</div><div className="lead-card-sub">Who's keeping the network up.</div></div></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead><tr><th style={th}>Tech</th><th style={th}>Uptime held</th><th style={th}>Tickets closed</th><th style={th}>Avg fix</th><th style={th}>Km (month)</th><th style={th}>Attendance</th></tr></thead>
            <tbody>
              {(d.leaderboard || []).length === 0 && <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={6}>No field techs yet.</td></tr>}
              {(d.leaderboard || []).map(r => (
                <tr key={r.name}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                  <td style={{ ...td, color: r.uptime_pct >= 90 ? 'var(--success)' : r.uptime_pct > 0 ? 'var(--warning)' : 'var(--text-muted)', fontWeight: 700 }}>{r.uptime_pct}%</td>
                  <td style={td}>{r.tickets_closed}</td>
                  <td style={td}>{r.avg_fix_hours ? `${r.avg_fix_hours}h` : '—'}</td>
                  <td style={td}>{r.km} km</td>
                  <td style={td}>{r.attendance} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* money (admin only) */}
      {isAdmin && payroll && (
        <div className="lead-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="lead-card-head" style={{ padding: '12px 16px' }}>
            <div><div className="lead-card-title">Payroll — indicative</div><div className="lead-card-sub">Uptime → 70/30 variable. Indicative only; real pay = the Salary sheet (and needs uptime pay turned on).</div></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr><th style={th}>Tech</th><th style={th}>Salary</th><th style={th}>Uptime</th><th style={th}>Variable (est.)</th></tr></thead>
              <tbody>
                {payroll.length === 0 && <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={4}>No field techs yet.</td></tr>}
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
                    <td style={{ ...td, fontWeight: 700 }}>Total</td>
                    <td style={{ ...td, fontWeight: 700, fontFamily: 'var(--font-display)' }}>₹{salTotal.toLocaleString('en-IN')}</td>
                    <td style={td} />
                    <td style={{ ...td, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--success)' }}>₹{payTotal.toLocaleString('en-IN')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function FlowCard({ icon: Icon, label, value }) {
  return (
    <div className="lead-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} style={{ color: 'var(--text-muted)' }} />
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800 }}>{value}</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  )
}
