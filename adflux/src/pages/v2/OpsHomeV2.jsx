// src/pages/v2/OpsHomeV2.jsx — the ONE operations home for the field tech
// (owner: "wire one professional dashboard", 2026-08-27). Pulls the scattered
// ops-exec surfaces into a single screen:
//   network snapshot (assigned / online / offline / camera-off + stations /
//   fixed-today / in-process) · pay + uptime hero · live "N of your screens
//   down" strip (→ Down board) · worst-first fault list (F4, → Tickets) · Log a
//   fault (→ Log issue) · In process / Fixed pills (→ Tickets) · my-month mini
//   (fixes / this week / avg-to-fix / avg-uptime / calls) · station map.
// Nav collapses to Home + the personal trio; the detailed pages stay one tap
// behind (routes kept as deep-links). Gujarati-first (§231), lead-* tokens.
// ui-ux-pro-max pass (§251.2, 2026-08-27): semantic color TOKENS only (brand
// yellow via --accent, never a raw hex), Lucide icon + label + color on every
// status tile (color-not-only), tabular-nums numbers, ≥44px touch tiles, and a
// clear empty state when the tech has no assigned stations (the §253 no-data
// root cause) instead of a wall of zeros.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MapPin, ChevronRight, FilePlus, Activity, AlertCircle, Monitor, Wifi, WifiOff, VideoOff, Navigation } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { isOnHours, faultAgeHours, ageLabel, severityOf } from '../../utils/opsHours'
import { istTodayISO } from '../../utils/istDate'
import { depotMapsUrl } from '../../utils/opsMaps'
import { openExternalUrl } from '../../utils/openExternal'
import OpsStationsMap from '../../components/ops/OpsStationsMap'

