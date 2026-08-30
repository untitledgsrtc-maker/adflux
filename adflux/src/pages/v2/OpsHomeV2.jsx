// src/pages/v2/OpsHomeV2.jsx — the ONE operations home for the field tech.
// Owner redesign (2026-08-28): keep it DEAD SIMPLE for low-literacy staff.
//   • the network snapshot stays, but every tile is CLICKABLE → opens that area
//   • the worst-first fault list is the action — tap a station → /ops-fix/:id
//     (who to call + which screens off + fix), NOT a generic list
//   • travel card + station map REMOVED from the home (owner: "not needed")
//   • no location/route button (owner: "remove location navigation")
// Gujarati-first (§231), lead-* tokens. The action area (report / pills /
// my-month) is gated behind having stations so the "no stations" empty state
// stays clean (§253). ui-ux-pro-max: semantic color TOKENS only, Lucide icon
// + label + color on every status tile, tabular-nums, ≥44px touch tiles.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MapPin, ChevronRight, FilePlus, Activity, AlertCircle, Monitor, Wifi, WifiOff, VideoOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { isOnHours, faultAgeHours, ageLabel, severityOf } from '../../utils/opsHours'
import { istTodayISO } from '../../utils/istDate'

const NIL = '00000000-0000-0000-0000-000000000000'
const SEV = { 2: 'var(--danger)', 1: 'var(--warning)', 0: 'var(--text-subtle, var(--text-muted))' }

// whole IST calendar-days an auto-ticket has been open — the §259 "more than one
// day" basis (opened on a previous IST calendar day). Query already ensures ≥1.
const daysSince = (iso) => Math.max(1, Math.round(
  (Date.parse(istTodayISO()) - Date.parse(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))) / 864e5))

