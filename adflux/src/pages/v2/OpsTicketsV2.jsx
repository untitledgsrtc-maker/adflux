// src/pages/v2/OpsTicketsV2.jsx — the operation_executive's home (owner-approved
// mockup, 2026-08-27; restyled on the lead-* design system §248). Assigned-city
// filter + 4 tabs: Open (offline screens -> pick issue -> ticket) / In process
// (call the contact, recorded like sales) / Fixed / Me (self-scoped uptime, pay,
// calls, stations, fixes). Consolidates Down-now + Log-issue + the old queue.
// Reuses ops_screens/ops_depots/ops_issue_types/ops_tickets/ops_depot_contacts +
// call_logs (ops_ticket_id) + ops_my_uptime_pay. Gujarati-first (§231). Built on
// the same lead-* classes + global tokens as OpsAdminV2 so it matches the cockpit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MapPin, Phone, ChevronRight, Camera, Check, Wrench, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { istTodayISO } from '../../utils/istDate'
import { isOnHours, istClock, faultAgeHours, ageLabel, severityOf } from '../../utils/opsHours'
import { estVariable } from '../../utils/opsPay'

// Map an ops outcome label -> the sales call_logs.outcome enum (never widen the enum).
const OUTCOME_DB = { reached: 'connected', will_come: 'connected', fixed_call: 'connected', no_answer: 'no_answer' }

// design-system tokens (global, matches OpsAdminV2 / leads.css)
const secLbl = { fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }
const fieldSel = { width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }
const CHIP = { danger: ['var(--danger-soft)', 'var(--danger)'], amber: ['var(--warning-soft)', 'var(--warning)'], green: ['var(--success-soft)', 'var(--success)'] }
function chip(text, tone) {
  const [bg, fg] = CHIP[tone] || CHIP.danger
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '4px 11px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>
}

