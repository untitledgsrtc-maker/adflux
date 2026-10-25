// src/pages/v2/OpsHeadApp.jsx — the head / owner console, built to the owner's Claude Design
// ("Adflux Operations v2"): header with Network / Faults / Team / Reports tabs + side panels
// (Fault, Station, Screen, Give work). Real data only: ops_depots / ops_screens / ops_tickets /
// ops_screen_faults / ops_depot_contacts / ops_admin_cockpit / ops_head_fault_report /
// ops_pending_approvals / ops_office_lookup + ops_office_assign. Fixed full-screen layer (.ox,
// z-index 100) INSIDE V2AppShell so the shell stays mounted. Pay is shown to the owner (admin) only.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { istTodayISO } from '../../utils/istDate'
import { isOnHours } from '../../utils/opsHours'
import { estVariable } from '../../utils/opsPay'
import { dialPhone } from '../../utils/openExternal'
import { openWhatsAppShare } from '../../utils/whatsappSummary'
import '../../components/ops2/ops2.css'
import { Ic, Btn, Pill, Tile, Ring, Hero, StatTile, Card, Seg, Sel, Bar, ScrTile, Sheet, Toast, useToast, Av, LangToggle } from '../../components/ops2/ui'

const NIL = '00000000-0000-0000-0000-000000000000'
const ago = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0)
const age = m => m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
const inr = n => 'Rs ' + Math.round(n).toLocaleString('en-IN')
const hhmm = iso => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '')
const dd = iso => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '')
const numSort = (a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
const first = n => (n || '').split(/\s+/)[0] || ''
const sp = n => ({ gridColumn: `span ${n}`, minWidth: 0 })

const SRC = {
  auto: ['Screen offline', 'monoff'], cam: ['Camera off', 'camoff'], timer: ['On after 9 PM', 'moon'],
  photo: ['Live photo', 'camera'], manual: ['Logged by tech', 'pencil'],
}
const STAT = { open: ['Open', 'da', 'circle'], work: ['In process', 'in', 'loader'], cant: ["Can't fix", 'wa', 'flag'], fixed: ['Fixed', 'ok', 'checkc'] }
const StatPill = ({ s }) => <Pill tone={STAT[s][1]} icon={STAT[s][2]}>{STAT[s][0]}</Pill>
const SrcTag = ({ s }) => <span className="row mu sm" style={{ gap: 6 }}><Ic n={SRC[s][1]} s={16} />{SRC[s][0]}</span>

export default function OpsHeadApp() {
  const { profile } = useAuth()
  const uid = profile?.id
  const owner = profile?.role === 'admin' || profile?.role === 'co_owner'
  const isAdmin = profile?.role === 'admin'
  const nav = useNavigate()
  const [toast, show] = useToast()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [d, setD] = useState({ depots: [], screens: [], tickets: [], names: {}, phones: {}, cockpit: {}, fr: null, appr: { leaves: [], ta: [] }, issues: {} })
  const [tab, setTab] = useState('network')
  const [panel, setPanel] = useState(null)
  const onHours = isOnHours()

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const today = istTodayISO()
      const dayStart = `${today}T00:00:00+05:30`
      const [dRes, sRes, tRes, cRes, frRes, apRes, iRes] = await Promise.all([
        supabase.from('ops_depots').select('id, name, assigned_to, lat, lng').eq('is_active', true).order('name'),
        supabase.from('ops_screens').select('id, name, status, camera_active, last_response_at, depot_id').eq('is_active', true),
        supabase.from('ops_tickets').select('id, depot_id, screen_id, type, source, status, cause, notes, created_at, resolved_at, assigned_to, cant_fix_reason, issue_type_id').in('status', ['open', 'in_progress', 'resolved']).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(1000),
        supabase.rpc('ops_admin_cockpit', { p_days: 30 }),
        supabase.rpc('ops_head_fault_report'),
        supabase.rpc('ops_pending_approvals'),
        supabase.from('ops_issue_types').select('id, issue_en'),
      ])
      if (dRes.error) throw dRes.error
      if (sRes.error) throw sRes.error
      if (tRes.error) throw tRes.error
      const depots = dRes.data || []
      const ids = [...new Set(depots.map(x => x.assigned_to).filter(Boolean))]
      const uRes = ids.length ? await supabase.from('users').select('id, name, whatsapp_number').in('id', ids) : { data: [] }
      const names = {}, phones = {}
      ;(uRes.data || []).forEach(u => { names[u.id] = u.name; phones[u.id] = u.whatsapp_number })
      setD({
        depots, screens: sRes.data || [], tickets: tRes.data || [], names, phones,
        cockpit: cRes.error ? {} : (cRes.data || {}),
        fr: frRes.error || !frRes.data?.ok ? null : frRes.data,
        appr: apRes.error ? { leaves: [], ta: [] } : { leaves: apRes.data?.leaves || [], ta: apRes.data?.ta || [] },
        issues: Object.fromEntries((iRes.data || []).map(i => [i.id, i.issue_en])),
      })
      setErr('')
      void dayStart
    } catch (e) { setErr(e?.message || 'load failed') } finally { setLoading(false) }
  }, [uid])
  useEffect(() => { load() }, [load])
  useAutoRefresh(load, { userId: uid, enabled: !!uid, pollSeconds: 60 })

  // ───────── derived ─────────
  const stations = useMemo(() => d.depots.map(dep => {
    const scr = d.screens.filter(s => s.depot_id === dep.id).sort(numSort).map((s, i) => ({ ...s, n: i + 1 }))
    return { ...dep, scr, n: scr.length, off: scr.filter(s => s.status === 'offline').map(s => s.n) }
  }), [d.depots, d.screens])
  const stById = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s])), [stations])

  const faults = useMemo(() => {
    const out = []
    const dayStart = Date.parse(`${istTodayISO()}T00:00:00+05:30`)
    const inProc = d.tickets.filter(t => t.status === 'in_progress' && t.type !== 'photo_request')
    const procScreens = new Set(inProc.map(t => t.screen_id).filter(Boolean))
    for (const st of stations) {
      const tech = st.assigned_to
      const mine = inProc.filter(t => t.depot_id === st.id)
      if (mine.length) {
        const cantT = mine.find(t => t.cant_fix_reason)
        out.push({ id: `${st.id}:work`, st: st.id, tech, scr: st.scr.filter(s => mine.some(t => t.screen_id === s.id)).map(s => s.n), src: 'auto', status: cantT ? 'cant' : 'work', age: ago(mine[0].created_at), tickets: mine, cant: cantT?.cant_fix_reason, esc: cantT ? cantT.cant_fix_reason : null, escT: 'wa' })
      }
      if (onHours) {
        const off = st.scr.filter(s => s.status === 'offline' && !procScreens.has(s.id))
        if (off.length) {
          const oldest = off.map(s => ago(s.last_response_at)).sort((a, b) => b - a)[0] || 0
          const noTech = !tech
          out.push({ id: `${st.id}:open`, st: st.id, tech, scr: off.map(s => s.n), src: 'auto', status: 'open', age: oldest, tickets: [], esc: noTech ? 'No technician on this station' : oldest >= 120 ? `Not started for ${age(oldest)}` : null, escT: 'da' })
        }
        const cam = st.scr.filter(s => s.status === 'online' && s.camera_active === false && !procScreens.has(s.id))
        if (cam.length) out.push({ id: `${st.id}:cam`, st: st.id, tech, scr: cam.map(s => s.n), src: 'cam', status: 'open', age: 0, tickets: [] })
      } else {
        const on = st.scr.filter(s => s.status === 'online' && !procScreens.has(s.id))
        if (on.length) out.push({ id: `${st.id}:timer`, st: st.id, tech, scr: on.map(s => s.n), src: 'timer', status: 'open', age: 0, tickets: [], esc: 'Timer fault: still on after 9 PM', escT: 'wa' })
      }
    }
    for (const t of d.tickets.filter(t => t.type === 'photo_request' && t.status !== 'resolved')) {
      const st = stById[t.depot_id]; if (!st) continue
      const sc = st.scr.find(s => s.id === t.screen_id)
      out.push({ id: `p:${t.id}`, st: st.id, tech: t.assigned_to || st.assigned_to, scr: sc ? [sc.n] : [], src: 'photo', status: 'open', age: ago(t.created_at), tickets: [t], note: t.notes || 'Live photo for a client campaign' })
    }
    const doneT = d.tickets.filter(t => t.status === 'resolved' && t.resolved_at && Date.parse(t.resolved_at) >= dayStart && t.type !== 'photo_request')
    const byDep = {}
    doneT.forEach(t => { (byDep[t.depot_id] = byDep[t.depot_id] || []).push(t) })
    for (const [did, ts] of Object.entries(byDep)) {
      const st = stById[did]; if (!st) continue
      out.push({ id: `${did}:fixed`, st: did, tech: ts[0].assigned_to || st.assigned_to, scr: st.scr.filter(s => ts.some(t => t.screen_id === s.id)).map(s => s.n), src: 'auto', status: 'fixed', age: ago(ts[0].resolved_at), tickets: ts, by: d.names[ts[0].assigned_to] || 'Technician' })
    }
    return out.map(f => ({ ...f, stName: stById[f.st]?.name || 'Station' }))
  }, [stations, stById, d.tickets, d.names, onHours])

  const techList = useMemo(() => Object.entries(d.names).map(([id, n]) => ({ id, n })), [d.names])
  const cp = d.cockpit || {}
  const sc = cp.screens || {}
  const totalScr = stations.reduce((a, s) => a + s.n, 0)
  const offN = stations.reduce((a, s) => a + s.scr.filter(x => x.status === 'offline').length, 0)
  const live = faults.filter(f => f.status !== 'fixed')
  const needs = live.filter(f => f.esc)
  const apprN = d.appr.leaves.length + d.appr.ta.length
  const techName = id => d.names[id] || 'No technician'

  const openF = f => setPanel({ k: 'f', f })
  const openS = s => setPanel({ k: 's', s })
  const openScr = (s, n) => setPanel({ k: 'scr', s, n })

  if (loading) return <div className="ox ox-head"><div className="head"><div className="mu" style={{ padding: 48, textAlign: 'center' }}>Loading...</div></div></div>

  const T = [['network', 'Network', 'gauge'], ['faults', 'Faults', 'list'], ['team', 'Team', 'users'], ['reports', 'Reports', 'chart']]
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="ox ox-head" style={{ overflowY: 'auto' }}>
      <div className="head">
        <header className="row" style={{ padding: '0 28px', height: 68, borderBottom: '1px solid var(--bd)', gap: 24, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 10, fontWeight: 600, fontSize: 17 }}><span className="logo">A</span>Operations</span>
          <nav className="row" style={{ gap: 4, height: '100%' }} role="tablist">{T.map(([k, l, i]) => <button key={k} role="tab" aria-selected={tab === k} className={'htab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}><Ic n={i} />{l}{k === 'faults' && live.length > 0 && <span className="tabn num">{live.length}</span>}</button>)}</nav>
          <div style={{ flex: 1 }} />
          <span className="mono mu sm">{now}</span>
          <LangToggle /><div style={{ width: 150 }}><Sel label="My pages" value="" onChange={v => v && nav(v)} opts={[['', 'More'], ...(owner ? [['/dashboard', 'Dashboard']] : []), ['/ops-assign', 'Give work page'], ['/ops-log', 'Log issue'], ['/ops-tickets', 'Tickets'], ['/ops-performance', 'My Performance'], ['/calls', 'My Calls'], ['/my-offer', 'My Offer'], ['/my-work', 'My Work'], ['/work-profile', 'My profile']]} /></div>
          <Btn kind="pri" icon="plus" onClick={() => setPanel({ k: 'give' })}>Give work</Btn>
          <span className="row" style={{ gap: 10 }}><Av name={profile?.name} userId={uid} /><span><span style={{ display: 'block', fontWeight: 500 }}>{first(profile?.name)}</span><span className="mu sm">{owner ? 'Owner' : 'Operation head'}</span></span></span>
        </header>
        <main style={{ padding: 28 }}>
          {err && <div className="errrow" style={{ marginBottom: 16 }}><Ic n="alert" /><span style={{ flex: 1 }}>{err}</span><Btn sm onClick={load}>Retry</Btn></div>}
          {tab === 'network' && <Network {...{ faults, live, needs, stations, openF, openS, go: setTab, onHours, offN, totalScr, cp, sc, d, apprN, techName }} />}
          {tab === 'faults' && <Faults {...{ faults, openF, techList, techName }} />}
          {tab === 'team' && <Team {...{ cp, d, stations, live, isAdmin, show, load }} />}
          {tab === 'reports' && <Reports {...{ d, cp, stations, isAdmin, onHours, totalScr, offN, show }} />}
        </main>
        {panel?.k === 'f' && <FaultPanel f={panel.f} stations={stById} d={d} techList={techList} techName={techName} onClose={() => setPanel(null)} openScr={openScr} show={show} reload={load} />}
        {panel?.k === 's' && <StationPanel s={panel.s} onClose={() => setPanel(null)} openScr={openScr} techName={techName} onHours={onHours} />}
        {panel?.k === 'scr' && <ScreenPanel s={panel.s} n={panel.n} onClose={() => setPanel(null)} />}
        {panel?.k === 'give' && <GiveWork onClose={() => setPanel(null)} show={show} reload={load} />}
        <Toast m={toast} />
      </div>
    </div>
  )
}

function Network({ faults, live, needs, stations, openF, openS, go, onHours, offN, totalScr, cp, sc, d, apprN, techName }) {
  const upToday = sc.total ? Math.round(((sc.online || 0) / Math.max(1, (sc.online || 0) + (sc.offline || 0))) * 1000) / 10 : 0
  const upMonth = Number(cp.uptime_month || 0)
  const fixedN = faults.filter(f => f.status === 'fixed').length
  const stOff = stations.filter(s => s.off.length).length
  const list = [...stations].sort((a, b) => b.off.length - a.off.length || (a.name || '').localeCompare(b.name || ''))
  const rows = [
    ...needs.map(f => [f.escT || 'da', f.status === 'cant' ? 'flag' : f.src === 'timer' ? 'moon' : 'clock', f.status === 'cant' ? "Can't fix" : f.src === 'timer' ? 'Timer fault' : 'Not started', `${f.stName || (stations.find(s => s.id === f.st)?.name || 'Station')} · ${f.scr.length} screen${f.scr.length === 1 ? '' : 's'}`, f.esc, f, null]),
  ]
  if (d.appr.leaves.length) rows.push(['in', 'cal', 'Leave', `${d.appr.leaves.length} leave request${d.appr.leaves.length > 1 ? 's' : ''} waiting`, d.appr.leaves.map(l => l.name).slice(0, 3).join(', '), null, 'team'])
  if (d.appr.ta.length) rows.push(['in', 'route', 'TA claim', `${d.appr.ta.length} TA claim${d.appr.ta.length > 1 ? 's' : ''} waiting`, d.appr.ta.map(l => l.name).slice(0, 3).join(', '), null, 'team'])
  const lb = cp.leaderboard || []
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {onHours
        ? <Hero icon="monoff" eyebrow="Screens off now" value={offN} unit={`of ${totalScr}`} sub={`In ${stOff} station${stOff === 1 ? '' : 's'} · ${needs.length} need you`} right={<Ring v={upToday} s={96} lab="uptime today" />} />
        : <Hero icon="moon" eyebrow="Network uptime this month" value={`${upMonth}%`} sub="Counted 7 AM to 9 PM · screens rest until 7 AM" />}
      <div className="hgrid">
        <div style={sp(3)}><StatTile icon="loader" tone="in" label="In process" value={faults.filter(f => f.status === 'work').length} sub="Technician started work" /></div>
        <div style={sp(3)}><StatTile icon="checkc" tone="ok" label="Fixed today" value={fixedN} sub="Marked fixed by technicians" /></div>
        <div style={sp(3)}><StatTile icon="clock" tone="wa" label="Avg screen fix time" value={cp.tickets?.avg_fix_hours ? `${cp.tickets.avg_fix_hours}h` : '–'} sub="This month, per fault" /></div>
        <div style={sp(3)}><StatTile icon="warn" tone="da" label="Still open" value={live.filter(f => f.status === 'open' || f.status === 'cant').length} sub={`${stOff} station${stOff === 1 ? '' : 's'}`} onClick={() => go('faults')} /></div>
        <div style={sp(7)}>
          <Card title="Needs you" icon="alert" tone="da" sub={<span className="num">{rows.length}</span>} pad={false}>
            {rows.length ? <div className="list">{rows.slice(0, 8).map(([t, i, l, h, s, f, g], k) => <button key={k} className="nrow" onClick={() => f ? openF(f) : go(g)}>
              <Tile n={i} tone={t} s={40} /><div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}><div style={{ fontWeight: 600 }}>{h}</div><div className="mu sm">{s}</div></div><Pill tone={t}>{l}</Pill><Ic n="cr" style={{ color: 'var(--mu)' }} /></button>)}</div>
              : <div className="mu" style={{ padding: 28, textAlign: 'center' }}>Nothing needs you right now.</div>}
          </Card>
        </div>
        <div style={sp(5)}>
          <Card title="Who is where" icon="navi" tone="in" pad={false}>
            {lb.length ? <div className="list">{lb.map(t => {
              const o = live.filter(f => f.tech === t.user_id).length
              return <div key={t.user_id} style={{ padding: 16, display: 'grid', gap: 10 }}>
                <div className="row" style={{ gap: 12 }}><Av name={t.name} userId={t.user_id} s={40} /><div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{t.name}</div><div className="mu sm">{t.on_duty ? 'On duty' : 'Off duty'} · {t.km} km this month</div></div>
                  {d.phones[t.user_id] && <Btn sm icon="phone" title={'Call ' + t.name} onClick={() => dialPhone(d.phones[t.user_id])} />}</div>
                <div className="row mu sm" style={{ gap: 16 }}><span><span className="num" style={{ color: 'var(--tx)' }}>{o}</span> open</span><span><span className="num" style={{ color: 'var(--tx)' }}>{t.tickets_closed}</span> fixed this month</span></div>
                <Bar v={Math.min(100, o / 8 * 100)} tone={o > 5 ? 'wa' : 'in'} h={8} /></div>
            })}</div> : <div className="mu" style={{ padding: 28, textAlign: 'center' }}>No technicians yet.</div>}
          </Card>
        </div>
        <div style={sp(12)}>
          <Card title="Stations" icon="grid" sub="Worst first · one box per screen" pad={false}>
            <div className="swall" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, padding: 16 }}>{list.map(s => {
              const n = s.off.length; const tone = !onHours ? 'n' : n >= 3 ? 'da' : n ? 'wa' : 'ok'
              return <button key={s.id} className={'card swc b-' + tone} onClick={() => openS(s)}>
                <div className="row" style={{ justifyContent: 'space-between' }}><span style={{ fontWeight: 600 }}>{s.name}</span>{s.assigned_to && <Av name={techName(s.assigned_to)} userId={s.assigned_to} s={24} />}</div>
                <div className="mini">{s.scr.map(x => <i key={x.id} className={!onHours ? 't-n' : x.status === 'offline' ? 't-da' : 't-ok'} />)}</div>
                <span className="mu sm">{!onHours ? 'Resting' : n ? <><span className="num" style={{ color: `var(--${tone}T)`, fontWeight: 600 }}>{n}</span> of {s.n} off</> : 'All on'}</span></button>
            })}</div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Faults({ faults, openF, techList, techName }) {
  const [st, setSt] = useState('open'); const [src, setSrc] = useState('all'); const [tf, setTf] = useState('')
  const c = k => faults.filter(f => f.status === k).length
  const list = faults.filter(f => f.status === st && (src === 'all' || f.src === src) && (!tf || f.tech === tf)).sort((a, b) => !!b.esc - !!a.esc || b.age - a.age)
  const cols = 'minmax(0,1.7fr) 150px 130px 100px minmax(0,1.3fr) minmax(0,2fr)'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Hero icon="list" eyebrow="Open faults" value={c('open') + c('work') + c('cant')} sub={`${c('open')} not started · ${c('work')} in process · ${c('cant')} can't fix · ${c('fixed')} fixed today`} />
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Seg value={st} onChange={setSt} opts={['open', 'work', 'cant', 'fixed'].map(k => [k, <>{STAT[k][0]} <span className="num">{c(k)}</span></>])} />
        <div style={{ width: 230 }}><Sel label="Technician" value={tf} onChange={setTf} opts={[['', 'All technicians'], ...techList.map(t => [t.id, t.n])]} /></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{[['all', 'All sources', 'grid'], ...Object.entries(SRC).map(([k, v]) => [k, v[0], v[1]])].map(([k, l, i]) => <button key={k} className={'chip' + (src === k ? ' on' : '')} onClick={() => setSrc(k)}><Ic n={i} s={16} />{l}</button>)}</div>
      <section className="card" style={{ overflowX: 'auto' }}><div style={{ minWidth: 880 }}>
        <div className="thead" style={{ gridTemplateColumns: cols }}><span>Fault</span><span>Source</span><span>Status</span><span>Open for</span><span>Technician</span><span>Next step</span></div>
        {list.length ? <div className="list">{list.map(f => <button key={f.id} className="trow" style={{ gridTemplateColumns: cols }} onClick={() => openF(f)}>
          <span><span style={{ fontWeight: 600 }}>{f.stName}</span> <span className="mu">· {f.scr.length ? `Screen ${f.scr.join(', ')}` : 'No screen'}</span></span>
          <SrcTag s={f.src} /><span><StatPill s={f.status} /></span><span className="mono">{f.age ? age(f.age) : '–'}</span>
          <span className="row" style={{ gap: 8 }}>{f.tech ? <><Av name={techName(f.tech)} userId={f.tech} s={28} />{first(techName(f.tech))}</> : <span className="mu">None</span>}</span>
          <span className="sm" style={{ color: f.esc ? `var(--${f.escT}T)` : 'var(--mu)' }}>{f.esc || (f.status === 'fixed' ? `Fixed by ${f.by}` : f.note || 'Waiting for technician')}</span></button>)}</div>
          : <div className="mu" style={{ padding: 32, textAlign: 'center' }}>Nothing here.</div>}
      </div></section>
      <div className="mu sm">One list for every fault: screen offline, camera, timer, live photo, office work and technician-logged faults.</div>
    </div>
  )
}