export default function OpsHomeV2() {
  const { profile } = useAuth()
  const uid = profile?.id
  const nav = useNavigate()
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [onHours, setOnHours] = useState(isOnHours())
  const [cityId, setCityId] = useState('')
  const [depots, setDepots] = useState([])
  const [faults, setFaults] = useState([])       // [{ did, name, list, oldest, sev }]
  const [screensAll, setScreensAll] = useState([])
  const [camKnown, setCamKnown] = useState(true)
  const [stats, setStats] = useState(null)
  const [aged, setAged] = useState([])            // [{ id, did, name, count, days }] — down > 1 day
  const [checkedIn, setCheckedIn] = useState(true)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const nowOn = isOnHours()
      setOnHours(nowOn)
      const dRes = await supabase.from('ops_depots').select('id, name').eq('assigned_to', uid).eq('is_active', true).order('name')
      if (dRes.error) throw dRes.error
      const myDepots = dRes.data || []
      setDepots(myDepots)
      const depotIds = myDepots.map(d => d.id)
      const inDepots = depotIds.length ? depotIds : [NIL]
      const monthStart = istTodayISO().slice(0, 8) + '01'
      const dayStart = istTodayISO() + 'T00:00:00+05:30'
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()

      // ALL active screens in my stations — tolerant of the camera_active column
      // not being added yet (supabase_ops_camera_status.sql): retry without it so
      // the home never 400s before that SQL is run (§45 deploy-order safety).
      let allScreens = []
      let cam = true
      const full = await supabase.from('ops_screens')
        .select('id, name, status, depot_id, last_response_at, camera_active')
        .in('depot_id', inDepots).eq('is_active', true)
      if (full.error && (full.error.code === '42703' || /camera_active/i.test(full.error.message || ''))) {
        cam = false
        const red = await supabase.from('ops_screens')
          .select('id, name, status, depot_id, last_response_at')
          .in('depot_id', inDepots).eq('is_active', true)
        if (red.error) throw red.error
        allScreens = red.data || []
      } else if (full.error) { throw full.error }
      else { allScreens = full.data || [] }

      setScreensAll(allScreens)
      setCamKnown(cam)

      const [inProc, fixedTd, fixMo, fixedWk, calls, upRows, ws] = await Promise.all([
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'in_progress'),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', dayStart),
        supabase.from('ops_tickets').select('created_at, resolved_at').eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', monthStart),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', weekAgo),
        supabase.from('call_logs').select('call_at').eq('user_id', uid).gte('call_at', monthStart),
        supabase.from('ops_uptime_daily').select('uptime_pct, screens_total').eq('user_id', uid).gte('work_date', monthStart),
        supabase.from('work_sessions').select('id').eq('user_id', uid).eq('work_date', istTodayISO()).maybeSingle(),
      ])

      // faults = the screens whose live state ≠ expected (§250 7 AM–9 PM rule),
      // grouped by station, worst-first.
      const faultScreens = allScreens.filter(s => s.status === (nowOn ? 'offline' : 'online'))
      const nameOf = id => myDepots.find(d => d.id === id)?.name || '—'
      const byDepot = {}; faultScreens.forEach(s => { (byDepot[s.depot_id] = byDepot[s.depot_id] || []).push(s) })
      const rows = Object.entries(byDepot).map(([did, list]) => {
        const oldest = nowOn ? Math.max(...list.map(s => faultAgeHours(s.last_response_at))) : 0
        const sev = nowOn ? severityOf(oldest, list.length) : (list.length >= 5 ? 2 : 1)
        return { did, name: nameOf(did), list, oldest, sev }
      }).sort((a, b) => b.sev - a.sev || b.oldest - a.oldest)
      setFaults(rows)

      // "Down > 1 day" — auto_offline tickets opened on a PREVIOUS IST calendar day
      // (§259/§264), still open. Shown even OFF-HOURS: a screen down since yesterday
      // is a genuine multi-day fault, not tonight's timer-off. Oldest first.
      const agedRes = await supabase.from('ops_tickets')
        .select('id, depot_id, down_count, opened_at, depot:ops_depots!ops_tickets_depot_id_fkey(name)')
        .in('depot_id', inDepots).eq('source', 'auto_offline').in('status', ['open', 'in_progress'])
        .lt('opened_at', dayStart).order('opened_at', { ascending: true })
      setAged((agedRes.data || []).map(r => ({
        id: r.id, did: r.depot_id, name: r.depot?.name || nameOf(r.depot_id),
        count: r.down_count || 0, days: daysSince(r.opened_at),
      })))

      const fx = fixMo.data || []
      const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
      const up = (upRows.data || []).filter(r => (r.screens_total || 0) > 0)
      setStats({
        inProc: inProc.count || 0, fixedToday: fixedTd.count || 0,
        fixedMo: fx.length, fixedWk: fixedWk.count || 0,
        avgFixH: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
        avgUptime: up.length ? Math.round(up.reduce((a, r) => a + Number(r.uptime_pct || 0), 0) / up.length) : null,
        callsMo: (calls.data || []).length,
      })
      setCheckedIn(!!ws.data)
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [uid])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useAutoRefresh(load, { userId: uid })

  // the network snapshot follows the city filter too, so the big numbers never
  // disagree with the fault list below (a city-scoped filter that only narrowed
  // the faults used to make the snapshot lie).
  const net = useMemo(() => {
    const sc = cityId ? screensAll.filter(s => s.depot_id === cityId) : screensAll
    return {
      total: sc.length,
      online: sc.filter(s => s.status === 'online').length,
      offline: sc.filter(s => s.status === 'offline').length,
      cameraOff: camKnown ? sc.filter(s => s.camera_active === false).length : null,
    }
  }, [screensAll, camKnown, cityId])

  const cityFaults = useMemo(() => cityId ? faults.filter(f => f.did === cityId) : faults, [faults, cityId])
  const cityAged = useMemo(() => cityId ? aged.filter(a => a.did === cityId) : aged, [aged, cityId])

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div className="lead-root"><div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  const s = stats || {}
  const top = cityFaults.slice(0, 4)
  const noDepots = depots.length === 0
  const stationCount = cityId ? 1 : depots.length
  const downHref = cityId ? `/ops-down?depot=${cityId}` : '/ops-down'   // carry the city filter into the Down-now board
  const camHref = cityId ? `/ops-down?view=camera&depot=${cityId}` : '/ops-down?view=camera'   // camera-off tile → the cameras-off board

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">{t('home_kicker', lang)}</div>
          <div className="lead-page-title">{t('greeting', lang)}{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}</div>
        </div>
        <button className="lead-btn" onClick={flip} style={{ fontWeight: 700 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      {/* check-in nudge */}
      {!checkedIn && (
        <button onClick={() => nav('/ops')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-soft, rgba(255,230,0,.12))', border: '1px solid var(--accent)', color: 'var(--text)', borderRadius: 12, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginBottom: 14, textAlign: 'left' }}>
          <AlertCircle size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />{t('start_day_ban', lang)}<ChevronRight size={16} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }} />
        </button>
      )}

      {/* no stations assigned — the §253 no-data root cause, told plainly */}
      {noDepots && (
        <div className="lead-card" style={{ padding: '18px 16px', textAlign: 'center', marginBottom: 14 }}>
          <MapPin size={26} style={{ color: 'var(--text-subtle, var(--text-muted))' }} />
          <div style={{ fontWeight: 700, fontSize: 15, marginTop: 8 }}>{t('no_depot', lang)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('no_depot_hint', lang)}</div>
        </div>
      )}

      {/* city */}
      {depots.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={13} />{t('city', lang)}</div>
          <select value={cityId} onChange={e => setCityId(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--accent)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }}>
            <option value="">{lang === 'gu' ? 'બધા સ્ટેશન' : 'All my stations'}</option>
            {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}

      {/* network snapshot — every tile taps into the live board */}
      {!noDepots && (
        <div className="lead-card" style={{ padding: '15px 15px 13px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{t('my_network', lang)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--success)', boxShadow: '0 0 0 4px var(--success-soft)' }} />{t('live_10min', lang)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
            <SnapTile icon={Monitor} n={net.total} label={t('total_screens', lang)} tone="neutral" onClick={() => nav(downHref)} />
            <SnapTile icon={Wifi} n={net.online} label={t('online', lang)} tone="success" onClick={() => nav(downHref)} />
            <SnapTile icon={WifiOff} n={net.offline} label={t('offline', lang)} tone={onHours ? 'danger' : 'neutral'} onClick={() => nav(downHref)} />
            <SnapTile icon={VideoOff} n={net.cameraOff != null ? net.cameraOff : '—'} label={t('camera_off', lang)} tone="warning" onClick={() => nav(camHref)} />
          </div>
          {/* off-hours: offline is normal (timer, §250) — not an alarm */}
          {!onHours && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>{t('all_quiet', lang)}</div>}
          <div style={{ display: 'flex', marginTop: 13, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <SubStat val={stationCount} label={t('stations_word', lang)} onClick={() => nav(downHref)} />
            <SubStat val={s.fixedToday ?? 0} label={t('fixed_today_w', lang)} border onClick={() => nav('/ops-tickets?tab=fixed')} />
            <SubStat val={s.inProc ?? 0} label={t('in_process', lang)} border onClick={() => nav('/ops-tickets?tab=proc')} />
          </div>
        </div>
      )}

      {/* Down > 1 day — genuine multi-day faults (auto tickets opened a previous day,
          §259/§264). Shown even off-hours; these are broken, not a night timer-off. */}
      {!noDepots && cityAged.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'inline-flex', alignItems: 'center', gap: 5 }}><AlertCircle size={13} />{lang === 'gu' ? '1 દિવસથી વધુ બંધ' : 'Down over 1 day'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {cityAged.map(r => (
              <button key={r.id} onClick={() => nav(`/ops-fix/${r.did}`)} className="lead-card" style={{ padding: '12px 13px', borderLeft: '4px solid var(--danger)', display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.count} {t('screens_word', lang)} · {lang === 'gu' ? 'બંધ' : 'down'}</div>
                </div>
                <span style={{ background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.days}{lang === 'gu' ? ' દિવસ' : 'd'}</span>
                <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </>
      )}

      {/* worst-first faults — the action. tap a station → who to call + fix */}
      {!noDepots && top.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('needs_you', lang)}</span>
            {cityFaults.length > top.length && <button onClick={() => nav(downHref)} style={{ background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{t('see_all', lang)} {cityFaults.length}<ChevronRight size={13} /></button>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {top.map(r => {
              const one = r.list.length === 1
              const typeLabel = onHours ? t('signal_lost', lang) : t('timer_fault', lang)
              const ageStr = onHours ? ageLabel(r.oldest, lang) : t('still_on', lang)
              return (
                <button key={r.did} onClick={() => nav(`/ops-fix/${r.did}`)} className="lead-card" style={{ padding: '12px 13px', borderLeft: `4px solid ${SEV[r.sev]}`, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{one ? (r.list[0].name || r.name) : r.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{one ? '' : `${r.list.length} ${t('screens_word', lang)} · `}{typeLabel} · {ageStr}</div>
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* action area — hidden when the tech has no stations (keeps the empty state clean) */}
      {!noDepots && (
        <>
          <button onClick={() => nav('/ops-log')} className="lead-btn lead-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, fontWeight: 700, marginBottom: 10 }}><FilePlus size={16} /> {t('report_fault', lang)}</button>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <button onClick={() => nav('/ops-tickets?tab=proc')} className="lead-card" style={{ flex: 1, padding: '15px 12px', textAlign: 'center', cursor: 'pointer', color: 'inherit', display: 'block' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 27, fontWeight: 800, color: 'var(--warning)', lineHeight: 1 }}>{s.inProc ?? 0}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 5, fontWeight: 600 }}>{t('in_process', lang)}</div>
            </button>
            <button onClick={() => nav('/ops-tickets?tab=fixed')} className="lead-card" style={{ flex: 1, padding: '15px 12px', textAlign: 'center', cursor: 'pointer', color: 'inherit', display: 'block' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 27, fontWeight: 800, color: 'var(--success)', lineHeight: 1 }}>{s.fixedToday ?? 0}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 5, fontWeight: 600 }}>{t('fixed_today_w', lang)}</div>
            </button>
          </div>

          {/* my month */}
          <div className="lead-card" style={{ padding: '13px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('my_month', lang)}</span>
              <button onClick={() => nav('/ops-performance')} style={{ background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{t('my_perf', lang)}<ChevronRight size={13} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 10px', textAlign: 'center' }}>
              <MiniStat val={s.fixedMo ?? 0} label={t('fixed_this_mo', lang)} />
              <MiniStat val={s.fixedWk ?? 0} label={t('fixed_this_wk', lang)} />
              <MiniStat val={s.avgFixH != null ? `${s.avgFixH}${t('hrs', lang)}` : '—'} label={t('avg_fix', lang)} />
              <MiniStat val={s.avgUptime != null ? `${s.avgUptime}%` : '—'} label={t('avg_uptime', lang)} />
            </div>
            {/* My calls on its own row — call activity, not a screen-fix stat, so not crammed with the 4 above */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 13, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)', fontWeight: 600 }}>{t('my_calls', lang)}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 23, fontWeight: 800, color: 'var(--text)' }}>{s.callsMo ?? 0}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// A big color-coded network tile — icon + colored number + label (color-not-only).
function SnapTile({ icon: Icon, n, label, tone = 'neutral', onClick }) {
  const T = {
    neutral: { c: 'var(--text)',    bg: 'var(--surface-2)',    ic: 'var(--text-muted)' },
    success: { c: 'var(--success)', bg: 'var(--success-soft)', ic: 'var(--success)' },
    danger:  { c: 'var(--danger)',  bg: 'var(--danger-soft)',  ic: 'var(--danger)' },
    warning: { c: 'var(--warning)', bg: 'var(--warning-soft)', ic: 'var(--warning)' },
  }[tone] || {}
  const El = onClick ? 'button' : 'div'
  return (
    <El onClick={onClick} style={{ background: T.bg, border: '1px solid var(--border)', borderRadius: 12, padding: '13px 13px 12px', textAlign: 'left', minHeight: 90, width: '100%', display: 'block', cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box', color: 'inherit' }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-3)', color: T.ic }}><Icon size={17} /></div>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 30, fontWeight: 700, lineHeight: 1, marginTop: 10, color: T.c }}>{n}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5, fontWeight: 600 }}>{label}</div>
    </El>
  )
}

function SubStat({ val, label, border, onClick }) {
  const El = onClick ? 'button' : 'div'
  return (
    <El onClick={onClick} style={{ flex: 1, textAlign: 'center', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: border ? '1px solid var(--border)' : 'none', background: 'none', cursor: onClick ? 'pointer' : 'default', color: 'inherit', padding: 0, font: 'inherit' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>{val}</div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle, var(--text-muted))', marginTop: 3 }}>{label}</div>
    </El>
  )
}

function MiniStat({ val, label }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{val}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}
