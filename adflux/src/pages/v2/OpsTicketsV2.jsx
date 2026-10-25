// src/pages/v2/OpsTicketsV2.jsx — the operation_executive's home (owner-approved
// mockup, 2026-08-27; restyled on the lead-* design system §248). Assigned-city
// filter + 4 tabs: Open (offline screens -> pick issue -> ticket) / In process
// (call the contact, recorded like sales) / Fixed / Me (self-scoped uptime, pay,
// calls, stations, fixes). Consolidates Down-now + Log-issue + the old queue.
// Reuses ops_screens/ops_depots/ops_issue_types/ops_tickets/ops_depot_contacts +
// call_logs (ops_ticket_id) + ops_my_uptime_pay. Gujarati-first (§231). Built on
// the same lead-* classes + global tokens as OpsAdminV2 so it matches the cockpit.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, MapPin, Phone, ChevronRight, Camera, Check, Wrench, Clock, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { istTodayISO } from '../../utils/istDate'
import { isOnHours, istClock, faultAgeHours, ageLabel, severityOf } from '../../utils/opsHours'
import { estVariable } from '../../utils/opsPay'
import { dialPhone } from '../../utils/openExternal'
import { normalizeIndianPhone } from '../../utils/phone'
import DepotContactsModal from '../../components/ops/DepotContactsModal'

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
  // Head / admin see the whole NETWORK ticket queue (they own no depots); exec sees own.
  const isHead = ['operation_head', 'admin', 'co_owner'].includes(profile?.role)
  const isDesktop = useIsDesktop()
  const gridWrap = { display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(320px, 1fr))' : '1fr', gap: 14, alignItems: 'start' }
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const nm = (row, base) => (lang === 'gu' ? row?.[`${base}_gu`] : row?.[`${base}_en`]) || row?.[`${base}_en`] || ''

  const [params] = useSearchParams()
  const TAB_KEYS = isHead ? ['open', 'proc', 'fixed'] : ['open', 'proc', 'fixed', 'mystats']   // head has no personal "Me" tab (his pay is on /ops-performance)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // Deep-link the tab from ?tab= (home In-process / Fixed tiles land here).
  const [tab, setTab] = useState(() => (TAB_KEYS.includes(params.get('tab')) ? params.get('tab') : 'open'))
  useEffect(() => { const p = params.get('tab'); if (TAB_KEYS.includes(p)) setTab(p) }, [params])
  const [cityId, setCityId] = useState('')      // '' = all my stations
  const [onHours, setOnHours] = useState(isOnHours())   // 7 AM–9 PM window (F4)

  const [depots, setDepots] = useState([])
  const [issueTypes, setIssueTypes] = useState([])
  const [contactsByDepot, setContactsByDepot] = useState({})
  const [screens, setScreens] = useState([])
  const [proc, setProc] = useState([])
  const [assignedTk, setAssignedTk] = useState([])   // Phase 417: faults the system / head gave this tech (auto offline, camera, photo asked)
  const [offByDepot, setOffByDepot] = useState({})   // live count of screens offline right now, per station (Phase 419)
  const navigate = useNavigate()
  const [fixed, setFixed] = useState([])
  const [callsByTicket, setCallsByTicket] = useState({})
  const [stats, setStats] = useState(null)

  const [sheet, setSheet] = useState(null)
  const [issueId, setIssueId] = useState('')
  const [otherText, setOtherText] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const fileRef = useRef(null)

  const [fixFor, setFixFor] = useState(null)      // ticket being closed (after-fix photo sheet)
  const [fixPhoto, setFixPhoto] = useState(null)
  const fixFileRef = useRef(null)
  const [cantFor, setCantFor] = useState(null)    // ticket the technician cannot fix
  const [cantText, setCantText] = useState('')
  const [callFor, setCallFor] = useState(null)
  const [contactsFor, setContactsFor] = useState(null)   // { id, name } of the station whose number sheet is open
  const [outcome, setOutcome] = useState('')
  const [callNote, setCallNote] = useState('')

  const savingRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!uid) return
    try {
      let dQ = supabase.from('ops_depots').select('id, name, assigned_to').eq('is_active', true).order('name')
      if (!isHead) dQ = dQ.eq('assigned_to', uid)   // head → all stations; exec → own
      const dRes = await dQ
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

      // proc/fixed: head sees the whole team's manual tickets; exec sees own.
      let pQ = supabase.from('ops_tickets')
        .select('id, screen_id, depot_id, cause, notes, created_at, cant_fix_reason, issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en, issue_gu), screen:ops_screens!ops_tickets_screen_id_fkey(name), depot:ops_depots!ops_tickets_depot_id_fkey(name)')
        .eq('source', 'manual').eq('status', 'in_progress').order('created_at', { ascending: false })
      let fQ = supabase.from('ops_tickets')
        .select('id, screen_id, depot_id, cause, notes, resolved_at, issue:ops_issue_types!ops_tickets_issue_type_id_fkey(issue_en, issue_gu), screen:ops_screens!ops_tickets_screen_id_fkey(name), depot:ops_depots!ops_tickets_depot_id_fkey(name)')
        .eq('source', 'manual').eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(isHead ? 60 : 30)
      if (!isHead) { pQ = pQ.eq('assigned_to', uid); fQ = fQ.eq('assigned_to', uid) }

      if (!isHead) {
        supabase.from('ops_tickets')
          .select('id, source, status, created_at, depot_id, depot:ops_depots!ops_tickets_depot_id_fkey(name)')
          .eq('assigned_to', uid).in('status', ['open', 'in_progress']).in('source', ['auto_offline', 'auto_camera', 'sales_request'])
          .order('created_at', { ascending: true }).limit(60)
          .then(({ data }) => setAssignedTk(data || []))
        supabase.from('ops_screens').select('depot_id').in('depot_id', depotIds).eq('is_active', true).eq('status', 'offline')
          .then(({ data }) => { const m = {}; (data || []).forEach(r => { m[r.depot_id] = (m[r.depot_id] || 0) + 1 }); setOffByDepot(m) })
      } else setAssignedTk([])
      const [scr, it, ct, pRes, fRes] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status, depot_id, last_response_at').in('depot_id', depotIds).eq('is_active', true).eq('status', nowOn ? 'offline' : 'online'),
        supabase.from('ops_issue_types').select('id, issue_en, issue_gu, solution_en, solution_gu, display_order').eq('is_active', true).order('display_order'),
        supabase.from('ops_depot_contacts').select('id, depot_id, role_en, role_gu, name, phone, display_order').in('depot_id', depotIds).order('display_order'),
        pQ,
        fQ,
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
  // Phase 506: "faulty N times" per screen (history view, own RLS scope). Best-effort: a failure just hides the counts.
  const [faultCounts, setFaultCounts] = useState({})
  const faultIdsKey = cityScreens.map(s => s.id).join(',')
  useEffect(() => {
    let alive = true
    const ids = faultIdsKey ? faultIdsKey.split(',') : []
    if (!ids.length) { setFaultCounts({}); return undefined }
    supabase.from('ops_screen_fault_counts').select('screen_id, faults_total').in('screen_id', ids.slice(0, 300))
      .then(({ data, error }) => { if (alive && !error) setFaultCounts(Object.fromEntries((data || []).map(r => [r.screen_id, Number(r.faults_total) || 0]))) }, () => {})
    return () => { alive = false }
  }, [faultIdsKey])
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
      // one screen = one open job: skip screens that already have a manual ticket in process
      const { data: dup } = await supabase.from('ops_tickets').select('screen_id').eq('source', 'manual').eq('status', 'in_progress').in('screen_id', sheet.screenIds)
      const busyIds = new Set((dup || []).map(r => r.screen_id))
      const screenIds = sheet.screenIds.filter(id => !busyIds.has(id))
      if (!screenIds.length) { toastError(new Error(''), t('already_in_proc', lang)); return }
      let photo_path = null
      if (photoFile) {
        const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase()
        const key = `${sheet.depotId}/${Date.now()}.${ext}`
        const up = await supabase.storage.from('ops-photos').upload(key, photoFile, { upsert: false })
        if (up.error) { toastError(up.error, t('save_failed', lang)); return }
        photo_path = key
      }
      const preset = issueId !== 'other' ? issueTypes.find(x => x.id === issueId) : null
      const rows = screenIds.map(sid => ({
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

  function startCall(ticket, contact) {
    const c = contact || (contactsByDepot[ticket.depot_id] || [])[0] || null
    if (c?.phone) dialPhone(normalizeIndianPhone(c.phone).value || c.phone)
    setCallFor({ ticket, contact: c }); setOutcome(''); setCallNote('')
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
    setFixPhoto(null); if (fixFileRef.current) fixFileRef.current.value = ''
    setFixFor(ticket)
  }

  async function doFix(withPhoto) {
    if (savingRef.current || busy || !fixFor) return
    if (withPhoto && !fixPhoto) { toastError(new Error(''), t('fix_photo_hint', lang)); return }
    savingRef.current = true; setBusy(true)
    try {
      let fix_photo_path = null
      if (withPhoto && fixPhoto) {
        const ext = (fixPhoto.name.split('.').pop() || 'jpg').toLowerCase()
        const key = `${fixFor.depot_id}/fix-${Date.now()}.${ext}`
        const up = await supabase.storage.from('ops-photos').upload(key, fixPhoto, { upsert: false })
        if (up.error) { toastError(up.error, t('save_failed', lang)); return }
        fix_photo_path = key
      }
      const { error } = await supabase.from('ops_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString(), cant_fix_reason: null, ...(fix_photo_path ? { fix_photo_path } : {}) }).eq('id', fixFor.id)
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('fixed_word', lang)); setFixFor(null); setTab('fixed'); await load()
    } finally { setBusy(false); savingRef.current = false }
  }

  async function sendCantFix() {
    if (savingRef.current || busy || !cantFor) return
    if (cantText.trim().length < 3) { toastError(new Error(''), t('cant_fix_ph', lang)); return }
    savingRef.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc('ops_ticket_cant_fix', { p_ticket: cantFor.id, p_reason: cantText.trim() })
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('cant_fix_sent', lang)); setCantFor(null); setCantText(''); await load()
    } finally { setBusy(false); savingRef.current = false }
  }

  // Phase 419: close an auto fault (offline / camera) from the "Assigned to you" block.
  // The database refuses while a screen at the station is still offline - show that in plain words.
  async function markAutoFixed(a) {
    if (busy) return
    setBusy(true)
    try {
      if (a.status === 'open') {
        const { error: e1 } = await supabase.rpc('ops_ticket_start', { p_ticket: a.id })
        if (e1) { toastError(e1, t('save_failed', lang)); return }
      }
      const { error } = await supabase.rpc('ops_ticket_resolve', { p_ticket: a.id, p_cause: null, p_notes: null })
      if (error) { toastError(error, t('cannot_close_off', lang)); return }
      toastSuccess(t('fixed_word', lang)); await load()
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
  const tabs = [['open', t('tab_open', lang), 'var(--danger)'], ['proc', t('tab_proc', lang), 'var(--warning)'], ['fixed', t('tab_fixed', lang), 'var(--success)'], ...(isHead ? [] : [['mystats', t('tab_mystats', lang), '']])]

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

      {tab === 'open' && OpenTab()}
      {tab === 'proc' && ProcTab()}
      {tab === 'fixed' && FixedTab()}
      {tab === 'mystats' && MeTab()}

      {sheet && IssueSheet()}
      {callFor && CallSheet()}
      {fixFor && FixSheet()}
      {cantFor && CantSheet()}
      {contactsFor && (
        <DepotContactsModal depot={contactsFor} lang={lang} meId={uid} canDeleteAll={isHead}
          onClose={() => setContactsFor(null)} onChanged={load} />
      )}
    </div>
  )

  function empty(txt) { return <div style={{ textAlign: 'center', padding: '52px 12px', color: 'var(--text-muted)', fontSize: 14 }}>{txt}</div> }

  function OpenTab() {
    // F4: one worst-first fault list (no grouped/individual toggle — the double
    // scroll is gone). Off-hours + no timer faults = the "all quiet" good state.
    // a station already shown in the live list below must not appear twice: keep only
    // photo requests, and faults for stations with no live row below (e.g. camera-only).
    const liveDepots = new Set(cityScreens.map(sc => sc.depot_id))
    const assignedShown = assignedTk.filter(a => a.source === 'sales_request' || !liveDepots.has(a.depot_id))
    const assignedBlock = assignedShown.length > 0 && (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t('assigned_to_you', lang)} <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>{assignedShown.length}</span></div>
        <div style={gridWrap}>{assignedShown.map(a => {
          const kind = a.source === 'auto_camera' ? t('kind_camera', lang) : a.source === 'sales_request' ? t('kind_photo', lang) : t('kind_offline', lang)
          const days = Math.max(0, Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000))
          return (
            <button key={a.id} type="button" className="lead-card" onClick={() => a.depot_id && navigate(`/ops-fix/${a.depot_id}`)}
              style={{ padding: 14, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{a.depot?.name || depotName(a.depot_id)}</span>
                {chip(a.status === 'in_progress' ? t('tab_proc', lang) : kind, a.status === 'in_progress' ? 'amber' : 'danger')}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>{kind}{days > 0 ? ` · ${days}d` : ''}</div>
              {a.source !== 'sales_request' && (() => {
                const off = offByDepot[a.depot_id] || 0
                return off > 0
                  ? <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>{off} {t('screens_off_now', lang)}</div>
                  : <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>{t('all_working_now', lang)}</span>
                      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); markAutoFixed(a) }}
                        style={{ background: 'var(--success)', color: '#fff', borderRadius: 999, padding: '8px 14px', fontSize: 13, fontWeight: 700, minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>{t('mark_fixed', lang)}</span>
                    </div>
              })()}
            </button>
          )
        })}</div>
      </div>
    )
    if (!cityScreens.length) return <>{assignedBlock}{empty(t(onHours ? 'no_open' : 'all_quiet', lang))}</>

    // group by station, then rank stations worst-first (severity, then age)
    const byDepot = {}; cityScreens.forEach(s => { (byDepot[s.depot_id] = byDepot[s.depot_id] || []).push(s) })
    const rows = Object.entries(byDepot).map(([did, list]) => {
      const oldest = onHours ? Math.max(...list.map(s => faultAgeHours(s.last_response_at))) : 0
      const sev = onHours ? severityOf(oldest, list.length) : (list.length >= 5 ? 2 : 1)
      return { did, list, oldest, sev }
    }).sort((a, b) => b.sev - a.sev || b.oldest - a.oldest)

    const SEV = { 2: 'var(--danger)', 1: 'var(--warning)', 0: 'var(--text-subtle, var(--text-muted))' }
    return (
      <>{assignedBlock}<div style={gridWrap}>{rows.map(r => {
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
              {(() => {
                const rep = r.list.filter(x => (faultCounts[x.id] || 0) >= 2).sort((a, b) => (faultCounts[b.id] || 0) - (faultCounts[a.id] || 0)).slice(0, 2)
                return rep.length ? <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 3 }}>{rep.map(x => `${x.name || t('screen', lang)} - ${faultCounts[x.id]}x`).join(' · ')} {lang === 'gu' ? 'ખરાબ થયેલ' : 'faulty before'}</div> : null
              })()}
            </div>
            <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </button>
        )
      })}</div></>
    )
  }

  function ProcTab() {
    if (!cityProc.length) return empty(t('no_proc', lang))
    return <div style={gridWrap}>{cityProc.map(tk => {
      const calls = callsByTicket[tk.id] || []
      const cs = contactsByDepot[tk.depot_id] || []
      const contact = cs[0]
      const rest = cs.slice(1)
      const addTarget = { id: tk.depot_id, name: tk.depot?.name || depotName(tk.depot_id) }
      const canAdd = isHead || depots.some(d => d.id === tk.depot_id)   // an exec can only add at a station he owns (RLS enforces the same)
      return (
        <div key={tk.id} className="lead-card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{tk.screen?.name || (t('screen', lang) + ' ' + (screenNo[tk.screen_id] || ''))}</span>
            {chip(t('in_process', lang), 'amber')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 12px' }}>{tk.depot?.name || depotName(tk.depot_id)} · {tk.issue ? nm(tk.issue, 'issue') : (tk.cause || t('fault', lang))}</div>
          {contact ? (
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5 }}><Phone size={13} style={{ verticalAlign: -1, marginRight: 5, color: 'var(--text-muted)' }} />
                {contact.name || nm(contact, 'role') || t('call', lang)}
                <br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[contact.name ? nm(contact, 'role') : null, contact.phone].filter(Boolean).join(' · ')}</span>
              </span>
              {contact.phone && <button onClick={() => startCall(tk, contact)} className="lead-btn" style={{ color: 'var(--success)', borderColor: 'var(--success)', flexShrink: 0 }}><Phone size={14} /> {t('call', lang)}</button>}
            </div>
          ) : canAdd ? (
            <button onClick={() => setContactsFor(addTarget)} className="lead-btn lead-btn-primary" style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}><Plus size={14} /> {t('no_contacts_add', lang)}</button>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>{t('no_contacts', lang)}</div>
          )}
          {rest.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}><ChevronRight size={14} />{t('more_numbers', lang)} ({rest.length})</summary>
              {rest.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 2px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13 }}>{c.name || nm(c, 'role')}<br /><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{[c.name ? nm(c, 'role') : null, c.phone].filter(Boolean).join(' · ')}</span></span>
                  {c.phone && <button onClick={() => startCall(tk, c)} className="lead-btn" style={{ color: 'var(--success)', borderColor: 'var(--success)', flexShrink: 0, minHeight: 44 }}><Phone size={14} /> {t('call', lang)}</button>}
                </div>
              ))}
            </details>
          )}
          {contact && canAdd && <button onClick={() => setContactsFor(addTarget)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '10px 0 0', minHeight: 44 }}>{t('add_number_cta', lang)}</button>}
          {calls.length > 0 && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10 }}>{calls.length} {t('n_calls', lang)} · {calls[0].notes || calls[0].outcome}</div>}
          {tk.cant_fix_reason && <div style={{ marginTop: 10, background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 10, padding: '8px 10px', fontSize: 13, fontWeight: 600 }}>{t('cant_fix_tag', lang)}: {tk.cant_fix_reason}</div>}
          {!isHead && <button onClick={() => { setCantText(''); setCantFor(tk) }} disabled={busy} className="lead-btn" style={{ width: '100%', justifyContent: 'center', minHeight: 44, marginTop: 10, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{t('cant_fix', lang)}</button>}
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

  function FixSheet() {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setFixFor(null)}>
        <div className="lead-card" style={{ width: '100%', maxWidth: 480, margin: 0, borderRadius: '16px 16px 0 0', padding: 16 }} onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{t('fix_photo_title', lang)}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{t('fix_photo_hint', lang)}</div>
          <input ref={fixFileRef} type="file" accept="image/*" capture="environment" onChange={e => setFixPhoto(e.target.files?.[0] || null)} style={{ display: 'none' }} />
          <button onClick={() => fixFileRef.current?.click()} style={{ ...fieldSel, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, color: fixPhoto ? 'var(--success)' : 'var(--text)' }}>{fixPhoto ? <Check size={18} /> : <Camera size={18} />}{fixPhoto ? t('photo_added', lang) : t('upload_photo', lang)}</button>
          <button onClick={() => doFix(true)} disabled={busy || !fixPhoto} className="lead-btn lead-btn-primary" style={{ width: '100%', marginTop: 12, justifyContent: 'center', minHeight: 48, opacity: fixPhoto ? 1 : .5 }}>{busy ? t('saving', lang) : t('fix_with_photo', lang)}</button>
          <button onClick={() => doFix(false)} disabled={busy} className="lead-btn" style={{ width: '100%', marginTop: 8, justifyContent: 'center', minHeight: 44 }}>{t('fix_no_photo', lang)}</button>
        </div>
      </div>
    )
  }

  function CantSheet() {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setCantFor(null)}>
        <div className="lead-card" style={{ width: '100%', maxWidth: 480, margin: 0, borderRadius: '16px 16px 0 0', padding: 16 }} onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>{t('cant_fix_title', lang)}</div>
          <textarea value={cantText} onChange={e => setCantText(e.target.value)} rows={3} placeholder={t('cant_fix_ph', lang)} style={{ ...fieldSel, resize: 'none' }} />
          <button onClick={sendCantFix} disabled={busy} className="lead-btn lead-btn-primary" style={{ width: '100%', marginTop: 12, justifyContent: 'center', minHeight: 48 }}>{busy ? t('saving', lang) : t('cant_fix_send', lang)}</button>
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