function Team({ cp, d, live, isAdmin, show, load }) {
  const lb = cp.leaderboard || []
  const pay = {}; (cp.payroll || []).forEach(p => { pay[p.name] = p })
  const [busy, setBusy] = useState(null)
  const decide = async (kind, id, action) => {
    setBusy(id)
    try {
      const fn = kind === 'leave' ? (action === 'approve' ? 'ops_approve_leave' : 'ops_reject_leave') : (action === 'approve' ? 'ops_approve_ta_request' : 'ops_reject_ta_request')
      const { error } = await supabase.rpc(fn, action === 'reject' ? { p_id: id, p_note: null } : { p_id: id })
      if (error) throw error
      show({ t: action === 'approve' ? 'Approved' : 'Declined' }); load()
    } catch (e) { show({ t: e?.message || 'Could not save', icon: 'alert' }) } finally { setBusy(null) }
  }
  const upM = Number(cp.uptime_month || 0)
  const items = [...d.appr.leaves.map(l => ({ kind: 'leave', id: l.id, n: l.name, h: `Leave · ${dd(l.leave_date)}`, s: [l.leave_type, l.reason].filter(Boolean).join(' · ') })), ...d.appr.ta.map(c => ({ kind: 'ta', id: c.id, n: c.name, h: 'TA claim', s: [dd(c.claim_date), c.city, c.claim_km ? `${c.claim_km} km` : ''].filter(Boolean).join(' · ') }))]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Hero icon="gauge" eyebrow="Team uptime, this month" value={`${upM}%`} sub="Variable pay is full at 95%, zero below 85%" right={<Ring v={upM} s={96} lab="team" />} />
      <div className="hgrid">
        {lb.map(t => {
          const o = live.filter(f => f.tech === t.user_id).length
          const p = pay[t.name]; const v = p ? estVariable(p.salary, p.uptime_pct) : 0
          const cells = [['Open now', o], ['Fixed this month', t.tickets_closed], ['Avg fix time', t.avg_fix_hours ? `${t.avg_fix_hours}h` : '–'], ['km', t.km], [isAdmin ? 'Pay estimate' : 'Attendance', isAdmin ? (p ? inr(p.salary * 0.7 + v) : '–') : `${t.attendance} days`]]
          return <div key={t.user_id} style={sp(6)}><Card pad={false}>
            <div className="row" style={{ gap: 12, padding: 16, borderBottom: '1px solid var(--bd)' }}><Av name={t.name} userId={t.user_id} s={48} /><div style={{ flex: 1 }}><div className="h" style={{ fontSize: 20, fontWeight: 600 }}>{t.name}</div><div className="mu sm">{t.on_duty ? 'On duty today' : 'Off duty'}</div></div><Pill tone={t.uptime_pct >= 95 ? 'ok' : 'wa'} icon="gauge"><span className="num">{t.uptime_pct}%</span></Pill></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1, background: 'var(--bd)' }}>{cells.map(([l, n]) => <div key={l} style={{ background: 'var(--card)', padding: '14px 16px' }}><div className="lbl">{l}</div><div className="num" style={{ fontSize: 20, fontWeight: 600 }}>{n}</div></div>)}</div>
          </Card></div>
        })}
        {!lb.length && <div style={sp(12)}><Card><div className="mu">No field technicians yet.</div></Card></div>}
        <div style={sp(12)}><Card title="Waiting for approval" icon="checkc" tone="ok" pad={false}>
          {items.length ? <div className="list">{items.map(it => <div key={it.id} className="row" style={{ padding: '12px 16px', gap: 12 }}><Av name={it.n} /><div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{it.n} <span className="mu">· {it.h}</span></div><div className="mu sm">{it.s}</div></div>
            <Btn sm kind="gh" disabled={busy === it.id} onClick={() => decide(it.kind, it.id, 'reject')}>Decline</Btn><Btn sm icon="check" disabled={busy === it.id} onClick={() => decide(it.kind, it.id, 'approve')}>Approve</Btn></div>)}</div>
            : <div className="mu" style={{ padding: 28, textAlign: 'center' }}>Nothing waiting.</div>}
        </Card></div>
      </div>
    </div>
  )
}

