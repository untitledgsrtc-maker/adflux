// src/pages/v2/OpsHomeV2.jsx — the ONE operations home for the field tech.
// Owner redesign (2026-08-28): keep it DEAD SIMPLE for low-literacy staff.
//   • the network snapshot stays, but every tile is CLICKABLE → opens that area
//   • the worst-first fault list + the "down > 1 day" band are the action — tap a
//     station → /ops-station?depot=:id (the Station Board: screen wall + who to call
//     + open issues, owner 2026-08-29), NOT a generic list
//   • travel card + station map REMOVED from the home (owner: "not needed")
//   • no location/route button (owner: "remove location navigation")
// Gujarati-first (§231), lead-* tokens. The action area (report / pills /
// my-month) is gated behind having stations so the "no stations" empty state
// stays clean (§253). ui-ux-pro-max: semantic color TOKENS only, Lucide icon
// + label + color on every status tile, tabular-nums, ≥44px touch tiles.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MapPin, ChevronRight, FilePlus, AlertCircle, Wifi } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { isOnHours, faultAgeHours, ageLabel, severityOf } from '../../utils/opsHours'
import { istTodayISO } from '../../utils/istDate'
import OpsEveningCard from '../../components/ops/OpsEveningCard'
import OpsFaultReportCard from '../../components/ops/OpsFaultReportCard'

const NIL = '00000000-0000-0000-0000-000000000000'
const SEV = { 2: 'var(--danger)', 1: 'var(--warning)', 0: 'var(--text-subtle, var(--text-muted))' }

