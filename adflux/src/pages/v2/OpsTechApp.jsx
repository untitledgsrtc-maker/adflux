// src/pages/v2/OpsTechApp.jsx — the field technician's app, built to the owner's Claude Design
// ("Adflux Operations v2"): header + Today / Faults / Me tabs + a full fault page.
// Real data only: ops_depots (assigned to me) / ops_screens / ops_tickets / ops_depot_contacts /
// ops_issue_types / ops_screen_faults / work_sessions / call_logs / ops_my_uptime_pay.
// Renders as a fixed full-screen layer (z-index 100) INSIDE V2AppShell so the shell's background
// GPS + push enrolment stay mounted. All CSS is scoped under .ox (ops2.css).
// Not built on purpose: offline queue, planned visit order by distance, spare parts, GPS arrival
// ("I reached" is saved as a note on the tickets).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { isOnHours } from '../../utils/opsHours'
import { estVariable } from '../../utils/opsPay'
import { dialPhone } from '../../utils/openExternal'
import { normalizeIndianPhone } from '../../utils/phone'
import { captureGps } from '../../utils/captureGps'
import DepotContactsModal from '../../components/ops/DepotContactsModal'
import '../../components/ops2/ops2.css'
import { Ic, Bi, Btn, Pill, Tile, Ring, Hero, StatTile, Card, Seg, Sel, Bar, ScrTile, Sheet, Toast, useToast, Photo, Swipe, LangToggle, G } from '../../components/ops2/ui'

const NIL = '00000000-0000-0000-0000-000000000000'
const ago = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0)
const age = m => m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
const inr = n => 'Rs ' + Math.round(n).toLocaleString('en-IN')
const hhmm = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '')
const dd = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '')
const numSort = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })

const SRC = {
  auto: ['સ્ક્રીન બંધ', 'Screen offline', 'monoff'], cam: ['કેમેરા બંધ', 'Camera off', 'camoff'],
  timer: ['રાત્રે ચાલુ', 'On after 9 PM', 'moon'], photo: ['લાઇવ ફોટો', 'Live photo', 'camera'], manual: ['જાતે નોંધ્યું', 'Logged by tech', 'pencil'],
}
const STAT = { open: ['ખુલ્લું', 'Open', 'da', 'circle'], work: ['કામ ચાલુ', 'In process', 'in', 'loader'], cant: ['ઠીક ન થયું', "Can't fix", 'wa', 'flag'], fixed: ['ઠીક થયું', 'Fixed', 'ok', 'checkc'] }
const ICON_FOR = [[/power|electric|વીજ|પાવર/i, 'zap'], [/bill|બિલ/i, 'rupee'], [/soft|સોફ્ટ/i, 'mon'], [/wir|વાયર/i, 'plug'], [/internet|ethernet|net/i, 'wifi'], [/timer|ટાઈમર/i, 'clock'], [/bird|nest|pigeon|પક્ષી/i, 'feather'], [/switch|સ્વિચ/i, 'toggle'], [/display|damage|blank|તૂટ/i, 'monoff'], [/clean|dust|સફાઈ/i, 'drop']]
const iconOf = (en) => (ICON_FOR.find(([re]) => re.test(en || '')) || [0, 'alert'])[1]
// Which kind of person to call for which problem (same rule as the old station screen).
const CALL_RULES = [[/clean|bird|pigeon|nest|dust/i, /clean|safai|સફાઈ/i], [/bill|internet|ethernet|software|network/i, /depot|ડેપો|office/i], [/./, /electric|ઇલેક્ટ્રિશિયન/i]]
function contactsFor(issueEn, contacts) {
  if (!contacts.length) return []
  for (const [issueRe, roleRe] of CALL_RULES) {
    if (!issueRe.test(issueEn || '')) continue
    const hit = contacts.filter(c => roleRe.test(`${c.role_en || ''} ${c.role_gu || ''}`))
    if (hit.length) return hit
  }
  return contacts.slice(0, 1)
}