const NIL = '00000000-0000-0000-0000-000000000000'
const SEV = { 2: 'var(--danger)', 1: 'var(--warning)', 0: 'var(--text-subtle, var(--text-muted))' }

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
  const [faults, setFaults] = useState([])   // [{ did, name, list, oldest, sev }]
  const [net, setNet] = useState({ total: 0, online: 0, offline: 0, cameraOff: null })
  const [stats, setStats] = useState(null)
  const [checkedIn, setCheckedIn] = useState(true)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const nowOn = isOnHours()
      setOnHours(nowOn)
      const dRes = await supabase.from('ops_depots').select('id, name, lat, lng').eq('assigned_to', uid).eq('is_active', true).order('name')
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
      let camKnown = true
      const full = await supabase.from('ops_screens')
        .select('id, name, status, depot_id, last_response_at, camera_active')
        .in('depot_id', inDepots).eq('is_active', true)
      if (full.error && (full.error.code === '42703' || /camera_active/i.test(full.error.message || ''))) {
        camKnown = false
        const red = await supabase.from('ops_screens')
          .select('id, name, status, depot_id, last_response_at')
          .in('depot_id', inDepots).eq('is_active', true)
        if (red.error) throw red.error
        allScreens = red.data || []
      } else if (full.error) { throw full.error }
      else { allScreens = full.data || [] }

      setNet({
        total: allScreens.length,
        online: allScreens.filter(s => s.status === 'online').length,
        offline: allScreens.filter(s => s.status === 'offline').length,
        cameraOff: camKnown ? allScreens.filter(s => s.camera_active === false).length : null,
      })

      const [inProc, fixedTd, fixMo, fixedWk, calls, upRows, taDay, taMo, ws] = await Promise.all([
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'in_progress'),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', dayStart),
        supabase.from('ops_tickets').select('created_at, resolved_at').eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', monthStart),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', weekAgo),
        supabase.from('call_logs').select('call_at').eq('user_id', uid).gte('call_at', monthStart),
        supabase.from('ops_uptime_daily').select('uptime_pct, screens_total').eq('user_id', uid).gte('work_date', monthStart),
        supabase.from('daily_ta').select('bike_amount').eq('user_id', uid).eq('ta_date', istTodayISO()).maybeSingle(),
        supabase.from('daily_ta').select('bike_amount, km_traveled').eq('user_id', uid).gte('ta_date', monthStart),
        supabase.from('work_sessions').select('id').eq('user_id', uid).eq('work_date', istTodayISO()).maybeSingle(),
      ])

      // faults = the screens whose live state ≠ expected (§250 7 AM–9 PM rule),
      // grouped by station, worst-first.
      const faultScreens = allScreens.filter(s => s.status === (nowOn ? 'offline' : 'online'))
      const nameOf = id => myDepots.find(d => d.id === id)?.name || '—'
      const byDepot = {}; faultScreens.forEach(s => { (byDepot[s.depot_id] = byDepot[s.depot_id] || []).push(s) })
      const rows = Object.entries(byDepot).map(([did, list]) => {
        const dd = myDepots.find(d => d.id === did)
        const oldest = nowOn ? Math.max(...list.map(s => faultAgeHours(s.last_response_at))) : 0
        const sev = nowOn ? severityOf(oldest, list.length) : (list.length >= 5 ? 2 : 1)
        return { did, name: nameOf(did), lat: dd?.lat, lng: dd?.lng, list, oldest, sev }
      }).sort((a, b) => b.sev - a.sev || b.oldest - a.oldest)
      setFaults(rows)

      const fx = fixMo.data || []
      const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
      const up = (upRows.data || []).filter(r => (r.screens_total || 0) > 0)
      const taRows = taMo.data || []
      setStats({
        inProc: inProc.count || 0, fixedToday: fixedTd.count || 0,
        fixedMo: fx.length, fixedWk: fixedWk.count || 0,
        avgFixH: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
        avgUptime: up.length ? Math.round(up.reduce((a, r) => a + Number(r.uptime_pct || 0), 0) / up.length) : null,
        callsMo: (calls.data || []).length,
        travelToday: Math.round(Number(taDay.data?.bike_amount || 0)),
        travelMo: Math.round(taRows.reduce((a, r) => a + Number(r.bike_amount || 0), 0)),
        kmMo: Math.round(taRows.reduce((a, r) => a + Number(r.km_traveled || 0), 0)),
      })
      setCheckedIn(!!ws.data)
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [uid])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useAutoRefresh(load, { userId: uid })

  const cityFaults = useMemo(() => cityId ? faults.filter(f => f.did === cityId) : faults, [faults, cityId])
  const screensDown = useMemo(() => cityFaults.reduce((n, f) => n + f.list.length, 0), [cityFaults])
  const downSet = useMemo(() => new Set(faults.map(f => f.did)), [faults])
  const mapStations = useMemo(() => depots.map(d => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng, down: downSet.has(d.id) })), [depots, downSet])

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div className="lead-root"><div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  const s = stats || {}
  const top = cityFaults.slice(0, 4)
  const noDepots = depots.length === 0

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

      {/* network snapshot — the owner's ask: assigned / online / offline / camera-off */}
      {!noDepots && (
        <div className="lead-card" style={{ padding: '15px 15px 13px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{t('my_network', lang)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--success)', boxShadow: '0 0 0 4px var(--success-soft)' }} />{t('live_10min', lang)}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
            <SnapTile icon={Monitor} n={net.total} label={t('total_screens', lang)} tone="neutral" />
            <SnapTile icon={Wifi} n={net.online} label={t('online', lang)} tone="success" />
            <SnapTile icon={WifiOff} n={net.offline} label={t('offline', lang)} tone={onHours ? 'danger' : 'neutral'} onClick={() => nav('/ops-down')} />
            <SnapTile icon={VideoOff} n={net.cameraOff != null ? net.cameraOff : '—'} label={t('camera_off', lang)} tone="warning" />
          </div>
          {/* off-hours: offline is normal (timer, §250) — not an alarm */}
          {!onHours && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>{t('all_quiet', lang)}</div>}
          <div style={{ display: 'flex', marginTop: 13, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <SubStat val={depots.length} label={t('stations_word', lang)} />
            <SubStat val={s.fixedToday ?? 0} label={t('fixed_today_w', lang)} border />
            <SubStat val={s.inProc ?? 0} label={t('in_process', lang)} border />
          </div>
        </div>
      )}

      {/* ₹3/km travel earned — real banked pay the tech controls (→ My Performance) */}
      {!noDepots && (
        <button onClick={() => nav('/ops-performance')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 12, padding: '13px 15px', marginBottom: 14, cursor: 'pointer', textAlign: 'left' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('travel_earned', lang)}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 22, fontWeight: 700, color: 'var(--success)', marginTop: 3 }}>₹{(s.travelMo ?? 0).toLocaleString('en-IN')} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>· {t('calls_month', lang)}</span></div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>₹{(s.travelToday ?? 0).toLocaleString('en-IN')}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{t('calls_today', lang)} · {s.kmMo ?? 0} km</div>
          </div>
        </button>
      )}

      {!noDepots && (
        <>
          {/* live down strip */}
          <button onClick={() => nav('/ops-down')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: screensDown ? 'var(--danger-soft)' : 'var(--success-soft)', border: `1px solid ${screensDown ? 'var(--danger)' : 'var(--success)'}`, borderRadius: 12, padding: '12px 14px', marginBottom: 14, cursor: 'pointer' }}>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>
              {screensDown
                ? <><span style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: 'var(--danger)', fontSize: 18 }}>{screensDown}</span> {t(onHours ? 'screens_word' : 'timer_faults_w', lang)}{onHours ? ` ${t('down_word2', lang)}` : ''} · {cityFaults.length} {t('stations_word', lang)}</>
                : <span style={{ color: 'var(--success)', fontWeight: 600 }}>{t('all_up_short', lang)}</span>}
            </span>
            <span style={{ fontSize: 12, color: 'var(--blue, #3B82F6)', display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}><Activity size={13} /> {t('live_board', lang)} ›</span>
          </button>

          {/* worst-first faults */}
          {top.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('needs_you', lang)}</span>
                {cityFaults.length > top.length && <button onClick={() => nav('/ops-tickets')} style={{ background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 12, cursor: 'pointer' }}>{t('see_all', lang)} {cityFaults.length} ›</button>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                {top.map(r => {
                  const one = r.list.length === 1
                  const typeLabel = onHours ? t('signal_lost', lang) : t('timer_fault', lang)
                  const ageStr = onHours ? ageLabel(r.oldest, lang) : t('still_on', lang)
                  const mapUrl = depotMapsUrl(r)
                  return (
                    <div key={r.did} className="lead-card" style={{ padding: '10px 12px', borderLeft: `4px solid ${SEV[r.sev]}`, display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <button onClick={() => nav('/ops-tickets')} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: '2px 0', color: 'inherit' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{one ? (r.list[0].name || r.name) : r.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{one ? '' : `${r.list.length} ${t('screens_word', lang)} · `}{typeLabel} · {ageStr}</div>
                        </div>
                        <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      </button>
                      {mapUrl && (
                        <button onClick={() => openExternalUrl(mapUrl)} title={t('navigate', lang)} aria-label={t('navigate', lang)} style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 10, border: '1px solid var(--blue, #3B82F6)', background: 'transparent', color: 'var(--blue, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <Navigation size={17} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* log + ticket pills */}
      <button onClick={() => nav('/ops-log')} className="lead-btn lead-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, fontWeight: 700, marginBottom: 10 }}><FilePlus size={16} /> {t('report_fault', lang)}</button>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => nav('/ops-tickets')} className="lead-btn" style={{ flex: 1, justifyContent: 'center' }}>{t('in_process', lang)} · {s.inProc ?? 0}</button>
        <button onClick={() => nav('/ops-tickets')} className="lead-btn" style={{ flex: 1, justifyContent: 'center' }}>{t('fixed_today_w', lang)} · {s.fixedToday ?? 0}</button>
      </div>

      {/* my month */}
      <div className="lead-card" style={{ padding: '13px 14px', marginBottom: mapStations.some(m => m.lat != null) ? 14 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('my_month', lang)}</span>
          <button onClick={() => nav('/ops-performance')} style={{ background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 12, cursor: 'pointer' }}>{t('my_perf', lang)} ›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px 8px', textAlign: 'center' }}>
          <MiniStat val={s.fixedMo ?? 0} label={t('fixed_this_mo', lang)} />
          <MiniStat val={s.fixedWk ?? 0} label={t('fixed_this_wk', lang)} />
          <MiniStat val={s.avgFixH != null ? `${s.avgFixH}${t('hrs', lang)}` : '—'} label={t('avg_fix', lang)} />
          <MiniStat val={s.avgUptime != null ? `${s.avgUptime}%` : '—'} label={t('avg_uptime', lang)} />
          <MiniStat val={s.callsMo ?? 0} label={t('my_calls', lang)} />
        </div>
      </div>

      {/* my stations map (hides itself if no map key or no coords) */}
      {!noDepots && mapStations.some(m => m.lat != null) && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{t('station_map', lang)}</div>
          <OpsStationsMap stations={mapStations} />
        </div>
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
    <El onClick={onClick} style={{ background: T.bg, border: '1px solid var(--border)', borderRadius: 12, padding: '13px 13px 12px', textAlign: 'left', minHeight: 90, width: '100%', display: 'block', cursor: onClick ? 'pointer' : 'default', boxSizing: 'border-box' }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.05)', color: T.ic }}><Icon size={17} /></div>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 30, fontWeight: 700, lineHeight: 1, marginTop: 10, color: T.c }}>{n}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5, fontWeight: 600 }}>{label}</div>
    </El>
  )
}

function SubStat({ val, label, border }) {
  return (
    <div style={{ flex: 1, textAlign: 'center', position: 'relative', borderLeft: border ? '1px solid var(--border)' : 'none' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>{val}</div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle, var(--text-muted))', marginTop: 3 }}>{label}</div>
    </div>
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