// whole IST calendar-days since a timestamp (0 = today, 1 = yesterday, …). Used to
// measure how long a screen has ACTUALLY been dark from its own last_response_at —
// NOT a ticket's opened_at (a reopened/stale ticket would misreport a fresh outage).
const daysSince = (iso) => Math.round(
  (Date.parse(istTodayISO()) - Date.parse(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))) / 864e5)

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

      const [inProc, fixedTd, fixMo, fixedWk, calls, upRows, ws, openTix] = await Promise.all([
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'in_progress'),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', dayStart),
        supabase.from('ops_tickets').select('created_at, resolved_at').eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', monthStart),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', weekAgo),
        supabase.from('call_logs').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('call_at', monthStart),
        supabase.from('ops_uptime_daily').select('uptime_pct, screens_total').eq('user_id', uid).gte('work_date', monthStart),
        // check_in_at, not just the row: the call counter pre-creates today's row
        // (check_in_at NULL) on the first logged call, so "a row exists" is NOT
        // "checked in" (same rule as OpsWorkV2).
        supabase.from('work_sessions').select('id, check_in_at').eq('user_id', uid).eq('work_date', istTodayISO()).maybeSingle(),
        // everything assigned to me that is still open / in process (all sources,
        // head count only - no rows pulled, so the 1000-row cap cannot undercount).
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).in('status', ['open', 'in_progress']),
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

      // "Down > 1 day" — screens whose OWN last_response_at falls on a PREVIOUS IST
      // calendar day = genuinely dark for a day+. Measured from the screen, NOT an
      // auto-ticket (a reopened/stale ticket from an earlier outage would misreport a
      // screen that only just dropped — the Bhachau "3 days" bug). A night timer-off
      // responded a few hours ago → daysSince 0 → correctly excluded.
      const agedBy = {}
      allScreens.forEach(sc => {
        if (sc.status !== 'offline' || !sc.last_response_at) return
        const d = daysSince(sc.last_response_at)
        if (d < 1) return
        const e = agedBy[sc.depot_id] || (agedBy[sc.depot_id] = { count: 0, days: 0 })
        e.count++; if (d > e.days) e.days = d
      })
      setAged(Object.entries(agedBy).map(([did, e]) => ({
        id: did, did, name: nameOf(did), count: e.count, days: e.days,
      })).sort((a, b) => b.days - a.days || b.count - a.count))

      const fx = fixMo.data || []
      const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
      const up = (upRows.data || []).filter(r => (r.screens_total || 0) > 0)
      setStats({
        inProc: inProc.count || 0, fixedToday: fixedTd.count || 0,
        fixedMo: fx.length, fixedWk: fixedWk.count || 0,
        avgFixH: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
        avgUptime: up.length ? Math.round(up.reduce((a, r) => a + Number(r.uptime_pct || 0), 0) / up.length) : null,
        callsMo: calls.count || 0,
        openTickets: openTix.count || 0,
      })
      // On a read error keep the previous answer (starts true = banner hidden).
      setCheckedIn(prev => (ws.error ? prev : !!(ws.data && ws.data.check_in_at)))
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
  const noDepots = depots.length === 0
  const offNow = net.offline
  // one row per station: worst first; carry how many days it has been dark (from the screens' own last response)
  const agedBy = Object.fromEntries(cityAged.map(a => [a.did, a]))
  const stations = cityFaults.map(r => ({ ...r, days: agedBy[r.did]?.days || 0 }))

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">{t('home_kicker', lang)}</div>
          <div className="lead-page-title">{t('greeting', lang)}{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}</div>
        </div>
        <button className="lead-btn" onClick={flip} style={{ fontWeight: 700 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      {!checkedIn && (
        <button onClick={() => nav('/ops')} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 12, padding: '9px 14px', fontSize: 12.5, cursor: 'pointer', marginBottom: 12, textAlign: 'left' }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} />{t('start_day_ban', lang)}<ChevronRight size={15} style={{ marginLeft: 'auto' }} />
        </button>
      )}

      {noDepots && (
        <div className="lead-card" style={{ padding: '18px 16px', textAlign: 'center', marginBottom: 14 }}>
          <MapPin size={26} style={{ color: 'var(--text-subtle, var(--text-muted))' }} />
          <div style={{ fontWeight: 700, fontSize: 15, marginTop: 8 }}>{t('no_depot', lang)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('no_depot_hint', lang)}</div>
        </div>
      )}

      {!noDepots && (
        <>
          {/* HERO — only three numbers: total down, in process, fixed today */}
          <div style={{ borderRadius: 16, padding: '18px 14px', marginBottom: 14, background: 'linear-gradient(135deg,#0f766e,#134e4a)', color: '#fff', display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
            <HeroNum n={onHours ? offNow : 0} label={lang === 'gu' ? 'કુલ બંધ' : 'Total down'} big onClick={() => nav('/ops-down')} />
            <HeroNum n={s.inProc ?? 0} label={lang === 'gu' ? 'કામ ચાલુ' : 'In process'} onClick={() => nav('/ops-tickets?tab=proc')} />
            <HeroNum n={s.fixedToday ?? 0} label={lang === 'gu' ? 'આજે ઠીક' : 'Fixed today'} onClick={() => nav('/ops-tickets?tab=fixed')} />
          </div>
          {!onHours && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: '-6px 0 12px' }}>{t('all_quiet', lang)}</div>}

          {depots.length > 1 && (
            <select value={cityId} onChange={e => setCityId(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14.5, marginBottom: 14 }}>
              <option value="">{lang === 'gu' ? 'બધા સ્ટેશન' : 'All my stations'}</option>
              {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}

          {/* STATIONS — worst first, one tap opens the fix screen */}
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            {lang === 'gu' ? 'તમારા સ્ટેશન · સૌથી ખરાબ પહેલા' : 'Your stations · worst first'}
          </div>
          {stations.length === 0 ? (
            <div className="lead-card" style={{ padding: '18px 16px', textAlign: 'center', color: 'var(--success)', fontWeight: 600, marginBottom: 14 }}>
              <Wifi size={18} style={{ verticalAlign: -3, marginRight: 6 }} />{lang === 'gu' ? 'બધા સ્ક્રીન ચાલુ છે' : 'All screens are working'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {stations.map(r => {
                const total = screensAll.filter(x => x.depot_id === r.did).length
                const chipTxt = r.days >= 1 ? `${r.days}${lang === 'gu' ? ' દિવસ' : 'd'}` : (onHours ? ageLabel(r.oldest, lang) : t('still_on', lang))
                return (
                  <button key={r.did} onClick={() => nav(`/ops-fix/${r.did}`)} className="lead-card" style={{ padding: '13px', borderLeft: `4px solid ${SEV[r.sev]}`, display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'inherit', minHeight: 56 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.list.length} {lang === 'gu' ? 'માંથી' : 'of'} {total} {t('screens_word', lang)} · {onHours ? (lang === 'gu' ? 'બંધ' : 'down') : t('timer_fault', lang)}</div>
                    </div>
                    <span style={{ background: r.days >= 1 ? 'var(--danger-soft)' : 'var(--warning-soft)', color: r.days >= 1 ? 'var(--danger)' : 'var(--warning)', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{chipTxt}</span>
                    <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  </button>
                )
              })}
            </div>
          )}

          {/* problem on a screen that is still working (blank picture, camera, timer…) */}
          <button onClick={() => nav('/ops-log')} className="lead-btn" style={{ width: '100%', justifyContent: 'center', minHeight: 48, fontSize: 14.5, fontWeight: 700, marginBottom: 14 }}>
            <FilePlus size={16} /> {lang === 'gu' ? 'ચાલુ સ્ક્રીનમાં સમસ્યા? નોંધો' : 'Problem on a working screen? Report it'}
          </button>

          {/* everything else is one tap away, folded so the screen stays calm */}
          <details className="lead-card" style={{ padding: '12px 14px', marginBottom: 14 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14, minHeight: 28 }}>{lang === 'gu' ? 'આજનો રિપોર્ટ અને મારો મહિનો' : "Today's report and my month"}</summary>
            <div style={{ marginTop: 12 }}>
              <OpsFaultReportCard kind="exec" lang={lang} />
              <OpsEveningCard lang={lang} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 10px', textAlign: 'center', marginTop: 8 }}>
                <MiniStat val={s.fixedMo ?? 0} label={t('fixed_this_mo', lang)} />
                <MiniStat val={s.fixedWk ?? 0} label={t('fixed_this_wk', lang)} />
                <MiniStat val={s.avgFixH != null ? `${s.avgFixH}${t('hrs', lang)}` : '—'} label={t('avg_fix', lang)} />
                <MiniStat val={s.avgUptime != null ? `${s.avgUptime}%` : '—'} label={t('avg_uptime', lang)} />
              </div>
              <button onClick={() => nav('/ops-performance')} style={{ marginTop: 12, background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 13, cursor: 'pointer' }}>{t('my_perf', lang)} →</button>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function HeroNum({ n, label, big, onClick }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, font: 'inherit', minHeight: 64 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: big ? 52 : 38, lineHeight: 1, color: big ? 'var(--accent)' : '#fff', fontVariantNumeric: 'tabular-nums' }}>{n}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8, opacity: 0.92 }}>{label}</div>
    </button>
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