export default function OpsTechApp() {
  const { profile } = useAuth()
  const uid = profile?.id
  const nav = useNavigate()
  const [toast, show] = useToast()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [d, setD] = useState({ depots: [], screens: [], tickets: [], contacts: [], issues: [], fixedFaults: [], checkedIn: true, checkInAt: null, pay: null, calls: 0 })
  const [tab, setTab] = useState('today')
  const [openId, setOpenId] = useState(null)
  const [bell, setBell] = useState(false)
  const [ft, setFt] = useState('open')
  const [vp, setVp] = useState('off')
  const [sheet, setSheet] = useState(null)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const onHours = isOnHours()

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const today = istTodayISO()
      const dayStart = `${today}T00:00:00+05:30`
      const monthStart = `${today.slice(0, 8)}01T00:00:00+05:30`
      const dRes = await supabase.from('ops_depots').select('id, name, lat, lng').eq('assigned_to', uid).eq('is_active', true).order('name')
      if (dRes.error) throw dRes.error
      const depots = dRes.data || []
      const ids = depots.length ? depots.map(x => x.id) : [NIL]
      const [sRes, tRes, cRes, iRes, fRes, wRes, payRes, callRes] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status, camera_active, last_response_at, depot_id').in('depot_id', ids).eq('is_active', true),
        supabase.from('ops_tickets').select('id, depot_id, screen_id, type, source, status, cause, notes, created_at, resolved_at, cant_fix_reason, cant_fix_at, issue_type_id, photo_path, fix_photo_path').eq('assigned_to', uid).in('status', ['open', 'in_progress', 'resolved']).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
        supabase.from('ops_depot_contacts').select('id, depot_id, role_en, role_gu, name, phone, display_order').in('depot_id', ids).order('display_order'),
        supabase.from('ops_issue_types').select('id, issue_en, issue_gu, solution_en, solution_gu, display_order').eq('is_active', true).order('display_order'),
        supabase.from('ops_screen_faults').select('id, depot_id, screen_id, kind, status, started_at, fixed_at').in('depot_id', ids).eq('status', 'fixed').gte('fixed_at', dayStart),
        supabase.from('work_sessions').select('id, check_in_at').eq('user_id', uid).eq('work_date', today).maybeSingle(),
        supabase.rpc('ops_my_uptime_pay'),
        supabase.from('call_logs').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('call_at', monthStart),
      ])
      const bad = [sRes, tRes, cRes, iRes].find(r => r.error)
      if (bad) throw bad.error
      setD({
        depots, screens: sRes.data || [], tickets: tRes.data || [], contacts: cRes.data || [], issues: iRes.data || [],
        fixedFaults: fRes.error ? [] : (fRes.data || []),
        checkedIn: !!wRes.data?.check_in_at, checkInAt: wRes.data?.check_in_at || null,
        pay: payRes.error ? null : (Array.isArray(payRes.data) ? payRes.data[0] : payRes.data) || null,
        calls: callRes.count || 0,
      })
      setErr('')
    } catch (e) { setErr(e?.message || 'load failed') } finally { setLoading(false) }
  }, [uid])
  useEffect(() => { load() }, [load])
  useAutoRefresh(load, { userId: uid, enabled: !!uid, pollSeconds: 60 })

  // ───────── derived: stations, faults ─────────
  const stations = useMemo(() => d.depots.map(dep => {
    const scr = d.screens.filter(s => s.depot_id === dep.id).sort(numSort).map((s, i) => ({ ...s, n: i + 1 }))
    return { ...dep, scr, n: scr.length }
  }), [d.depots, d.screens])
  const stById = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s])), [stations])

  const faults = useMemo(() => {
    const out = []
    const inProc = d.tickets.filter(t => t.status === 'in_progress' && t.type !== 'photo_request')
    const procScreens = new Set(inProc.map(t => t.screen_id).filter(Boolean))
    const dayStart = Date.parse(`${istTodayISO()}T00:00:00+05:30`)
    for (const st of stations) {
      const mine = inProc.filter(t => t.depot_id === st.id)
      if (mine.length) {
        const scrIdx = st.scr.filter(s => mine.some(t => t.screen_id === s.id)).map(s => s.n)
        const cant = mine.some(t => t.cant_fix_reason)
        out.push({ id: `${st.id}:work`, st: st.id, scr: scrIdx, scrIds: mine.map(t => t.screen_id), src: 'auto', status: cant ? 'cant' : 'work', age: ago(mine[0].created_at), tickets: mine, cant: mine.find(t => t.cant_fix_reason)?.cant_fix_reason })
      }
      if (onHours) {
        const off = st.scr.filter(s => s.status === 'offline' && !procScreens.has(s.id))
        if (off.length) {
          const oldest = off.map(s => ago(s.last_response_at)).sort((a, b) => b - a)[0]
          out.push({ id: `${st.id}:open`, st: st.id, scr: off.map(s => s.n), scrIds: off.map(s => s.id), src: 'auto', status: 'open', age: oldest || 0, tickets: [] })
        }
        const cam = st.scr.filter(s => s.status === 'online' && s.camera_active === false && !procScreens.has(s.id))
        if (cam.length) out.push({ id: `${st.id}:cam`, st: st.id, scr: cam.map(s => s.n), scrIds: cam.map(s => s.id), src: 'cam', status: 'open', age: 0, tickets: [] })
      } else {
        const on = st.scr.filter(s => s.status === 'online' && !procScreens.has(s.id))
        if (on.length) out.push({ id: `${st.id}:timer`, st: st.id, scr: on.map(s => s.n), scrIds: on.map(s => s.id), src: 'timer', status: 'open', age: 0, tickets: [] })
      }
    }
    for (const t of d.tickets.filter(t => t.type === 'photo_request' && t.status !== 'resolved')) {
      const st = stById[t.depot_id]; if (!st) continue
      const sc = st.scr.find(s => s.id === t.screen_id)
      out.push({ id: `p:${t.id}`, st: st.id, scr: sc ? [sc.n] : [], scrIds: sc ? [sc.id] : [], src: 'photo', status: 'open', age: ago(t.created_at), tickets: [t], note: t.notes || 'Live photo for a client campaign' })
    }
    // fixed today (my tickets resolved today)
    const doneT = d.tickets.filter(t => t.status === 'resolved' && t.resolved_at && Date.parse(t.resolved_at) >= dayStart && t.type !== 'photo_request')
    const byDep = {}
    doneT.forEach(t => { (byDep[t.depot_id] = byDep[t.depot_id] || []).push(t) })
    for (const [did, ts] of Object.entries(byDep)) {
      const st = stById[did]; if (!st) continue
      out.push({ id: `${did}:fixed`, st: did, scr: st.scr.filter(s => ts.some(t => t.screen_id === s.id)).map(s => s.n), scrIds: ts.map(t => t.screen_id), src: 'auto', status: 'fixed', age: ago(ts[0].resolved_at), tickets: ts, by: 'You' })
    }
    return out
  }, [stations, stById, d.tickets, onHours])

  const openFault = openId && faults.find(f => f.id === openId)
  useEffect(() => { if (openId && !openFault && !loading) setOpenId(null) }, [openId, openFault, loading])

  const offN = stations.reduce((a, s) => a + s.scr.filter(x => x.status === 'offline').length, 0)
  const totalScr = stations.reduce((a, s) => a + s.n, 0)
  const doneToday = faults.filter(f => f.status === 'fixed')
  const fixedScreens = new Set(d.fixedFaults.map(f => f.screen_id)).size
  const workN = faults.filter(f => f.status === 'work' || f.status === 'cant').length
  const monthFixed = d.tickets.filter(t => t.status === 'resolved' && t.resolved_at && t.resolved_at >= `${istTodayISO().slice(0, 8)}01` && t.type !== 'photo_request')
  const avgFixM = monthFixed.length ? Math.round(monthFixed.reduce((a, t) => a + Math.max(0, (Date.parse(t.resolved_at) - Date.parse(t.created_at)) / 60000), 0) / monthFixed.length) : 0

  const doCheckIn = async () => {
    try {
      const today = istTodayISO()
      const gps = await captureGps().catch(() => null)
      const { data: ex } = await supabase.from('work_sessions').select('id').eq('user_id', uid).eq('work_date', today).maybeSingle()
      const payload = { check_in_at: new Date().toISOString(), check_in_gps_lat: gps?.lat || null, check_in_gps_lng: gps?.lng || null }
      const { error } = ex
        ? await supabase.from('work_sessions').update(payload).eq('user_id', uid).eq('work_date', today)
        : await supabase.from('work_sessions').insert([{ user_id: uid, work_date: today, ...payload }])
      if (error) throw error
      show({ t: 'હાજરી પૂરી · Checked in' }); load()
    } catch (e) { show({ t: e?.message || 'Check-in failed', icon: 'alert' }) }
  }

  const alerts = useMemo(() => faults.filter(f => f.status !== 'fixed').sort((a, b) => (b.src === 'photo') - (a.src === 'photo') || b.age - a.age), [faults])
  const header = (
    <div className="row" style={{ justifyContent: 'space-between', padding: '8px 16px', minHeight: 56 }}>
      <span className="row" style={{ gap: 10 }}><Btn kind="gh" icon="menu" title="Menu" onClick={() => window.dispatchEvent(new Event('open-shell-drawer'))} /><span className="logo">A</span><Bi g="ઓપરેશન" e={profile?.name || ''} /></span>
      <span className="row" style={{ gap: 6 }}><span className="ltsm"><LangToggle /></span>{!online && <Pill tone="wa" icon="wifioff">નેટ નથી</Pill>}<span style={{ position: 'relative' }}><Btn kind="gh" icon="bell" title="Alerts" onClick={() => setBell(true)} />{alerts.length > 0 && <span className="num" style={{ position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 999, background: 'var(--r, #ef4444)', color: '#fff', fontSize: 12, display: 'grid', placeItems: 'center', padding: '0 4px', pointerEvents: 'none' }}>{alerts.length > 9 ? '9+' : alerts.length}</span>}</span></span>
    </div>)

  let body
  if (loading) body = <div className="mu" style={{ textAlign: 'center', padding: 40 }}><Bi g="લોડ થાય છે…" e="Loading" center /></div>
  else if (err) body = <div className="errrow"><Ic n="alert" /><span style={{ flex: 1 }}>{err}</span><Btn sm onClick={load}>Retry</Btn></div>
  else if (!stations.length) body = <div className="card" style={{ padding: 18, display: 'flex', gap: 12 }}><Tile n="pin" s={40} /><Bi g="તમને હજી કોઈ સ્ટેશન સોંપાયું નથી. હેડને સોંપવા કહો." e="No station is assigned to you yet. Ask the head to assign stations." /></div>
  else if (tab === 'today') {
    const live = faults.filter(f => f.status !== 'fixed')
    const plan = live.filter(f => f.src !== 'photo').sort((a, b) => (b.status === 'open') - (a.status === 'open') || b.scr.length - a.scr.length || b.age - a.age)
    const jobs = live.filter(f => f.src === 'photo')
    const uptime = d.pay?.has_data === false ? null : d.pay?.uptime_pct
    body = <div style={{ display: 'grid', gap: 14 }}>
      {!onHours
        ? <Hero icon="moon" eyebrow="આજનો ચાલુ સમય · Uptime" value={uptime != null ? `${Number(uptime).toFixed(1)}%` : '—'} sub="7 AM – 9 PM · રાત્રે સ્ક્રીન આરામ કરે છે" />
        : <Hero icon="monoff" eyebrow="બંધ સ્ક્રીન · Screens off" value={offN} unit={`/ ${totalScr}`} sub={<><span className="num">{new Set(plan.map(f => f.st)).size}</span> <G t="સ્ટેશન · stations to visit" /></>} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
        <StatTile icon="loader" tone="in" value={workN} label={<Bi g="કામ ચાલુ" e="In process" />} onClick={() => { setFt('work'); setTab('faults') }} />
        <StatTile icon="checkc" tone="ok" value={Math.max(fixedScreens, doneToday.reduce((a, f) => a + f.scr.length, 0))} label={<Bi g="આજે ઠીક" e="Fixed today" />} onClick={() => { setFt('fixed'); setTab('faults') }} />
        <StatTile icon="clock" tone="wa" value={avgFixM ? age(avgFixM) : '—'} label={<Bi g="સરેરાશ સમય" e="Avg fix time" />} />
      </div>
      {onHours && (d.checkedIn
        ? <div className="okrow"><Ic n="checkc" /><Bi g="ફરજ પર" e={<>On duty since <span className="mono">{hhmm(d.checkInAt)}</span></>} /></div>
        : <section className="card" style={{ padding: 14, display: 'grid', gap: 10, borderColor: 'var(--y)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><Bi g="હાજરી પૂરી નથી" e="Not checked in" /></div>
          <Swipe g="હાજરી માટે સ્વાઇપ કરો" e="Swipe to check in" onDone={doCheckIn} />
          <div className="mu sm"><G t="11:30 પછી અડધો દિવસ · After 11:30 it is a half day" /></div></section>)}
      {!onHours && <div className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}><Tile n="moon" s={40} /><Bi g="રાત્રે 9 થી સવારે 7 સ્ક્રીન આરામ કરે છે. રાત્રે કંઈ ગણાતું નથી." e="Screens rest 9 PM to 7 AM. Off at night is normal. Only a screen still on after 9 PM is a timer fault." /></div>}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}><span className="lbl"><G t="આજની મુલાકાત · Visit plan" /></span></div>
      {(() => {
        const offPlan = plan.filter(f => f.src !== 'cam'), camPlan = plan.filter(f => f.src === 'cam'), vpe = (vp === 'off' && offPlan.length === 0 && camPlan.length > 0) ? 'cam' : vp, shown = vpe === 'cam' ? camPlan : offPlan
        return <>
          <Seg full value={vpe} onChange={setVp} opts={[['off', <Bi g="સ્ક્રીન બંધ" e={<><span className="num">{offPlan.length}</span> Screen offline</>} />], ['cam', <Bi g="કૅમેરા બંધ" e={<><span className="num">{camPlan.length}</span> Camera off</>} />]]} />
          {shown.length === 0 && <div className="okrow"><Ic n="checkc" /><Bi g={vpe === 'cam' ? 'બધા કૅમેરા ચાલુ છે' : 'બધા સ્ક્રીન ચાલુ છે'} e={vpe === 'cam' ? 'All cameras are working' : 'All screens are working'} /></div>}
          {shown.map((f, i) => <VisitCard key={f.id} f={f} i={i} st={stById[f.st]} onOpen={() => setOpenId(f.id)} />)}
        </>
      })()}
      {jobs.length > 0 && <span className="lbl" style={{ marginTop: 4 }}><G t="બીજું કામ · Other jobs" /></span>}
      {jobs.map(f => <VisitCard key={f.id} f={f} st={stById[f.st]} onOpen={() => setOpenId(f.id)} />)}
    </div>
  } else if (tab === 'faults') {
    const list = faults.filter(f => ft === 'open' ? ['open', 'cant'].includes(f.status) : ft === 'work' ? f.status === 'work' : f.status === 'fixed')
    const cnt = k => faults.filter(f => k === 'open' ? ['open', 'cant'].includes(f.status) : k === 'work' ? f.status === 'work' : f.status === 'fixed').length
    body = <div style={{ display: 'grid', gap: 14 }}>
      <Seg full value={ft} onChange={setFt} opts={['open', 'work', 'fixed'].map(k => [k, <Bi g={STAT[k][0]} e={<><span className="num">{cnt(k)}</span> {STAT[k][1]}</>} />])} />
      {list.length === 0 && <div className="card" style={{ padding: 18 }}><Bi g="અહીં કંઈ નથી" e="Nothing here" /></div>}
      {list.map(f => <VisitCard key={f.id} f={f} st={stById[f.st]} onOpen={() => setOpenId(f.id)} />)}
      <Btn lg full icon="plus" onClick={() => setSheet({ k: 'log' })}><G t="ચાલુ સ્ક્રીનમાં સમસ્યા · Problem on a working screen" /></Btn>
    </div>
  } else {
    body = <TechMe d={d} avgFixM={avgFixM} monthFixed={monthFixed.length} nav={nav} />
  }

  return (
    <div className="ox"><div className="tech">
      {header}
      {!online && <div className="offb"><Ic n="wifioff" /><Bi g="નેટવર્ક નથી. સેવ થશે નહીં." e="No signal. Changes cannot be saved until signal returns." /></div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>{body}</div>
      <nav className="bnav">{[['today', 'home', 'આજે', 'Today'], ['faults', 'list', 'ફોલ્ટ', 'Faults'], ['me', 'user', 'મારું', 'Me']].map(([k, i, g, e]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setOpenId(null) }} aria-current={tab === k}><Ic n={i} s={22} /><Bi g={g} e={e} center /></button>)}</nav>
      {openFault && <FaultPage key={openFault.id} f={openFault} st={stById[openFault.st]} d={d} uid={uid} onHours={onHours} back={() => setOpenId(null)} reload={load} show={show} setTabFixed={() => { setOpenId(null); setFt('fixed'); setTab('faults') }} />}
      {sheet && sheet.k === 'log' && <LogSheet stations={stations} issues={d.issues} uid={uid} onClose={() => setSheet(null)} onDone={() => { setSheet(null); show({ t: 'નોંધાયું · Fault logged' }); load() }} show={show} />}
      {bell && <Sheet title={<Bi g="એલર્ટ" e="Alerts" />} onClose={() => setBell(false)}>
        <div style={{ display: 'grid', gap: 10 }}>
          {alerts.length === 0 && <div className="okrow"><Ic n="checkc" /><Bi g="કોઈ નવો એલર્ટ નથી" e="Nothing needs you right now" /></div>}
          {alerts.slice(0, 20).map(f => <VisitCard key={f.id} f={f} i={null} st={stById[f.st]} onOpen={() => { setBell(false); setOpenId(f.id) }} />)}
        </div>
      </Sheet>}
      <Toast m={toast} />
    </div></div>
  )
}

