// src/pages/v2/OpsHomeV2.jsx — the ONE operations home for the field tech
// (owner: "wire one professional dashboard", 2026-08-27). Pulls the six
// scattered ops-exec surfaces into a single screen:
//   pay + uptime hero · live "N of your screens down" strip (→ Down board) ·
//   worst-first fault list (F4 triage, → Tickets) · Log a fault (→ Log issue) ·
//   In process / Fixed pills (→ Tickets) · My month mini (→ My Performance).
// Nav collapses to Home + the personal trio; the detailed pages stay one tap
// behind (routes kept as deep-links). Gujarati-first (§231), lead-* tokens.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MapPin, ChevronRight, FilePlus, Activity, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { isOnHours, faultAgeHours, ageLabel, severityOf } from '../../utils/opsHours'
import { istTodayISO } from '../../utils/istDate'
import OpsUptimeCard from '../../components/incentives/OpsUptimeCard'

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
  const [stats, setStats] = useState(null)
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
      const monthStart = istTodayISO().slice(0, 8) + '01'
      const dayStart = istTodayISO() + 'T00:00:00+05:30'

      const [scr, inProc, fixedTd, fixMo, calls, ws] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status, depot_id, last_response_at')
          .in('depot_id', depotIds.length ? depotIds : [NIL]).eq('is_active', true).eq('status', nowOn ? 'offline' : 'online'),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'in_progress'),
        supabase.from('ops_tickets').select('id', { count: 'exact', head: true }).eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', dayStart),
        supabase.from('ops_tickets').select('created_at, resolved_at').eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', monthStart),
        supabase.from('call_logs').select('call_at').eq('user_id', uid).gte('call_at', monthStart),
        supabase.from('work_sessions').select('id').eq('user_id', uid).eq('work_date', istTodayISO()).maybeSingle(),
      ])

      const nameOf = id => myDepots.find(d => d.id === id)?.name || '—'
      const byDepot = {}; (scr.data || []).forEach(s => { (byDepot[s.depot_id] = byDepot[s.depot_id] || []).push(s) })
      const rows = Object.entries(byDepot).map(([did, list]) => {
        const oldest = nowOn ? Math.max(...list.map(s => faultAgeHours(s.last_response_at))) : 0
        const sev = nowOn ? severityOf(oldest, list.length) : (list.length >= 5 ? 2 : 1)
        return { did, name: nameOf(did), list, oldest, sev }
      }).sort((a, b) => b.sev - a.sev || b.oldest - a.oldest)
      setFaults(rows)

      const fx = fixMo.data || []
      const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
      setStats({
        inProc: inProc.count || 0, fixedToday: fixedTd.count || 0,
        fixedMo: fx.length, avgFixH: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
        callsMo: (calls.data || []).length,
      })
      setCheckedIn(!!ws.data)
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [uid])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useAutoRefresh(load, { userId: uid })

  const cityFaults = useMemo(() => cityId ? faults.filter(f => f.did === cityId) : faults, [faults, cityId])
  const screensDown = useMemo(() => cityFaults.reduce((n, f) => n + f.list.length, 0), [cityFaults])

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div className="lead-root"><div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  const s = stats || {}
  const top = cityFaults.slice(0, 4)

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

      {/* pay + uptime — the full professional card (same as My Performance) */}
      <OpsUptimeCard scope="exec" />

      {/* live down strip */}
      <button onClick={() => nav('/ops-down')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: screensDown ? 'var(--danger-soft)' : 'var(--success-soft)', border: `1px solid ${screensDown ? 'var(--danger)' : 'var(--success)'}`, borderRadius: 12, padding: '12px 14px', marginBottom: 14, cursor: 'pointer' }}>
        <span style={{ fontSize: 14, color: 'var(--text)' }}>
          {screensDown
            ? <><span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--danger)', fontSize: 18 }}>{screensDown}</span> {t(onHours ? 'screens_word' : 'timer_faults_w', lang)}{onHours ? ` ${t('down_word2', lang)}` : ''} · {cityFaults.length} {t('stations_word', lang)}</>
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
              return (
                <button key={r.did} onClick={() => nav('/ops-tickets')} className="lead-card" style={{ padding: '12px 13px', borderLeft: `4px solid ${SEV[r.sev]}`, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{one ? (r.list[0].name || r.name) : r.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{one ? '' : `${r.list.length} ${t('screens_word', lang)} · `}{typeLabel} · {ageStr}</div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* log + ticket pills */}
      <button onClick={() => nav('/ops-log')} className="lead-btn lead-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, fontWeight: 700, marginBottom: 10 }}><FilePlus size={16} /> {t('report_fault', lang)}</button>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={() => nav('/ops-tickets')} className="lead-btn" style={{ flex: 1, justifyContent: 'center' }}>{t('in_process', lang)} · {s.inProc ?? 0}</button>
        <button onClick={() => nav('/ops-tickets')} className="lead-btn" style={{ flex: 1, justifyContent: 'center' }}>{t('fixed_today_w', lang)} · {s.fixedToday ?? 0}</button>
      </div>

      {/* my month */}
      <div className="lead-card" style={{ padding: '13px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('my_month', lang)}</span>
          <button onClick={() => nav('/ops-performance')} style={{ background: 'none', border: 'none', color: 'var(--blue, #3B82F6)', fontSize: 12, cursor: 'pointer' }}>{t('my_perf', lang)} ›</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center' }}>
          <MiniStat val={s.fixedMo ?? 0} label={t('fixed_this_mo', lang)} />
          <MiniStat val={s.avgFixH != null ? `${s.avgFixH}${t('hrs', lang)}` : '—'} label={t('avg_fix', lang)} />
          <MiniStat val={s.callsMo ?? 0} label={t('my_calls', lang)} />
        </div>
      </div>
    </div>
  )
}

function MiniStat({ val, label }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 700, color: 'var(--text)' }}>{val}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}