export default function OpsTicketsV2() {
  const { profile } = useAuth()
  const uid = profile?.id
  const isDesktop = useIsDesktop()
  const gridWrap = { display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(320px, 1fr))' : '1fr', gap: 14, alignItems: 'start' }
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const nm = (row, base) => (lang === 'gu' ? row?.[`${base}_gu`] : row?.[`${base}_en`]) || row?.[`${base}_en`] || ''

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('open')
  const [cityId, setCityId] = useState('')      // '' = all my stations
  const [onHours, setOnHours] = useState(isOnHours())   // 7 AM–9 PM window (F4)

  const [depots, setDepots] = useState([])
  const [issueTypes, setIssueTypes] = useState([])
  const [contactsByDepot, setContactsByDepot] = useState({})
  const [screens, setScreens] = useState([])
  const [proc, setProc] = useState([])
  const [fixed, setFixed] = useState([])
  const [callsByTicket, setCallsByTicket] = useState({})
  const [stats, setStats] = useState(null)

  const [sheet, setSheet] = useState(null)
  const [issueId, setIssueId] = useState('')
  const [otherText, setOtherText] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const fileRef = useRef(null)

  const [callFor, setCallFor] = useState(null)
  const [outcome, setOutcome] = useState('')
  const [callNote, setCallNote] = useState('')

  const savingRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      const dRes = await supabase.from('ops_depots')
        .select('id, name, assigned_to').eq('assigned_to', uid).eq('is_active', true).order('name')
      if (dRes.error) throw dRes.error
      const myDepots = dRes.data || []
      setDepots(myDepots)
      const depotIds = myDepots.map(d => d.id)

      if (!depotIds.length) { setScreens([]); setProc([]); setFixed([]); setContactsByDepot({}); setIssueTypes([]); setCallsByTicket({}); setStats(null); return }

      // F4: the fault set depends on the operating window (7 AM–9 PM). On-hours a
      // screen SHOULD be on → offline = a fault. Off-hours it should be off →
      // offline is normal (quiet), a screen still ONLINE is a TIMER fault.
      const nowOn = isOnHours()
      setOnHours(nowOn)

      const [scr, it, ct, pRes, fRes] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status, depot_id, last_response_at').in('depot_id', depotIds).eq('is_active', true).eq('status', nowOn ? 'offline' : 'online'),
        supabase.from('ops_issue_types').select('id, issue_en, issue_gu, solution_en, solution_gu, display_order').eq('is_active', true).order('display_order'),
        supabase.from('ops_depot_contacts').select('id, depot_id, role_en, role_gu, name, phone, display_order').in('depot_id', depotIds).order('display_order'),
        supabase.from('ops_tickets')
          .select('id, screen_id, depot_id, cause, notes, created_at, issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en, issue_gu), screen:ops_screens!ops_tickets_screen_id_fkey(name), depot:ops_depots!ops_tickets_depot_id_fkey(name)')
          .eq('assigned_to', uid).eq('source', 'manual').eq('status', 'in_progress').order('created_at', { ascending: false }),
        supabase.from('ops_tickets')
          .select('id, screen_id, depot_id, cause, notes, resolved_at, issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en, issue_gu), screen:ops_screens!ops_tickets_screen_id_fkey(name), depot:ops_depots!ops_tickets_depot_id_fkey(name)')
          .eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(30),
      ])
      setIssueTypes(it.data || [])
      const cbd = {}; (ct.data || []).forEach(c => { (cbd[c.depot_id] = cbd[c.depot_id] || []).push(c) }); setContactsByDepot(cbd)
      const procRows = pRes.data || []
      setProc(procRows); setFixed(fRes.data || [])

      const takenScreenIds = new Set(procRows.map(p => p.screen_id).filter(Boolean))
      setScreens((scr.data || []).filter(s => !takenScreenIds.has(s.id)))

      const tIds = procRows.map(p => p.id)
      if (tIds.length) {
        const cl = await supabase.from('call_logs').select('id, ops_ticket_id, outcome, notes, call_at').in('ops_ticket_id', tIds).order('call_at', { ascending: false })
        const cbt = {}; (cl.data || []).forEach(r => { (cbt[r.ops_ticket_id] = cbt[r.ops_ticket_id] || []).push(r) }); setCallsByTicket(cbt)
      } else setCallsByTicket({})

      // ── Me tab (self-scoped; RPC + small reads) — best-effort ──
      try {
        const monthStart = istTodayISO().slice(0, 8) + '01'
        const dayStart = istTodayISO() + 'T00:00:00+05:30'
        const [payRes, cntRes, fixRes, callRes] = await Promise.all([
          supabase.rpc('ops_my_uptime_pay'),
          supabase.from('ops_screens').select('status').in('depot_id', depotIds).eq('is_active', true),
          supabase.from('ops_tickets').select('created_at, resolved_at').eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', monthStart),
          supabase.from('call_logs').select('call_at').eq('user_id', uid).gte('call_at', monthStart),
        ])
        const pay = Array.isArray(payRes.data) ? payRes.data[0] : payRes.data
        const monthly = pay ? Number(pay.salary) || 0 : 0
        const hasPay = !!(pay && pay.has_data && monthly > 0)
        const uptimePct = pay && pay.has_data ? Math.round(Number(pay.uptime_pct) || 0) : null
        const cnt = cntRes.data || []
        const fx = fixRes.data || []
        const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
        const calls = callRes.data || []
        setStats({
          monthly,
          base: monthly ? Math.round(monthly * 0.70) : 0,
          variable: hasPay ? estVariable(monthly, pay.uptime_pct) : 0,
          hasPay,
          uptimePct,
          up: cnt.filter(s => s.status === 'online').length,
          down: cnt.filter(s => s.status === 'offline').length,
          fixedMo: fx.length,
          avgFixH: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
          callsMo: calls.length,
          callsToday: calls.filter(c => c.call_at >= dayStart).length,
        })
      } catch { /* keep prior stats */ }
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [uid])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useEffect(() => {
    const onFocus = () => { load() }
    document.addEventListener('visibilitychange', onFocus); window.addEventListener('focus', onFocus)
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus) }
  }, [load])

  const cityScreens = useMemo(() => cityId ? screens.filter(s => s.depot_id === cityId) : screens, [screens, cityId])
  const cityProc = useMemo(() => cityId ? proc.filter(p => p.depot_id === cityId) : proc, [proc, cityId])
  const cityFixed = useMemo(() => cityId ? fixed.filter(f => f.depot_id === cityId) : fixed, [fixed, cityId])
  const depotName = useCallback(id => depots.find(d => d.id === id)?.name || '—', [depots])
  const screenNo = useMemo(() => {
    const byD = {}; const m = {}
    screens.forEach(s => { byD[s.depot_id] = (byD[s.depot_id] || 0) + 1; m[s.id] = byD[s.depot_id] }); return m
  }, [screens])

  function openSheet(screenIds, depotId) {
    setSheet({ screenIds, depotId })
    // off-hours the fault is a timer issue → pre-fill the Timer reason if seeded
    const timer = !onHours ? issueTypes.find(x => /timer/i.test(x.issue_en || '')) : null
    setIssueId(timer?.id || '')
    setOtherText(''); setNotes(''); setPhotoFile(null); if (fileRef.current) fileRef.current.value = ''
  }

  async function submitIssue() {
    if (savingRef.current || busy) return
    const cause = issueId === 'other' ? otherText.trim() : (issueTypes.find(x => x.id === issueId)?.issue_en || '')
    if (!issueId || (issueId === 'other' && !cause)) { toastError(new Error(''), t('pick_issue', lang)); return }
    savingRef.current = true; setBusy(true)
    try {
      let photo_path = null
      if (photoFile) {
        const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase()
        const key = `${sheet.depotId}/${Date.now()}.${ext}`
        const up = await supabase.storage.from('ops-photos').upload(key, photoFile, { upsert: false })
        if (up.error) { toastError(up.error, t('save_failed', lang)); return }
        photo_path = key
      }
      const preset = issueId !== 'other' ? issueTypes.find(x => x.id === issueId) : null
      const rows = sheet.screenIds.map(sid => ({
        type: 'fault', source: 'manual', status: 'in_progress',
        depot_id: sheet.depotId, screen_id: sid,
        created_by: uid, assigned_to: uid,   // exec INSERT policy needs created_by=auth.uid(); read/update need assigned_to=auth.uid()
        issue_type_id: preset ? preset.id : null,
        cause, notes: notes.trim() || null, photo_path,
      }))
      const { error } = await supabase.from('ops_tickets').insert(rows)
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('issue_saved', lang))
      setSheet(null); setTab('proc'); await load()
    } finally { setBusy(false); savingRef.current = false }
  }

  function startCall(ticket) {
    const cs = contactsByDepot[ticket.depot_id] || []
    const contact = cs[0] || null
    if (contact?.phone) window.location.href = `tel:${String(contact.phone).replace(/\s/g, '')}`
    setCallFor({ ticket, contact }); setOutcome(''); setCallNote('')
  }

  async function saveCall() {
    if (savingRef.current || busy) return
    const oc = outcome || 'reached'
    savingRef.current = true; setBusy(true)
    try {
      const labelKey = { reached: 'out_reached', no_answer: 'out_no_answer', will_come: 'out_will_come', fixed_call: 'out_fixed_call' }[oc]
      const noteTxt = [t(labelKey, lang), callNote.trim()].filter(Boolean).join(' · ')
      const { error } = await supabase.from('call_logs').insert([{
        user_id: uid,
        client_phone: callFor.contact?.phone ? String(callFor.contact.phone).replace(/[^0-9]/g, '').slice(-10) : null,
        outcome: OUTCOME_DB[oc] || 'no_answer',
        notes: noteTxt,
        ops_ticket_id: callFor.ticket.id,
      }])
      if (error) { toastError(error, t('save_failed', lang)); return }
      setCallFor(null); await load()
    } finally { setBusy(false); savingRef.current = false }
  }

  async function markFixed(ticket) {
    if (busy) return
    const { data: scr } = await supabase.from('ops_screens').select('status').eq('id', ticket.screen_id).maybeSingle()
    if (scr?.status === 'offline') {
      const ok = await confirmDialog({ title: t('mark_fixed', lang), message: t('still_offline_q', lang), confirmLabel: t('mark_fixed', lang), cancelLabel: t('cancel', lang) })
      if (!ok) return
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('ops_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', ticket.id)
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('fixed_word', lang)); setTab('fixed'); await load()
    } finally { setBusy(false) }
  }

  // undo: send a ticket back to Open (its screen reappears in the Open tab).
  async function reopen(ticket) {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('ops_tickets').update({ status: 'open', resolved_at: null }).eq('id', ticket.id)
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('reopen', lang)); setTab('open'); await load()
    } finally { setBusy(false) }
  }

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div className="lead-root"><div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>{err} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  const cnt = { open: cityScreens.length, proc: cityProc.length, fixed: cityFixed.length }
  const tabs = [['open', t('tab_open', lang), 'var(--danger)'], ['proc', t('tab_proc', lang), 'var(--warning)'], ['fixed', t('tab_fixed', lang), 'var(--success)'], ['mystats', t('tab_mystats', lang), '']]

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">{lang === 'gu' ? 'ઓપરેશન · ફિલ્ડ' : 'Operations · field'}</div>
          <div className="lead-page-title">{t('tickets_title', lang)}</div>
        </div>
        <button className="lead-btn" onClick={flip} style={{ fontWeight: 700 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      {/* city */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ ...secLbl, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}><MapPin size={13} />{t('city', lang)}</div>
        <select value={cityId} onChange={e => setCityId(e.target.value)} style={{ ...fieldSel, borderColor: 'var(--accent)', maxWidth: isDesktop ? 440 : '100%' }}>
          <option value="">{lang === 'gu' ? 'બધા સ્ટેશન' : 'All my stations'}</option>
          {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* tabs — segmented pill */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
        {tabs.map(([k, label, col]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, border: 'none', borderRadius: 9, padding: '9px 0', fontSize: 13, fontWeight: tab === k ? 700 : 500, cursor: 'pointer', background: tab === k ? 'var(--surface-3)' : 'transparent', color: tab === k ? 'var(--text)' : 'var(--text-muted)' }}>
            {label}{col && cnt[k] != null ? <> <span style={{ color: col, fontFamily: 'var(--font-display)' }}>{cnt[k]}</span></> : null}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-subtle, var(--text-muted))', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Clock size={12} />{t('hours_window', lang)} · {t('now_word', lang)} {istClock()}
          </span>
          {chip(t(onHours ? 'on_hours_now' : 'off_hours_now', lang), onHours ? 'green' : 'amber')}
          {cityScreens.length > 0 && (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {cityScreens.length} {t(onHours ? 'screens_word' : 'timer_faults_w', lang)}{onHours ? ` ${t('down_word2', lang)}` : ''} · {new Set(cityScreens.map(s => s.depot_id)).size} {t('stations_word', lang)}
            </span>
          )}
        </div>
      )}

      {tab === 'open' && <OpenTab />}
      {tab === 'proc' && <ProcTab />}
      {tab === 'fixed' && <FixedTab />}
      {tab === 'mystats' && <MeTab />}

      {sheet && <IssueSheet />}
      {callFor && <CallSheet />}
    </div>
  )

  function empty(txt) { return <div style={{ textAlign: 'center', padding: '52px 12px', color: 'var(--text-muted)', fontSize: 14 }}>{txt}</div> }

  function OpenTab() {
    // F4: one worst-first fault list (no grouped/individual toggle — the double
    // scroll is gone). Off-hours + no timer faults = the "all quiet" good state.
    if (!cityScreens.length) return empty(t(onHours ? 'no_open' : 'all_quiet', lang))

    // group by station, then rank stations worst-first (severity, then age)
    const byDepot = {}; cityScreens.forEach(s => { (byDepot[s.depot_id] = byDepot[s.depot_id] || []).push(s) })
    const rows = Object.entries(byDepot).map(([did, list]) => {
      const oldest = onHours ? Math.max(...list.map(s => faultAgeHours(s.last_response_at))) : 0
      const sev = onHours ? severityOf(oldest, list.length) : (list.length >= 5 ? 2 : 1)
      return { did, list, oldest, sev }
    }).sort((a, b) => b.sev - a.sev || b.oldest - a.oldest)

    const SEV = { 2: 'var(--danger)', 1: 'var(--warning)', 0: 'var(--text-subtle, var(--text-muted))' }
    return (
      <div style={gridWrap}>{rows.map(r => {
        const ids = r.list.map(s => s.id)
        const one = r.list.length === 1
        const typeLabel = onHours ? t('signal_lost', lang) : t('timer_fault', lang)
        const ageStr = onHours ? ageLabel(r.oldest, lang) : t('still_on', lang)
        return (
          <button key={r.did} onClick={() => openSheet(ids, r.did)} className="lead-card"
            style={{ padding: '13px 14px', borderLeft: `4px solid ${SEV[r.sev]}`, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{depotName(r.did)}</span>
                {!one && chip(`${r.list.length} ${t('down_word2', lang)}`, r.sev === 2 ? 'danger' : 'amber')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {one ? `${r.list[0].name || `${t('screen', lang)} ${screenNo[r.list[0].id] || ''}`} · ` : ''}{typeLabel} · {ageStr}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        )
      })}</div>
    )
  }

  function ProcTab() {
    if (!cityProc.length) return empty(t('no_proc', lang))
    return <div style={gridWrap}>{cityProc.map(tk => {
      const calls = callsByTicket[tk.id] || []
      const contact = (contactsByDepot[tk.depot_id] || [])[0]
      return (
        <div key={tk.id} className="lead-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{tk.screen?.name || (t('screen', lang) + ' ' + (screenNo[tk.screen_id] || ''))}</span>
            {chip(t('in_process', lang), 'amber')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 12px' }}>{tk.depot?.name || depotName(tk.depot_id)} · {tk.issue ? nm(tk.issue, 'issue') : (tk.cause || t('fault', lang))}</div>
          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13.5 }}><Phone size={13} style={{ verticalAlign: -1, marginRight: 5, color: 'var(--text-muted)' }} />
              {contact ? (contact.name || nm(contact, 'role') || t('call', lang)) : t('no_contacts', lang)}
              <br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{contact ? [contact.name ? nm(contact, 'role') : null, contact.phone].filter(Boolean).join(' · ') : ''}</span>
            </span>
            {contact && <button onClick={() => startCall(tk)} className="lead-btn" style={{ color: 'var(--success)', borderColor: 'var(--success)', flexShrink: 0 }}><Phone size={14} /> {t('call', lang)}</button>}
          </div>
          {calls.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10 }}>{calls.length} {t('n_calls', lang)} · {calls[0].notes || calls[0].outcome}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => reopen(tk)} disabled={busy} className="lead-btn" style={{ justifyContent: 'center' }}>{t('reopen', lang)}</button>
            <button onClick={() => markFixed(tk)} disabled={busy} className="lead-btn lead-btn-primary" style={{ flex: 1, justifyContent: 'center' }}>{t('mark_fixed', lang)} <Check size={14} /></button>
          </div>
        </div>
      )
    })}</div>
  }

  function FixedTab() {
    if (!cityFixed.length) return empty(t('no_fixed', lang))
    return <div style={gridWrap}>{cityFixed.map(f => (
      <div key={f.id} className="lead-card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{f.screen?.name || t('screen', lang)}</span>
          {chip(t('fixed_word', lang), 'green')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{f.depot?.name || depotName(f.depot_id)} · {f.issue ? nm(f.issue, 'issue') : (f.cause || t('fault', lang))}</div>
        {f.resolved_at && <div style={{ fontSize: 12, color: 'var(--text-subtle, var(--text-muted))', marginTop: 8 }}>{new Date(f.resolved_at).toLocaleString('en-GB')}</div>}
        <button onClick={() => reopen(f)} disabled={busy} className="lead-btn" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>{t('reopen', lang)}</button>
      </div>
    ))}</div>
  }

  function MeTab() {
    const s = stats
    // `screens` is the time-aware fault set (F4); worst = down stations only, so
    // this reads correctly on-hours and quietly empties off-hours.
    const byDepot = {}; screens.filter(sc => sc.status === 'offline').forEach(sc => { byDepot[sc.depot_id] = (byDepot[sc.depot_id] || 0) + 1 })
    const worst = Object.entries(byDepot).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const ring = s?.uptimePct != null ? s.uptimePct : 0
    const total = (s?.base || 0) + (s?.variable || 0)
    const bigNum = { fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800 }
    return (
      <div style={gridWrap}>
        {/* my salary */}
        <div className="lead-card" style={{ padding: 16, background: 'linear-gradient(120deg, rgba(16,185,129,.16), rgba(16,185,129,.04))', borderColor: 'rgba(16,185,129,.32)' }}>
          <div style={{ ...secLbl, color: 'var(--success)' }}>{t('my_salary_mo', lang)}</div>
          {s?.monthly ? <>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, color: 'var(--success)', marginTop: 2 }}>₹{total.toLocaleString('en-IN')}</div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12.5, color: 'var(--success)' }}>
              <span>{t('sal_base', lang)} ₹{(s.base).toLocaleString('en-IN')}</span>
              <span>+ {t('sal_variable', lang)} ₹{(s.variable).toLocaleString('en-IN')}{!s.hasPay ? ` · ${t('var_fills', lang)}` : ''}</span>
            </div>
          </> : <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--success)', marginTop: 6 }}>{t('no_stats', lang)}</div>}
        </div>
        {/* uptime + calls */}
        <div className="lead-card" style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 92, height: 92, flexShrink: 0, borderRadius: '50%', background: `conic-gradient(var(--success) 0 ${ring}%, var(--surface-3) ${ring}% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800 }}>{s?.uptimePct != null ? `${s.uptimePct}%` : '—'}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t('uptime_short', lang)}</span>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ ...secLbl }}>{t('my_calls', lang)}</div>
            <div style={bigNum}>{s?.callsMo ?? 0}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('calls_month', lang)} · {s?.callsToday ?? 0} {t('calls_today', lang)}</div>
          </div>
        </div>
        {/* stations + fixed */}
        <div className="lead-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Wrench size={16} style={{ color: 'var(--text-muted)' }} /><span style={bigNum}>{depots.length}</span></div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('my_stations', lang)} · <span style={{ color: 'var(--success)' }}>{s?.up ?? 0} {t('up_word', lang)}</span> · <span style={{ color: 'var(--danger)' }}>{s?.down ?? 0} {t('down_word2', lang)}</span></div>
        </div>
        <div className="lead-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={16} style={{ color: 'var(--text-muted)' }} /><span style={bigNum}>{s?.fixedMo ?? 0}</span></div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t('fixed_this_mo', lang)}{s?.avgFixH != null ? ` · ${t('avg_fix', lang)} ${s.avgFixH}${t('hrs', lang)}` : ''}</div>
        </div>
        {/* worst stations */}
        {worst.length > 0 && (
          <div className="lead-card" style={{ padding: 16 }}>
            <div style={{ ...secLbl, marginBottom: 10 }}>{t('worst_now', lang)}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {worst.map(([did, n]) => chip(`${depotName(did)} · ${n} ${t('down_word2', lang)}`, 'danger'))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle, var(--text-muted))', textAlign: 'center', gridColumn: '1 / -1' }}>{t('scoped_note', lang)}</div>
      </div>
    )
  }

  function IssueSheet() {
    const n = sheet.screenIds.length
    const names = sheet.screenIds.map(id => screens.find(s => s.id === id)?.name).filter(Boolean)
    const label = `${names.length ? names.join(', ') : `${n} ${t('screen', lang)}`} · ${depotName(sheet.depotId)}`
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setSheet(null)}>
        <div className="lead-card" style={{ width: '100%', maxWidth: 480, margin: 0, borderRadius: '16px 16px 0 0', maxHeight: '85vh', overflowY: 'auto', padding: 16 }} onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12.5, color: onHours ? 'var(--danger)' : 'var(--warning)', marginBottom: 14 }}>{onHours ? t('offline', lang) : t('timer_fault', lang)}</div>
          <div style={secLbl}>{t('cause', lang)}</div>
          <select value={issueId} onChange={e => setIssueId(e.target.value)} style={{ ...fieldSel, marginTop: 6 }}>
            <option value="">{t('pick_issue', lang)}</option>
            {issueTypes.map(it => <option key={it.id} value={it.id}>{nm(it, 'issue')}</option>)}
            <option value="other">{t('other_issue', lang)}</option>
          </select>
          {issueId === 'other' && <input value={otherText} onChange={e => setOtherText(e.target.value)} placeholder={t('cause_ph', lang)} style={{ ...fieldSel, marginTop: 8 }} />}
          {/* inline Gujarati fix steps for the picked issue */}
          {(() => {
            const sel = issueId && issueId !== 'other' ? issueTypes.find(x => x.id === issueId) : null
            const sol = sel && nm(sel, 'solution')
            return sol ? (
              <div style={{ marginTop: 10, background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>{t('fix_steps', lang)}</div>
                <div style={{ fontSize: 13.5, color: 'var(--text)', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{sol}</div>
              </div>
            ) : null
          })()}
          <div style={{ ...secLbl, marginTop: 14 }}>{t('notes', lang)}</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t('notes_ph', lang)} style={{ ...fieldSel, marginTop: 6, resize: 'none' }} />
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={e => setPhotoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...fieldSel, marginTop: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: photoFile ? 'var(--success)' : 'var(--text)' }}>{photoFile ? <Check size={18} /> : <Camera size={18} />}{photoFile ? t('photo_added', lang) : t('upload_photo', lang)}</button>
          <button onClick={submitIssue} disabled={busy} className="lead-btn lead-btn-primary" style={{ width: '100%', marginTop: 14, justifyContent: 'center', padding: '12px' }}>{busy ? t('saving', lang) : t('submit_proc', lang)}</button>
        </div>
      </div>
    )
  }

  function CallSheet() {
    const c = callFor.contact
    const outs = [['reached', t('out_reached', lang)], ['no_answer', t('out_no_answer', lang)], ['will_come', t('out_will_come', lang)], ['fixed_call', t('out_fixed_call', lang)]]
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setCallFor(null)}>
        <div className="lead-card" style={{ width: '100%', maxWidth: 480, margin: 0, borderRadius: '16px 16px 0 0', padding: 16 }} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', padding: '4px 0 16px' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--success-soft)', margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Phone size={24} style={{ color: 'var(--success)' }} /></div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t('calling', lang)} {c?.name || ''}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{c ? ((lang === 'gu' ? c.role_gu : c.role_en) || c.role_en || '') + ' · ' + (c.phone || '') : ''}</div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle, var(--text-muted))', marginTop: 4 }}>{t('recorded_auto', lang)}</div>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>{t('call_ended_q', lang)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {outs.map(([k, label]) => <button key={k} onClick={() => setOutcome(k)} className="lead-btn" style={{ justifyContent: 'center', ...(outcome === k ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft, rgba(255,230,0,.12))' } : {}) }}>{label}</button>)}
          </div>
          <textarea value={callNote} onChange={e => setCallNote(e.target.value)} rows={2} placeholder={t('call_note_ph', lang)} style={{ ...fieldSel, resize: 'none', marginBottom: 12 }} />
          <button onClick={saveCall} disabled={busy} className="lead-btn lead-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>{busy ? t('saving', lang) : t('save_call', lang)}</button>
        </div>
      </div>
    )
  }
}