function VisitCard({ f, i, st, onOpen }) {
  if (!st) return null
  const job = f.src === 'photo'
  const tone = f.status === 'cant' ? 'wa' : job ? 'in' : f.scr.length >= 3 ? 'da' : 'wa'
  return <button className={'card vcard v-' + tone} onClick={onOpen}>
    {i != null ? <span className="vnum num">{i + 1}</span> : <Tile n={SRC[f.src][2]} tone={tone} s={40} />}
    <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><span style={{ display: 'grid', gap: 2, minWidth: 0 }}><span className="h" style={{ fontSize: 20, fontWeight: 600 }}>{st.name}</span><span className="mu sm"><Bi g={SRC[f.src][0]} e={SRC[f.src][1]} /></span></span>{!job && f.scr.length > 0 && <Pill tone={tone} icon={f.src === 'cam' ? 'camoff' : 'monoff'}><span className="num">{f.scr.length}</span>/<span className="num">{st.n}</span></Pill>}</div>
      {job && <div style={{ fontSize: 16 }}><Bi g={SRC.photo[0]} e={SRC.photo[1]} /> <span className="mu">· {f.note}</span></div>}
      <div className="row mu" style={{ gap: 12, flexWrap: 'wrap', fontSize: 15 }}>{f.age > 0 && <span className="row" style={{ gap: 4 }}><Ic n="clock" s={14} /><span className="num">{age(f.age)}</span></span>}<Pill tone={STAT[f.status][2]} icon={STAT[f.status][3]}><Bi g={STAT[f.status][0]} e={STAT[f.status][1]} /></Pill></div>
    </div></button>
}

