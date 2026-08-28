// src/pages/v2/OpsCommandV2.jsx — the operation_head COMMAND CENTER (owner
// brainstorm 2026-08-28). The head's landing: network health + a "needs you"
// decision queue + a worst-first per-tech scorecard. Reads the existing
// ops_admin_cockpit RPC (§233, already head-accessible) + a few head-readable
// ops reads — no new SQL. AdFlux brand tokens (§5), Gujarati-first (§231).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw, Monitor, WifiOff, VideoOff, UserX, Clock, ChevronRight, Activity, Tv, LayoutDashboard, CheckSquare, CalendarOff, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { t, getOpsLang, setOpsLang, numL } from '../../utils/opsStrings'
import { isOnHours } from '../../utils/opsHours'

const upTone = (p) => (p == null ? 'muted' : p >= 90 ? 'success' : p >= 75 ? 'warning' : 'danger')
const toneVar = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', muted: 'var(--text-muted)', blue: 'var(--blue, #3B82F6)' }

export default function OpsCommandV2() {
  const nav = useNavigate()
  const { profile } = useAuth()
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [data, setData] = useState(null)
  const onHours = isOnHours()

  const load = useCallback(async () => {
    try {
      const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
      const [ck, scr, dep, ov, ap] = await Promise.all([
        supabase.rpc('ops_admin_cockpit', { p_days: 30 }),
        supabase.from('ops_screens').select('status, camera_active, depot_id').eq('is_active', true),
        supabase.from('ops_depots').select('id, assigned_to').eq('is_active', true),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']).lt('opened_at', cutoff),
        supabase.rpc('ops_pending_approvals'),   // best-effort — empty until the p8 SQL runs
      ])
      if (ck.error) throw ck.error
      const cockpit = ck.data || {}
      const screens = scr.data || []
      const depots = dep.data || []
      const pend = ap.error ? {} : (ap.data || {})
      const camOff = screens.filter(s => s.camera_active === false).length
      // depots with >=1 offline screen and no tech assigned = unassigned faults
      const offByDepot = {}
      screens.forEach(s => { if (s.status === 'offline') offByDepot[s.depot_id] = (offByDepot[s.depot_id] || 0) + 1 })
      const noTech = new Set(depots.filter(d => !d.assigned_to).map(d => d.id))
      const unassigned = Object.keys(offByDepot).filter(id => noTech.has(id)).length
      setData({ cockpit, camOff, unassigned, overdue: ov.count || 0, leaveN: (pend.leaves || []).length, taN: (pend.ta || []).length })
      setErr('')
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [load])

  const health = useMemo(() => {
    const s = data?.cockpit?.screens || {}
    const online = s.online || 0, offline = s.offline || 0
    return {
      uptime: (online + offline) > 0 ? Math.round(online / (online + offline) * 100) : 100,
      total: s.total || 0, offline,
      stations: (data?.cockpit?.worst_stations || []).length,
      camOff: data?.camOff ?? 0,
    }
  }, [data])

  const techs = useMemo(() => {
    const lb = data?.cockpit?.leaderboard || []
    return [...lb].sort((a, b) => (a.uptime_pct ?? 0) - (b.uptime_pct ?? 0))   // worst first
  }, [data])

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div className="lead-root"><div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  const nothingNeeded = data.unassigned === 0 && data.overdue === 0 && !data.leaveN && !data.taN

  return (
    <div className="lead-root">
      <div className="lead-page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="lead-page-eyebrow">{t('ops_field', lang)}</div>
          <h1 className="lead-page-title">{t('command_center', lang)}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={load} aria-label={t('refresh', lang)} className="lead-btn" style={{ padding: '8px 10px' }}><RefreshCw size={16} /></button>
          <button onClick={flip} className="lead-btn" style={{ fontWeight: 700, padding: '8px 12px' }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
        </div>
      </div>

      {/* network health */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10, marginBottom: 18 }}>
        <Tile icon={Activity} n={`${numL(health.uptime, lang)}%`} label={t('network_uptime', lang)} tone={health.uptime >= 90 ? 'success' : health.uptime >= 75 ? 'warning' : 'danger'} />
        <Tile icon={WifiOff} n={numL(health.offline, lang)} label={t('screens_down', lang)} tone={onHours ? 'danger' : 'muted'} sub={`${numL(health.stations, lang)} ${t('across_stations', lang)}`} note={!onHours ? t('all_quiet', lang) : null} />
        <Tile icon={Monitor} n={numL(health.total, lang)} label={t('total_screens', lang)} tone="muted" />
        <Tile icon={VideoOff} n={numL(health.camOff, lang)} label={t('cameras_off', lang)} tone="warning" onClick={() => nav('/ops-down?view=camera')} />
      </div>

      {/* needs you */}
      <div className="lead-section-label" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{t('needs_you', lang)}</div>
      {nothingNeeded ? (
        <div className="lead-card" style={{ textAlign: 'center', padding: '18px 14px', color: 'var(--success)', marginBottom: 18, fontWeight: 600 }}>{t('all_handled', lang)}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {data.unassigned > 0 && (
            <AlertRow icon={UserX} tone="danger" label={t('unassigned_faults', lang)} n={data.unassigned} onClick={() => nav('/ops-tickets?tab=open')} />
          )}
          {data.overdue > 0 && (
            <AlertRow icon={Clock} tone="warning" label={t('overdue_48h', lang)} n={data.overdue} onClick={() => nav('/ops-tickets?tab=proc')} />
          )}
          {data.leaveN > 0 && (
            <AlertRow icon={CalendarOff} tone="blue" label={t('leave_requests', lang)} n={data.leaveN} onClick={() => nav('/ops-approvals')} />
          )}
          {data.taN > 0 && (
            <AlertRow icon={Wallet} tone="blue" label={t('ta_claims', lang)} n={data.taN} onClick={() => nav('/ops-approvals')} />
          )}
        </div>
      )}

      {/* my techs scorecard */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('my_techs', lang)} · {numL(techs.length, lang)}</div>
        <button onClick={() => nav('/ops-dashboard')} style={{ background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{t('live_console', lang)}<ChevronRight size={13} /></button>
      </div>
      {techs.length === 0 ? (
        <div className="lead-card" style={{ textAlign: 'center', padding: '18px 14px', color: 'var(--text-muted)', marginBottom: 18 }}>{t('no_techs_yet', lang)}</div>
      ) : (
        <div className="lead-card" style={{ padding: '4px 0', marginBottom: 18 }}>
          {techs.map((tk, i) => {
            const tone = upTone(tk.uptime_pct)
            const tap = tk.user_id ? () => nav(`/ops-tech/${tk.user_id}`) : undefined
            const El = tap ? 'button' : 'div'
            return (
              <El key={tk.user_id || i} onClick={tap} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderTop: i ? '1px solid var(--border)' : 'none', width: '100%', background: 'none', border: 'none', textAlign: 'left', color: 'inherit', cursor: tap ? 'pointer' : 'default' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: toneVar[tone], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.name || '—'}</span>
                    {tk.on_duty && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: 'var(--success)', flexShrink: 0 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--success)' }} />{t('on_duty', lang)}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{numL(tk.tickets_closed || 0, lang)} {t('fixes_word', lang)}{tk.avg_fix_hours ? ` · ${numL(tk.avg_fix_hours, lang)}h ${t('avg_fix', lang).toLowerCase()}` : ''} · {numL(tk.km || 0, lang)} km</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 18, fontWeight: 700, color: toneVar[tone], lineHeight: 1 }}>{numL(Math.round(tk.uptime_pct || 0), lang)}%</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{t('uptime_word', lang)}</div>
                </div>
                {tap && <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
              </El>
            )
          })}
        </div>
      )}

      {/* quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
        <QuickLink icon={Activity} label={t('down_now', lang)} onClick={() => nav('/ops-down')} />
        <QuickLink icon={CheckSquare} label={t('tickets_title', lang)} onClick={() => nav('/ops-tickets')} />
        <QuickLink icon={Tv} label={t('live_console', lang)} onClick={() => nav('/ops-dashboard')} />
        <QuickLink icon={LayoutDashboard} label={t('station_board', lang)} onClick={() => nav('/ops-station')} />
      </div>
    </div>
  )
}

function Tile({ icon: Icon, n, label, tone = 'muted', sub, note, onClick }) {
  const c = toneVar[tone] || 'var(--text)'
  const El = onClick ? 'button' : 'div'
  return (
    <El onClick={onClick} className="lead-card" style={{ padding: '13px 14px', textAlign: 'left', width: '100%', cursor: onClick ? 'pointer' : 'default', color: 'inherit', display: 'block', minHeight: 84 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', marginBottom: 6 }}><Icon size={15} style={{ color: c }} /><span style={{ fontSize: 12.5 }}>{label}</span></div>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 26, fontWeight: 700, color: c, lineHeight: 1 }}>{n}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
      {note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{note}</div>}
    </El>
  )
}

function AlertRow({ icon: Icon, tone, label, n, onClick }) {
  const c = toneVar[tone]
  const bg = tone === 'danger' ? 'var(--danger-soft)' : tone === 'warning' ? 'var(--warning-soft)' : tone === 'blue' ? 'var(--blue-soft)' : 'var(--surface-2)'
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, background: bg, border: 'none', borderRadius: 12, padding: '12px 14px', width: '100%', cursor: 'pointer', textAlign: 'left', color: 'inherit', minHeight: 48 }}>
      <Icon size={19} style={{ color: c, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 14, color: c }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 16, fontWeight: 700, color: c }}>{n}</span>
      <ChevronRight size={16} style={{ color: c, flexShrink: 0 }} />
    </button>
  )
}

function QuickLink({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="lead-card" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 14px', width: '100%', cursor: 'pointer', color: 'inherit', fontSize: 14, fontWeight: 600 }}>
      <Icon size={16} style={{ color: 'var(--text-muted)' }} /> {label}
    </button>
  )
}