function Reports({ d, cp, stations, isAdmin, totalScr, offN, show }) {
  const [per, setPer] = useState('today'); const [aud, setAud] = useState('int')
  const fr = d.fr; const tt = fr?.totals || {}
  const upT = Number(cp.uptime_today || 0), upM = Number(cp.uptime_month || 0)
  const up = per === 'today' ? upT : upM
  const worst = (cp.worst_stations || []).slice(0, 10)
  const payTot = (cp.payroll || []).reduce((a, p) => a + estVariable(p.salary, p.uptime_pct), 0)
  const payMax = (cp.payroll || []).reduce((a, p) => a + (Number(p.salary) || 0) * 0.3, 0)
  const text = `Operations report (${per === 'today' ? 'today' : 'this month'})\nNetwork uptime ${up}% · ${totalScr} screens\nFaults: ${per === 'today' ? (tt.went_off ?? 0) : (cp.tickets?.faults_month ?? 0)} · fixed ${tt.fixed ?? '–'} · pending ${tt.pending ?? '–'}`
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><Seg value={per} onChange={setPer} opts={[['today', 'Today'], ['month', 'This month']]} /><Seg value={aud} onChange={setAud} opts={[['int', 'Internal'], ['gsrtc', 'For GSRTC and clients']]} /></div>
        <div className="row" style={{ gap: 8 }}><Btn sm icon="dl" onClick={() => window.print()}>Download PDF</Btn><Btn sm icon="msg" onClick={() => openWhatsAppShare(text)}>Share on WhatsApp</Btn></div>
      </div>
      <Hero icon="chart" eyebrow={`Network uptime, ${per === 'today' ? 'today' : 'this month'}`} value={`${up}%`} sub={`7 AM to 9 PM · ${totalScr} screens`} right={<Ring v={up} s={96} lab="target 95%" />} />
      <div className="hgrid">
        {per === 'today'
          ? <>
            <div style={sp(3)}><StatTile icon="warn" tone="da" label="Went off today" value={tt.went_off ?? '–'} sub="Screens" /></div>
            <div style={sp(3)}><StatTile icon="checkc" tone="ok" label="Fixed today" value={tt.fixed ?? '–'} /></div>
            <div style={sp(3)}><StatTile icon="loader" tone="in" label="Pending" value={tt.pending ?? '–'} /></div>
            <div style={sp(3)}><StatTile icon="moon" tone="wa" label="Timer faults" value={tt.timer ?? '–'} /></div>
          </>
          : <>
            <div style={sp(3)}><StatTile icon="list" tone="n" label="Faults" value={cp.tickets?.faults_month ?? '–'} sub="Last 30 days" /></div>
            <div style={sp(3)}><StatTile icon="clock" tone="wa" label="Avg screen fix time" value={cp.tickets?.avg_fix_hours ? `${cp.tickets.avg_fix_hours}h` : '–'} /></div>
            <div style={sp(3)}><StatTile icon="camera" tone="in" label="Live photos" value={cp.tickets?.photo_month ?? '–'} sub="Last 30 days" /></div>
            <div style={sp(3)}><StatTile icon="warn" tone="da" label="Open now" value={cp.tickets?.open ?? '–'} /></div>
          </>}
        <div style={sp(isAdmin && aud === 'int' ? 7 : 12)}>
          <Card title="Stations, worst first" icon="grid" pad={false}>
            <div className="list">{worst.map(w => <div key={w.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,2fr) 90px', gap: 16, padding: '12px 20px', alignItems: 'center' }}>
              <span style={{ fontWeight: 500 }}>{w.name}</span><Bar v={w.screens ? (1 - w.offline / w.screens) * 100 : 100} tone={w.offline ? 'da' : 'ok'} h={8} /><span className="num" style={{ textAlign: 'right' }}>{w.offline} of {w.screens} off</span></div>)}
              {!worst.length && <div className="mu" style={{ padding: 24, textAlign: 'center' }}>Every station is fully on.</div>}</div>
          </Card>
        </div>
        {isAdmin && aud === 'int' && <div style={sp(5)}><Card title="Pay impact" icon="rupee" tone="y">
          <div className="num" style={{ fontSize: 30, fontWeight: 600 }}>{inr(payTot)}</div>
          <div className="mu sm" style={{ margin: '4px 0 12px' }}>variable pay earned of {inr(payMax)} possible (month so far)</div>
          <Bar v={payMax ? payTot / payMax * 100 : 0} /></Card></div>}
      </div>
      {aud === 'gsrtc' && <div className="mu sm">The GSRTC version hides technician names, pay and internal notes. It keeps uptime, faults and time to fix.</div>}
    </div>
  )
}