function Stepper({ f, called }) {
  const i = { open: called ? 1 : 0, work: 2, cant: 2, fixed: 3 }[f.status]
  const L = [['ખુલ્લું', 'Open'], ['કૉલ', 'Called'], ['કામ', 'Working'], ['ઠીક', 'Fixed']]
  return <div className="stepper">{L.map(([g, e], k) => <div key={k} className={'stp' + (k < i ? ' done' : k === i ? (f.status === 'cant' ? ' cant' : ' cur') : '')}><span className="sc">{k < i ? <Ic n="check" s={14} /> : k === i && f.status === 'cant' ? <Ic n="flag" s={14} /> : k + 1}</span><Bi g={g} e={e} /></div>)}</div>
}

function ReasonGrid({ issues, value, onPick }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{issues.map(it => <button key={it.id} className={'rbtn' + (value === it.id ? ' on' : '')} aria-pressed={value === it.id} onClick={() => onPick(it.id)}><Tile n={iconOf(it.issue_en)} tone={value === it.id ? 'y' : 'n'} s={36} /><Bi g={it.issue_gu || it.issue_en} e={it.issue_en} /></button>)}</div>
}

function CallBtn({ c, onCall }) {
  return <button className="callb" onClick={() => onCall(c)}><span className="calli"><Ic n="phone" s={22} /></span><span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}><span style={{ display: 'block', fontWeight: 600 }}>{c.name || c.role_en}</span><span style={{ display: 'block', fontSize: 15, opacity: .85 }}><Bi g={c.role_gu || c.role_en} e={c.role_en || c.role_gu} /></span></span><span className="mono" style={{ fontSize: 14, opacity: .85 }}>{c.phone}</span></button>
}

async function uploadPhoto(depotId, prefix, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const key = `${depotId}/${prefix}-${Date.now()}.${ext}`
  const up = await supabase.storage.from('ops-photos').upload(key, file, { upsert: false })
  if (up.error) throw up.error
  return key
}

function FaultPage({ f, st, d, uid, onHours, back, reload, show, setTabFixed }) {
  const [sel, setSel] = useState(() => f.scrIds.filter(Boolean))
  const [reason, setReason] = useState(() => f.tickets[0]?.issue_type_id || '')
  const [called, setCalled] = useState(null)
  const [call, setCall] = useState(null)
  const [before, setBefore] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [addNum, setAddNum] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  if (!st) return null
  const issue = d.issues.find(x => x.id === reason)
  const contacts = d.contacts.filter(c => c.depot_id === st.id)
  const callList = reason ? contactsFor(issue?.issue_en, contacts) : []
  const isJob = f.src === 'photo'
  const guard = async (fn) => { if (lock.current || busy) return; lock.current = true; setBusy(true); try { await fn() } catch (e) { show({ t: e?.message || 'Failed', icon: 'alert' }) } finally { lock.current = false; setBusy(false) } }

  const doCall = (c) => {
    const p = normalizeIndianPhone(c.phone).value || c.phone
    if (p) dialPhone(p)
    setCall(c)
  }
  const endCall = async () => {
    const c = call; setCall(null); setCalled(c.name || c.role_en)
    try { await supabase.from('call_logs').insert([{ user_id: uid, client_phone: String(c.phone || '').replace(/[^0-9]/g, '').slice(-10) || null, outcome: 'no_answer', notes: 'Station screen call', ops_ticket_id: f.tickets[0]?.id || null }]); show({ t: 'કૉલ નોંધાયો · Call logged' }) } catch { /* the dial already happened */ }
  }
  const startWork = (withCall) => guard(async () => {
    if (!sel.length || !reason) return
    const { data: dup } = await supabase.from('ops_tickets').select('screen_id').eq('source', 'manual').eq('status', 'in_progress').in('screen_id', sel)
    const taken = new Set((dup || []).map(r => r.screen_id))
    const ids = sel.filter(x => !taken.has(x))
    if (!ids.length) { show({ t: 'આ સ્ક્રીન પહેલેથી ચાલુ છે · Already in process', icon: 'alert' }); return }
    let photo_path = null
    if (before) photo_path = await uploadPhoto(st.id, 'before', before)
    const rows = ids.map(sid => ({ type: 'fault', source: 'manual', status: 'in_progress', depot_id: st.id, screen_id: sid, created_by: uid, assigned_to: uid, issue_type_id: issue.id, cause: issue.issue_en, notes: withCall && called ? `Called ${called}` : null, photo_path }))
    const { error } = await supabase.from('ops_tickets').insert(rows)
    if (error) throw error
    show({ t: 'કામ શરૂ · Work started' }); await reload()
  })
  const reached = () => guard(async () => {
    const hm = hhmm(new Date().toISOString())
    for (const t of f.tickets) await supabase.from('ops_tickets').update({ notes: [t.notes, `Reached station ${hm}`].filter(Boolean).join('\n') }).eq('id', t.id)
    show({ t: 'પહોંચ્યા · Arrival saved' }); await reload()
  })
  const fix = (file) => guard(async () => {
    for (const t of f.tickets) {
      const { error } = await supabase.rpc('ops_ticket_resolve', { p_ticket: t.id })
      if (error) { show({ t: 'સ્ક્રીન હજી બંધ છે · Screens are still offline', icon: 'alert' }); await reload(); return }
      if (file) { try { const key = await uploadPhoto(st.id, 'fix', file); await supabase.from('ops_tickets').update({ fix_photo_path: key }).eq('id', t.id) } catch { /* ticket is closed; photo is extra */ } }
    }
    setSheet(null); show({ t: 'ઠીક થયું · Fixed' }); await reload(); setTabFixed()
  })
  const cant = (why, note) => guard(async () => {
    for (const t of f.tickets) { const { error } = await supabase.rpc('ops_ticket_cant_fix', { p_ticket: t.id, p_reason: [why, note].filter(Boolean).join(': ') }); if (error) throw error }
    setSheet(null); show({ t: 'ઓફિસને મોકલ્યું · Sent to the office' }); await reload()
  })
  const sendPhoto = () => guard(async () => {
    const t = f.tickets[0]; const key = await uploadPhoto(st.id, 'photo', photo)
    const { error } = await supabase.from('ops_tickets').update({ photo_path: key, status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', t.id)
    if (error) throw error
    show({ t: 'ફોટો મોકલ્યો · Photo sent' }); await reload(); setTabFixed()
  })

  const story = []
  if (f.tickets[0]) story.push([dd(f.tickets[0].created_at) + ' ' + hhmm(f.tickets[0].created_at), 'loader', 'કામ શરૂ', 'Started work'])
  f.tickets.forEach(t => String(t.notes || '').split('\n').filter(Boolean).forEach(n => story.push([hhmm(t.created_at), /^Called/i.test(n) ? 'phone' : /^Reached/i.test(n) ? 'navi' : 'pencil', n, n])))
  if (f.tickets.some(t => t.cant_fix_reason)) story.push([dd(f.tickets.find(t => t.cant_fix_reason).cant_fix_at) + ' ' + hhmm(f.tickets.find(t => t.cant_fix_reason).cant_fix_at), 'flag', 'ઠીક ન થયું', "Can't fix: " + f.cant])
  if (f.status === 'fixed') story.push([hhmm(f.tickets[0]?.resolved_at), 'checkc', 'ઠીક થયું', 'Fixed'])

  const screensPick = <section style={{ display: 'grid', gap: 10 }}><span className="lbl"><G t="1 · કઈ સ્ક્રીન? Which screens" /></span>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>{st.scr.map(s => { const faulty = f.scrIds.includes(s.id); return <ScrTile key={s.id} n={s.n} st={!onHours && f.src === 'timer' ? (faulty ? 'tm' : 'rest') : faulty ? 'off' : s.status === 'online' ? 'on' : 'off'} sel={faulty && sel.includes(s.id)} onClick={faulty && f.status === 'open' ? () => setSel(sel.includes(s.id) ? sel.filter(x => x !== s.id) : [...sel, s.id]) : null} /> })}</div>
    <div className="row mu sm" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}><i className="lg t-da"></i><G t="બંધ · Off" /></span><span className="row" style={{ gap: 6 }}><i className="lg t-ok"></i><G t="ચાલુ · On" /></span></div></section>

  return <div className="push">
    <div className="row" style={{ padding: '8px 12px', gap: 8, borderBottom: '1px solid var(--bd)' }}><Btn kind="gh" icon="cl" title="Back" onClick={back} /><div style={{ flex: 1, minWidth: 0 }}><Bi g={st.name} e={`${st.n} screens`} big /></div></div>
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'grid', gap: 18, alignContent: 'start' }}>
      {isJob ? <>
        <Card><div style={{ display: 'grid', gap: 12 }}><span className="row mu sm" style={{ gap: 6 }}><Ic n="camera" s={15} />Live photo</span><div style={{ fontSize: 19, fontWeight: 600 }}>{f.note}</div>{f.scr.length > 0 && <div className="mu"><G t="સ્ક્રીન · Screen " /><span className="num">{f.scr.join(', ')}</span></div>}</div></Card>
        <Photo label={<Bi g="જાહેરાત ચાલુ હોય ત્યારે ફોટો લો" e="Take it while the ad is on screen" />} file={photo} onFile={setPhoto} />
        <Btn kind="pri" lg full icon="send" disabled={!photo || busy} onClick={sendPhoto}><G t="ફોટો મોકલો · Send photo" /></Btn></> : <>
        <Stepper f={f} called={called} />
        {screensPick}
        {f.status === 'open' && <section style={{ display: 'grid', gap: 10 }}><span className="lbl"><G t="2 · શું ખરાબી છે? What is wrong" /></span><ReasonGrid issues={d.issues} value={reason} onPick={setReason} /></section>}
        {issue && f.status === 'open' && issue.solution_en && <div className="okrow"><Ic n="check" /><Bi g={issue.solution_gu || issue.solution_en} e={issue.solution_en} /></div>}
        {f.status === 'open' && <section style={{ display: 'grid', gap: 10 }}><span className="row" style={{ justifyContent: 'space-between' }}><span className="lbl"><G t="3 · કોને કૉલ કરવો · Who to call" /></span><Btn sm icon="plus" onClick={() => setAddNum(true)}><G t="નવો નંબર · Add number" /></Btn></span>{(reason ? callList : contacts).length ? (reason ? callList : contacts).map(c => <CallBtn key={c.id} c={c} onCall={doCall} />) : <div className="warnrow"><Ic n="alert" /><Bi g="આ સ્ટેશનનો કોઈ નંબર નથી" e="No number saved for this station. Add one." /></div>}</section>}
        {addNum && <DepotContactsModal depot={{ id: st.id, name: st.name }} lang={(typeof localStorage !== 'undefined' && localStorage.getItem('ops2_lang')) || 'en'} meId={uid} onClose={() => setAddNum(false)} onChanged={() => reload()} />}
        {f.status === 'open' && <div style={{ display: 'grid', gap: 10 }}>
          <Photo label={<Bi g="પહેલાંનો ફોટો (વૈકલ્પિક)" e="Before photo (optional)" />} file={before} onFile={setBefore} />
          <Btn kind="pri" lg full icon="arrow" disabled={!reason || !sel.length || busy} onClick={() => startWork(true)}><G t="કૉલ થયો, કામ શરૂ · Called, start work" /></Btn>
          {!reason ? <div className="mu" style={{ textAlign: 'center' }}><G t="પહેલાં કારણ પસંદ કરો · Pick what is wrong first" /></div> : !called && <button className="lnk" style={{ justifySelf: 'center' }} onClick={() => startWork(false)}><G t="કૉલ વગર શરૂ કરો · Start without calling" /></button>}</div>}
        {(f.status === 'work' || f.status === 'cant') && <div style={{ display: 'grid', gap: 10 }}>
          {f.tickets.some(t => /Reached station/i.test(t.notes || '')) ? <div className="okrow"><Ic n="navi" /><Bi g="સ્ટેશને પહોંચ્યા" e="Reached station" /></div> : <Btn lg full icon="navi" disabled={busy} onClick={reached}><G t="હું સ્ટેશને પહોંચ્યો · I reached" /></Btn>}
          <div className="mu sm" style={{ textAlign: 'center' }}>{f.scrIds.filter(id => st.scr.find(s => s.id === id)?.status === 'online').length} / {f.scrIds.length} પાછા ચાલુ · back online. 30 મિનિટ ચાલુ રહે તો આપમેળે ઠીક.</div>
          {f.status === 'work' && <Btn kind="pri" lg full icon="camera" onClick={() => setSheet('fix')}><G t="ઠીક થયું – ફોટો લો · Fixed" /></Btn>}
          {callList.length > 0 || contacts.length > 0 ? <Btn lg full icon="phone" onClick={() => contacts[0] && doCall(contacts[0])}><G t="ફરી કૉલ કરો · Call again" /></Btn> : null}
          {f.status === 'work' && <Btn kind="wa" lg full icon="flag" onClick={() => setSheet('cant')}><G t="ઠીક ન થાય – ઓફિસને કહો · Can’t fix" /></Btn>}</div>}
        {f.status === 'cant' && <div className="warnrow"><Ic n="flag" s={22} /><Bi g="ઓફિસને મોકલ્યું" e={f.cant || 'Sent to the office'} /></div>}
        {f.status === 'fixed' && <div className="okrow big"><Ic n="checkc" s={24} /><Bi g="ઠીક થયું" e="Fixed" /></div>}
        {story.length > 0 && <section style={{ display: 'grid', gap: 10 }}><span className="lbl"><G t="ફોલ્ટની વિગત · Fault story" /></span><ol className="story">{story.map(([t, i, g, e], k) => <li key={k}><span className="sdot"><Ic n={i} s={14} /></span><div style={{ minWidth: 0 }}><Bi g={g} e={e} /><div className="mono mu sm">{t}</div></div></li>)}</ol></section>}</>}
    </div>
    {sheet === 'fix' && <FixSheet onClose={() => setSheet(null)} onSave={fix} busy={busy} />}
    {sheet === 'cant' && <CantSheet onClose={() => setSheet(null)} onSave={cant} busy={busy} />}
    {call && <div className="callov" role="dialog"><span className="calli" style={{ width: 88, height: 88 }}><Ic n="phone" s={36} /></span><Bi g="કૉલ થાય છે" e="Calling" center /><div className="h" style={{ fontSize: 28, fontWeight: 600 }}>{call.name || call.role_en}</div><div className="mono mu" style={{ fontSize: 18 }}>+91 {call.phone}</div><div style={{ flex: 1 }}></div><Btn kind="da" lg full icon="x" onClick={endCall}><G t="કૉલ બંધ કરો · End call" /></Btn></div>}
  </div>
}