function FaultPanel({ f, stations, d, techList, techName, onClose, openScr, show, reload }) {
  const st = stations[f.st] || { name: 'Station', scr: [] }
  const [busy, setBusy] = useState(false)
  const reasonOf = f.tickets[0]?.cause || d.issues[f.tickets[0]?.issue_type_id]
  const reassign = async (userId) => {
    if (!userId) return
    setBusy(true)
    try {
      const ids = f.tickets.map(t => t.id)
      if (ids.length) { const { error } = await supabase.from('ops_tickets').update({ assigned_to: userId }).in('id', ids); if (error) throw error }
      else { const { error } = await supabase.from('ops_depots').update({ assigned_to: userId }).eq('id', f.st); if (error) throw error }
      show({ t: `Given to ${first(techName(userId)) || 'technician'}` }); reload(); onClose()
    } catch (e) { show({ t: e?.message || 'Could not change', icon: 'alert' }) } finally { setBusy(false) }
  }
  const markFixed = async () => {
    setBusy(true)
    try {
      for (const t of f.tickets) { const { error } = await supabase.rpc('ops_ticket_resolve', { p_ticket: t.id, p_cause: null, p_notes: null }); if (error) throw error }
      show({ t: 'Marked fixed' }); reload(); onClose()
    } catch (e) { show({ t: e?.message || 'Could not close (a screen may still be off)', icon: 'alert' }) } finally { setBusy(false) }
  }
  const phone = d.phones[f.tech]
  return (
    <Sheet side title={`${st.name} · ${f.scr.length ? 'Screen ' + f.scr.join(', ') : SRC[f.src][0]}`} onClose={onClose}
      footer={f.status !== 'fixed' && <>
        <div style={{ width: 200 }}><Sel label="Reassign" value="" onChange={reassign} opts={[['', 'Reassign to...'], ...techList.map(t => [t.id, t.n])]} /></div>
        {phone && <Btn icon="phone" onClick={() => dialPhone(phone)}>Call {first(techName(f.tech))}</Btn>}
        <div style={{ flex: 1 }} />
        {f.tickets.some(t => t.type !== 'photo_request') && <Btn kind="pri" icon="check" disabled={busy} onClick={markFixed}>Mark fixed</Btn>}</>}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><StatPill s={f.status} /><SrcTag s={f.src} />{f.age > 0 && <Pill icon="clock"><span className="mono">{age(f.age)}</span></Pill>}</div>
      {f.esc && <div className={f.escT === 'da' ? 'errrow' : 'warnrow'}><Ic n="flag" /><span>{f.esc}</span></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{[['Technician', f.tech ? techName(f.tech) : 'None'], ['What is wrong', reasonOf || 'Not picked yet'], ['Opened', f.tickets[0] ? `${dd(f.tickets[0].created_at)} ${hhmm(f.tickets[0].created_at)}` : '–'], ['Notes', f.tickets[0]?.notes || f.note || '–']].map(([l, v]) => <div key={l}><div className="lbl">{l}</div><div>{v}</div></div>)}</div>
      {f.scr.length > 0 && <div style={{ display: 'grid', gap: 8 }}><span className="lbl">Screens</span><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{f.scr.map(n => <Btn key={n} sm icon="mon" onClick={() => openScr(st, n)}>Screen {n}</Btn>)}</div></div>}
    </Sheet>
  )
}

function StationPanel({ s, onClose, openScr, techName, onHours }) {
  const [contacts, setContacts] = useState(null)
  useEffect(() => { let on = true; supabase.from('ops_depot_contacts').select('id, role_en, name, phone, display_order').eq('depot_id', s.id).order('display_order').then(({ data }) => on && setContacts(data || [])); return () => { on = false } }, [s.id])
  return (
    <Sheet side title={s.name} sub={`${s.n} screens · ${s.assigned_to ? techName(s.assigned_to) : 'No technician'}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>{s.scr.map(x => <ScrTile key={x.id} n={x.n} st={!onHours ? 'rest' : x.status === 'offline' ? 'off' : 'on'} onClick={() => openScr(s, x.n)} />)}</div>
      <div className="mu sm">Tap a screen for its profile.</div>
      <div style={{ display: 'grid', gap: 4 }}><span className="lbl">Who to call</span>
        {contacts === null ? <div className="mu">Loading...</div> : contacts.length ? contacts.map(c => <div key={c.id} className="row" style={{ gap: 12, minHeight: 48 }}><Tile n="phone" tone="ok" s={32} /><div style={{ flex: 1 }}><div>{c.name || c.role_en}</div><div className="mu sm">{c.name ? c.role_en : ''}</div></div><Btn sm icon="phone" onClick={() => dialPhone(c.phone)}>{c.phone}</Btn></div>) : <div className="mu">No numbers added yet.</div>}</div>
    </Sheet>
  )
}

function ScreenPanel({ s, n, onClose }) {
  const scr = s.scr.find(x => x.n === n)
  const [hist, setHist] = useState(null)
  useEffect(() => { if (!scr) return; let on = true; supabase.from('ops_screen_faults').select('id, kind, status, started_at, fixed_at').eq('screen_id', scr.id).order('started_at', { ascending: false }).limit(8).then(({ data }) => on && setHist(data || [])); return () => { on = false } }, [scr])
  if (!scr) return null
  return (
    <Sheet side title={`${s.name} · Screen ${n}`} sub={scr.name} onClose={onClose}>
      <div className="row" style={{ gap: 8 }}>{scr.status === 'offline' ? <Pill tone="da" icon="monoff">Off now</Pill> : <Pill tone="ok" icon="mon">On</Pill>}{scr.camera_active === false ? <Pill tone="wa" icon="camoff">Camera off</Pill> : <Pill tone="ok" icon="camera">Camera on</Pill>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{[['Last response', scr.last_response_at ? `${dd(scr.last_response_at)} ${hhmm(scr.last_response_at)}` : '–'], ['Faulty (last 8)', hist ? hist.length : '…']].map(([l, v]) => <div key={l}><div className="lbl">{l}</div><div className="mono">{v}</div></div>)}</div>
      <div style={{ display: 'grid', gap: 4 }}><span className="lbl">Fault history</span>
        {hist === null ? <div className="mu">Loading...</div> : hist.length ? hist.map(h => <div key={h.id} className="row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--bd)' }}><span className="mono mu" style={{ width: 64 }}>{dd(h.started_at)}</span><span style={{ flex: 1 }}>{h.kind}</span><span className="mono">{h.fixed_at ? age(Math.round((Date.parse(h.fixed_at) - Date.parse(h.started_at)) / 60000)) : 'open'}</span></div>) : <div className="mu">No faults recorded yet.</div>}</div>
    </Sheet>
  )
}

function GiveWork({ onClose, show, reload }) {
  const [lk, setLk] = useState(null); const [k, setK] = useState('fault'); const [t, setT] = useState(''); const [dep, setDep] = useState(''); const [scr, setScr] = useState(''); const [issue, setIssue] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.rpc('ops_office_lookup').then(({ data, error }) => { if (error || !data?.techs) setLk({ techs: [], depots: [], screens: [], issues: [] }); else setLk(data) }) }, [])
  const screens = (lk?.screens || []).filter(s => s.depot_id === dep)
  const go = async () => {
    if (!t) return show({ t: 'Pick a technician', icon: 'alert' })
    if (k !== 'office' && !dep) return show({ t: 'Pick a station', icon: 'alert' })
    setBusy(true)
    try {
      if (k === 'office') {
        const { error } = await supabase.rpc('work_create_task', { p_title: note.trim() || 'Office work', p_project: null, p_note: null, p_due: istTodayISO(), p_parts: [{ assignee: t, label: '', due: null }], p_steps: [] })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('ops_office_assign', { p_kind: k, p_tech: t, p_depot: dep, p_screen: scr || null, p_issue: k === 'fault' ? (issue || null) : null, p_note: note.trim() || null, p_quote: null })
        if (error) throw error
      }
      show({ t: 'Work given. It shows on the technician’s list now.' }); reload(); onClose()
    } catch (e) { show({ t: e?.message || 'Could not send', icon: 'alert' }) } finally { setBusy(false) }
  }
  return (
    <Sheet side title="Give work" sub="Goes to the technician" onClose={onClose} footer={<><Btn kind="gh" onClick={onClose}>Cancel</Btn><div style={{ flex: 1 }} /><Btn kind="pri" icon="send" disabled={busy || !lk} onClick={go}>Give work</Btn></>}>
      {!lk ? <div className="mu">Loading...</div> : <>
        <Seg full value={k} onChange={setK} opts={[['fault', 'Fault'], ['photo', 'Live photo'], ['office', 'Office work']]} />
        <div style={{ display: 'grid', gap: 8 }}><span className="lbl">Technician</span>{lk.techs.map(x => <button key={x.id} className={'rrow card' + (t === x.id ? ' on' : '')} onClick={() => setT(x.id)}><Av name={x.name} userId={x.id} /><span style={{ flex: 1 }}>{x.name}</span><Ic n={t === x.id ? 'checkc' : 'circle'} /></button>)}</div>
        {k !== 'office' && <div style={{ display: 'grid', gap: 8 }}><span className="lbl">Station</span><Sel label="Station" value={dep} onChange={v => { setDep(v); setScr('') }} opts={[['', 'Pick a station'], ...lk.depots.map(x => [x.id, x.name])]} /></div>}
        {k !== 'office' && dep && <div style={{ display: 'grid', gap: 8 }}><span className="lbl">Screen (optional)</span><Sel label="Screen" value={scr} onChange={setScr} opts={[['', 'Whole station'], ...screens.map(x => [x.id, x.name])]} /></div>}
        {k === 'fault' && <div style={{ display: 'grid', gap: 8 }}><span className="lbl">What is wrong</span><Sel label="Issue" value={issue} onChange={setIssue} opts={[['', 'Not sure'], ...lk.issues.map(x => [x.id, x.name])]} /></div>}
        <div style={{ display: 'grid', gap: 8 }}><span className="lbl">{k === 'office' ? 'What to do' : 'Note (optional)'}</span><input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder="Write it simply" /></div>
      </>}
    </Sheet>
  )
}