function FixSheet({ onClose, onSave, busy }) {
  const [p, setP] = useState(null)
  return <Sheet title={<Bi g="ઠીક થયું" e="Fixed" />} onClose={onClose} footer={<Btn kind="pri" lg full icon="check" disabled={!p || busy} onClick={() => onSave(p)}><G t="સાચવો · Save" /></Btn>}>
    <Photo label={<Bi g="પછીનો ફોટો (જરૂરી)" e="After photo (needed)" />} file={p} onFile={setP} /><div className="mu"><G t="હેડ અને માલિક આ ફોટો જોઈ શકે છે · Head and owner can see this photo." /></div></Sheet>
}
function CantSheet({ onClose, onSave, busy }) {
  const [w, setW] = useState(null); const [note, setNote] = useState('')
  const O = [['ઇલેક્ટ્રિશિયન જોઈએ', 'Needs electrician'], ['પાર્ટ જોઈએ', 'Needs a part'], ['ડેપો મંજૂરી નથી આપતું', 'Depot not allowing'], ['બીજું', 'Other']]
  return <Sheet title={<Bi g="ઠીક ન થાય" e="Can’t fix" />} onClose={onClose} footer={<Btn kind="pri" lg full icon="send" disabled={w == null || busy || (w === 3 && note.trim().length < 3)} onClick={() => onSave(O[w][1], note.trim())}><G t="ઓફિસને મોકલો · Send to office" /></Btn>}>
    <div style={{ display: 'grid', gap: 8 }}>{O.map(([g, e], i) => <button key={i} className={'rrow' + (w === i ? ' on' : '')} onClick={() => setW(i)}><Ic n={w === i ? 'checkc' : 'circle'} s={22} /><Bi g={g} e={e} /></button>)}</div>
    <textarea className="inp" rows={3} style={{ height: 'auto', padding: 12 }} placeholder="નોંધ · Note" value={note} onChange={e => setNote(e.target.value)}></textarea>
    <div className="mu sm">The office is told with this reason.</div></Sheet>
}

function LogSheet({ stations, issues, uid, onClose, onDone, show }) {
  const [stId, setStId] = useState(stations[0]?.id || '')
  const [scr, setScr] = useState([]); const [r, setR] = useState(null); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false)
  const s = stations.find(x => x.id === stId)
  const save = async () => {
    if (busy) return; setBusy(true)
    try {
      const it = issues.find(x => x.id === r)
      const { data: dup } = await supabase.from('ops_tickets').select('screen_id').eq('source', 'manual').eq('status', 'in_progress').in('screen_id', scr)
      const taken = new Set((dup || []).map(x => x.screen_id)); const ids = scr.filter(x => !taken.has(x))
      if (!ids.length) { show({ t: 'આ સ્ક્રીન પહેલેથી ચાલુ છે · Already in process', icon: 'alert' }); return }
      const photo_path = file ? await uploadPhoto(stId, 'log', file) : null
      const { error } = await supabase.from('ops_tickets').insert(ids.map(sid => ({ type: 'fault', source: 'manual', status: 'in_progress', depot_id: stId, screen_id: sid, created_by: uid, assigned_to: uid, issue_type_id: it.id, cause: it.issue_en, photo_path })))
      if (error) throw error
      onDone()
    } catch (e) { show({ t: e?.message || 'Failed', icon: 'alert' }) } finally { setBusy(false) }
  }
  return <Sheet title={<Bi g="ચાલુ સ્ક્રીનમાં સમસ્યા" e="Problem on a working screen" />} onClose={onClose} footer={<Btn kind="pri" lg full icon="check" disabled={!scr.length || !r || busy} onClick={save}><G t="સાચવો · Save" /></Btn>}>
    <Sel label="Station" value={stId} onChange={v => { setStId(v); setScr([]) }} opts={stations.map(x => [x.id, x.name])} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>{(s?.scr || []).map(x => <ScrTile key={x.id} n={x.n} st={x.status === 'offline' ? 'off' : 'on'} sel={scr.includes(x.id)} onClick={() => setScr(scr.includes(x.id) ? scr.filter(y => y !== x.id) : [...scr, x.id])} />)}</div>
    <ReasonGrid issues={issues} value={r} onPick={setR} /><Photo label={<Bi g="ફોટો" e="Photo" />} file={file} onFile={setFile} /></Sheet>
}

function TechMe({ d, avgFixM, monthFixed, nav }) {
  const pay = d.pay; const has = pay && pay.has_data !== false && pay.uptime_pct != null
  const u = has ? Number(pay.uptime_pct) : null
  const salary = Number(pay?.salary) || 0
  const base = salary * 0.7; const vmax = salary * 0.3; const v = u != null ? estVariable(salary, u) : 0
  const pos = p => (p - 80) / 20 * 100
  const varFrac = u == null ? 0 : Math.max(0, Math.min(1, (u - 85) / 10))
  return <div style={{ display: 'grid', gap: 14 }}>
    <Hero icon="gauge" eyebrow="ચાલુ સમય · My uptime, this month" value={u != null ? u.toFixed(1) + '%' : '—'} sub="7 AM – 9 PM" right={u != null ? <Ring v={u} s={84} txt={<span className="num">{Math.round(varFrac * 100)}%</span>} lab="pay" /> : null} />
    <Card title={<Bi g="મેં શું કર્યું" e="What I did" />} icon="check" tone="ok" pad={false}><div className="list">{[['ઠીક કર્યા', 'Faults fixed', String(monthFixed)], ['સરેરાશ સમય', 'Avg fix time', avgFixM ? age(avgFixM) : '—'], ['કૉલ', 'Calls', String(d.calls)]].map(([g, e, n]) => <div key={e} className="row" style={{ padding: '12px 16px', justifyContent: 'space-between', minHeight: 56 }}><Bi g={g} e={e} /><span className="num" style={{ fontSize: 22, fontWeight: 600 }}>{n}</span></div>)}</div></Card>
    {salary > 0 && <Card title={<Bi g="મને શું મળશે" e="What I earn" />} icon="rupee" tone="y">
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="mu sm"><G t="ચાલુ સમય 85% થી 95% વચ્ચે વધારાનો પગાર વધે છે · Variable pay grows from 85% to 95% uptime" /></div>
        <div style={{ paddingTop: 6 }}><Bar v={u != null ? pos(u) : 0} tone="ok" h={14} marks={[pos(85), pos(95)]} /></div>
        <div style={{ position: 'relative', height: 40, fontSize: 14 }}><span className="mu" style={{ position: 'absolute', left: `${pos(85)}%`, transform: 'translateX(-50%)', textAlign: 'center' }}><b className="num" style={{ color: 'var(--tx)' }}>85%</b><br />Rs 0</span><span className="mu" style={{ position: 'absolute', left: `${pos(95)}%`, transform: 'translateX(-50%)', textAlign: 'center' }}><b className="num" style={{ color: 'var(--tx)' }}>95%</b><br />{inr(vmax)}</span></div>
        <div className="list">{[['મૂળ પગાર', 'Base pay', base], ['વધારાનો પગાર', 'Variable pay', v]].map(([g, e, n]) => <div key={e} className="row" style={{ padding: '10px 0', justifyContent: 'space-between' }}><Bi g={g} e={e} /><span className="num" style={{ fontSize: 18 }}>{inr(n)}</span></div>)}
          <div className="row" style={{ padding: '12px 0 0', justifyContent: 'space-between' }}><Bi g="અંદાજિત કુલ" e="Estimated total" /><span className="num" style={{ fontSize: 26, fontWeight: 600, color: 'var(--y)' }}>{inr(base + v)}</span></div></div>
      </div></Card>}
    <div className="card list">{[['file', 'પગાર સ્લિપ', 'Salary slips', '/ops-performance'], ['cal', 'રજાની અરજી', 'Leave request', '/my-offer'], ['phone', 'મારા કૉલ', 'My calls', '/calls'], ['brief', 'મારું કામ', 'My work', '/my-work']].map(([i, g, e, to]) => <button key={e} className="rrow" onClick={() => nav(to)}><Tile n={i} s={36} /><span style={{ flex: 1 }}><Bi g={g} e={e} /></span><Ic n="cr" style={{ color: 'var(--mu)' }} /></button>)}</div>
  </div>
}
