// src/pages/v2/OpsTicketsV2.jsx — the operation_executive's home (owner-approved
// mockup, 2026-08-27). Assigned-city filter + 3 tabs: Open (offline screens ->
// pick issue -> ticket) / In process (call the contact, recorded like sales) /
// Fixed. Consolidates the Down-now offline view + Log-issue + the old queue.
// Reuses ops_screens/ops_depots/ops_issue_types/ops_tickets/ops_depot_contacts +
// call_logs (ops_ticket_id). Gujarati-first (§231). Not §28-frozen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MapPin, Phone, AlertTriangle, ChevronRight, Camera, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { istTodayISO } from '../../utils/istDate'

const card  = { background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)', borderRadius: 14, padding: 14 }
const lbl   = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--v2-ink-2, #94a3b8)', display: 'block', marginBottom: 6 }
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-0, #f1f5f9)', border: '1px solid var(--v2-line, #334155)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }
const yellow = 'var(--v2-yellow, #FFE600)'
const ink2  = 'var(--v2-ink-2, #94a3b8)'

// Map an ops outcome label -> the sales call_logs.outcome enum (never widen the enum).
const OUTCOME_DB = { reached: 'connected', will_come: 'connected', fixed_call: 'connected', no_answer: 'no_answer' }

// Indicative variable pay from uptime — mirrors the §233 OpsAdmin curve + the
// §230/§184 70/30 model (display-only; real pay = the salary sheet). uptimePct is
// the raw uptime %; the 90->97 SLA transform, then >75 full / <50 zero / else linear.
function estVariable(salary, uptimePct) {
  if (!salary || uptimePct == null) return 0
  const sla = Math.max(0, Math.min(100, (uptimePct - 90) / 7 * 100))
  const factor = sla > 75 ? 1 : sla < 50 ? 0 : sla / 100
  return Math.round(salary * 0.30 * factor)
}

export default function OpsTicketsV2() {
  const { profile } = useAuth()
  const uid = profile?.id
  const isDesktop = useIsDesktop()
  const gridWrap = { display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(340px, 1fr))' : '1fr', gap: 12, alignItems: 'start' }
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const nm = (row, base) => (lang === 'gu' ? row?.[`${base}_gu`] : row?.[`${base}_en`]) || row?.[`${base}_en`] || ''

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('open')
  const [cityId, setCityId] = useState('')      // '' = all my stations
  const [grouped, setGrouped] = useState(true)

  const [depots, setDepots] = useState([])       // my assigned depots
  const [issueTypes, setIssueTypes] = useState([])
  const [contactsByDepot, setContactsByDepot] = useState({})
  const [screens, setScreens] = useState([])     // offline screens in my depots
  const [proc, setProc] = useState([])           // my in_progress manual tickets
  const [fixed, setFixed] = useState([])         // my resolved manual tickets
  const [callsByTicket, setCallsByTicket] = useState({})
  const [stats, setStats] = useState(null)       // Me tab: { monthly, base, variable, hasPay, uptimePct, up, down, fixedMo, avgFixH, callsMo, callsToday }

  const [sheet, setSheet] = useState(null)       // { screenIds:[], depotId } | null
  const [issueId, setIssueId] = useState('')
  const [otherText, setOtherText] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const fileRef = useRef(null)

  const [callFor, setCallFor] = useState(null)   // { ticket, contact } | null
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

      const [scr, it, ct, pRes, fRes] = await Promise.all([
        supabase.from('ops_screens').select('id, name, status, depot_id').in('depot_id', depotIds).eq('is_active', true).eq('status', 'offline'),
        supabase.from('ops_issue_types').select('id, issue_en, issue_gu, display_order').eq('is_active', true).order('display_order'),
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

      // Open = offline screens minus those already on an in-progress manual ticket
      const takenScreenIds = new Set(procRows.map(p => p.screen_id).filter(Boolean))
      setScreens((scr.data || []).filter(s => !takenScreenIds.has(s.id)))

      // call history for the in-process tickets
      const tIds = procRows.map(p => p.id)
      if (tIds.length) {
        const cl = await supabase.from('call_logs').select('id, ops_ticket_id, outcome, notes, call_at').in('ops_ticket_id', tIds).order('call_at', { ascending: false })
        const cbt = {}; (cl.data || []).forEach(r => { (cbt[r.ops_ticket_id] = cbt[r.ops_ticket_id] || []).push(r) }); setCallsByTicket(cbt)
      } else setCallsByTicket({})

      // ── Me tab (self-scoped; RPC + small reads) — best-effort, keeps prior on failure ──
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
  // stable per-depot screen numbers (Screen 1..N) across all offline screens of a depot
  const screenNo = useMemo(() => {
    const byD = {}; const m = {}
    screens.forEach(s => { byD[s.depot_id] = (byD[s.depot_id] || 0) + 1; m[s.id] = byD[s.depot_id] }); return m
  }, [screens])

  function openSheet(screenIds, depotId) { setSheet({ screenIds, depotId }); setIssueId(''); setOtherText(''); setNotes(''); setPhotoFile(null); if (fileRef.current) fileRef.current.value = '' }

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
        depot_id: sheet.depotId, screen_id: sid, assigned_to: uid,
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
    if (contact?.phone) window.location.href = `tel:${String(contact.phone).replace(/\s/g, '')}`  // user gesture
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
    // soft warn: still offline on the live CMS data?
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

  if (loading) return <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: ink2 }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>
  if (err) return <div style={{ padding: 20 }}><div style={{ background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '12px 16px' }}>{err} <button className="btn btn-sec btn-sm" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button></div></div>

  const cnt = { open: cityScreens.length, proc: cityProc.length, fixed: cityFixed.length }

  return (
    <div style={{ padding: '14px 14px 40px', maxWidth: isDesktop ? 1120 : 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{t('tickets_title', lang)}</span>
        <button onClick={flip} className="btn btn-ghost btn-sm" style={{ fontWeight: 700 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      {/* city filter */}
      <label style={{ ...lbl, marginBottom: 6 }}><MapPin size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{t('city', lang)}</label>
      <select value={cityId} onChange={e => setCityId(e.target.value)} style={{ ...field, borderColor: yellow, marginBottom: 12 }}>
        <option value="">{lang === 'gu' ? 'બધા સ્ટેશન' : 'All my stations'}</option>
        {depots.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>

      {/* tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--v2-line, #334155)', marginBottom: 14 }}>
        {[['open', t('tab_open', lang), 'var(--danger)'], ['proc', t('tab_proc', lang), 'var(--v2-amber, #F59E0B)'], ['fixed', t('tab_fixed', lang), 'var(--v2-green, #10B981)'], ['mystats', t('tab_mystats', lang), '']].map(([k, label, col]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? yellow : 'transparent'}`, padding: '9px 0', fontSize: 13, fontWeight: tab === k ? 700 : 400, color: tab === k ? 'var(--v2-ink-0, #f1f5f9)' : ink2, cursor: 'pointer' }}>
            {label}{col ? <> <span style={{ color: col }}>{cnt[k]}</span></> : null}
          </button>
        ))}
      </div>

      {tab === 'open' && <OpenTab />}
      {tab === 'proc' && <ProcTab />}
      {tab === 'fixed' && <FixedTab />}
      {tab === 'mystats' && <MeTab />}

      {sheet && <IssueSheet />}
      {callFor && <CallSheet />}
    </div>
  )

  function empty(txt) { return <div style={{ textAlign: 'center', padding: '48px 12px', color: ink2 }}>{txt}</div> }

  function OpenTab() {
    if (!cityScreens.length) return empty(t('no_open', lang))
    const byDepot = {}; cityScreens.forEach(s => { (byDepot[s.depot_id] = byDepot[s.depot_id] || []).push(s) })
    return (
      <>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={() => setGrouped(true)}  className="btn btn-sm" style={{ flex: 1, ...(grouped ? { borderColor: yellow, color: yellow } : {}) }}>{t('grouped', lang)}</button>
          <button onClick={() => setGrouped(false)} className="btn btn-sm" style={{ flex: 1, ...(!grouped ? { borderColor: yellow, color: yellow } : {}) }}>{t('individual', lang)}</button>
        </div>
        <div style={gridWrap}>{grouped
          ? Object.entries(byDepot).map(([did, list]) => (
            <div key={did} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{depotName(did)}</span>
                <span style={{ fontSize: 11, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', borderRadius: 999, padding: '2px 8px' }}>{list.length} {t('down_word2', lang)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                {list.map(s => (
                  <button key={s.id} onClick={() => openSheet([s.id], did)} className="btn btn-sm" style={{ justifyContent: 'space-between', minHeight: 44 }}>
                    <span>{t('screen', lang)} {screenNo[s.id]}</span><AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
                  </button>
                ))}
              </div>
              <button onClick={() => openSheet(list.map(s => s.id), did)} className="btn btn-sm" style={{ width: '100%', marginTop: 10, borderColor: yellow, color: yellow }}>{t('log_whole', lang)}</button>
            </div>
          ))
          : cityScreens.map(s => (
            <button key={s.id} onClick={() => openSheet([s.id], s.depot_id)} className="btn" style={{ width: '100%', justifyContent: 'space-between', padding: 12, minHeight: 48 }}>
              <span style={{ textAlign: 'left' }}><span style={{ fontWeight: 600 }}>{t('screen', lang)} {screenNo[s.id]}</span><br /><span style={{ fontSize: 12, color: ink2 }}>{depotName(s.depot_id)}</span></span>
              <ChevronRight size={16} />
            </button>
          ))}</div>
      </>
    )
  }

  function ProcTab() {
    if (!cityProc.length) return empty(t('no_proc', lang))
    return <div style={gridWrap}>{cityProc.map(tk => {
      const calls = callsByTicket[tk.id] || []
      const contact = (contactsByDepot[tk.depot_id] || [])[0]
      return (
        <div key={tk.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{tk.screen?.name || (t('screen', lang) + ' ' + (screenNo[tk.screen_id] || ''))}</span>
            <span style={{ fontSize: 11, background: 'var(--warning-soft, rgba(245,158,11,.12))', color: 'var(--v2-amber, #F59E0B)', borderRadius: 999, padding: '2px 8px' }}>{t('in_process', lang)}</span>
          </div>
          <div style={{ fontSize: 12, color: ink2, margin: '2px 0 10px' }}>{tk.depot?.name || depotName(tk.depot_id)} · {tk.issue ? nm(tk.issue, 'issue') : (tk.cause || t('fault', lang))}</div>
          <div style={{ background: 'var(--v2-bg-2, #0f172a)', borderRadius: 10, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}><Phone size={13} style={{ verticalAlign: -1, marginRight: 4 }} />{contact?.name || t('no_contacts', lang)}<br /><span style={{ fontSize: 12, color: ink2 }}>{contact ? ((lang === 'gu' ? contact.role_gu : contact.role_en) || contact.role_en || '') + ' · ' + (contact.phone || '') : ''}</span></span>
            {contact && <button onClick={() => startCall(tk)} className="btn btn-sm" style={{ borderColor: 'var(--v2-green, #10B981)', color: 'var(--v2-green, #10B981)' }}><Phone size={14} /> {t('call', lang)}</button>}
          </div>
          {calls.length > 0 && <div style={{ fontSize: 12, color: ink2, marginTop: 8 }}>{calls.length} {t('n_calls', lang)} · {calls[0].notes || calls[0].outcome}</div>}
          <button onClick={() => markFixed(tk)} disabled={busy} className="btn btn-sm" style={{ width: '100%', marginTop: 10 }}>{t('mark_fixed', lang)} <Check size={14} /></button>
        </div>
      )
    })}</div>
  }

  function FixedTab() {
    if (!cityFixed.length) return empty(t('no_fixed', lang))
    return <div style={gridWrap}>{cityFixed.map(f => (
      <div key={f.id} style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{f.screen?.name || t('screen', lang)}</span>
          <span style={{ fontSize: 11, background: 'var(--success-soft, rgba(16,185,129,.12))', color: 'var(--v2-green, #10B981)', borderRadius: 999, padding: '2px 8px' }}>{t('fixed_word', lang)}</span>
        </div>
        <div style={{ fontSize: 12, color: ink2, marginTop: 2 }}>{f.depot?.name || depotName(f.depot_id)} · {f.issue ? nm(f.issue, 'issue') : (f.cause || t('fault', lang))}</div>
        {f.resolved_at && <div style={{ fontSize: 11, color: ink2, marginTop: 6 }}>{new Date(f.resolved_at).toLocaleString('en-GB')}</div>}
      </div>
    ))}</div>
  }

  function MeTab() {
    const s = stats
    const byDepot = {}; screens.forEach(sc => { byDepot[sc.depot_id] = (byDepot[sc.depot_id] || 0) + 1 })
    const worst = Object.entries(byDepot).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const ring = s?.uptimePct != null ? s.uptimePct : 0
    const total = (s?.base || 0) + (s?.variable || 0)
    return (
      <div style={gridWrap}>
        {/* my salary */}
        <div style={{ ...card, background: 'var(--success-soft, rgba(16,185,129,.12))' }}>
          <div style={{ fontSize: 12, color: 'var(--v2-green, #10B981)' }}>{t('my_salary_mo', lang)}</div>
          {s?.monthly ? <>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--v2-green, #10B981)' }}>₹{total.toLocaleString('en-IN')}</div>
            <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11, color: 'var(--v2-green, #10B981)' }}>
              <span>{t('sal_base', lang)} ₹{(s.base).toLocaleString('en-IN')}</span>
              <span>+ {t('sal_variable', lang)} ₹{(s.variable).toLocaleString('en-IN')}{!s.hasPay ? ` · ${t('var_fills', lang)}` : ''}</span>
            </div>
          </> : <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--v2-green, #10B981)', marginTop: 4 }}>{t('no_stats', lang)}</div>}
        </div>
        {/* uptime + my calls */}
        <div style={{ ...card, display: 'flex', gap: 12 }}>
          <div style={{ width: 88, height: 88, flexShrink: 0, borderRadius: '50%', background: `conic-gradient(var(--v2-green, #10B981) 0 ${ring}%, var(--v2-bg-2, #0f172a) ${ring}% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'var(--v2-bg-1, #1e293b)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 20, fontWeight: 700 }}>{s?.uptimePct != null ? `${s.uptimePct}%` : '—'}</span>
              <span style={{ fontSize: 10, color: ink2 }}>{t('uptime_short', lang)}</span>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: ink2 }}>{t('my_calls', lang)}</span>
            <span style={{ fontSize: 24, fontWeight: 700 }}>{s?.callsMo ?? 0}</span>
            <span style={{ fontSize: 11, color: ink2 }}>{t('calls_month', lang)} · {s?.callsToday ?? 0} {t('calls_today', lang)}</span>
          </div>
        </div>
        {/* stations + fixed */}
        <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: ink2 }}>{t('my_stations', lang)}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{depots.length}</div>
            <div style={{ fontSize: 11, color: ink2 }}><span style={{ color: 'var(--v2-green, #10B981)' }}>{s?.up ?? 0} {t('up_word', lang)}</span> · <span style={{ color: 'var(--danger)' }}>{s?.down ?? 0} {t('down_word2', lang)}</span></div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: ink2 }}>{t('fixed_this_mo', lang)}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s?.fixedMo ?? 0}</div>
            <div style={{ fontSize: 11, color: ink2 }}>{s?.avgFixH != null ? `${t('avg_fix', lang)} ${s.avgFixH}${t('hrs', lang)}` : '—'}</div>
          </div>
        </div>
        {/* worst stations */}
        {worst.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 12, color: ink2, marginBottom: 8 }}>{t('worst_now', lang)}</div>
            {worst.map(([did, n], i) => (
              <div key={did} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: i ? '1px solid var(--v2-line, #334155)' : 'none' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{depotName(did)}</span>
                <span style={{ fontSize: 11, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', borderRadius: 999, padding: '2px 10px' }}>{n} {t('down_word2', lang)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--v2-ink-3, #64748b)', textAlign: 'center' }}>{t('scoped_note', lang)}</div>
      </div>
    )
  }

  function IssueSheet() {
    const n = sheet.screenIds.length
    const label = n > 1 ? `${n} ${t('screen', lang)} · ${depotName(sheet.depotId)}` : `${t('screen', lang)} ${screenNo[sheet.screenIds[0]] || ''} · ${depotName(sheet.depotId)}`
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9000, display: 'flex', alignItems: 'flex-end' }} onClick={() => setSheet(null)}>
        <div style={{ ...card, width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '16px 16px 0 0', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{t('offline', lang)}</div>
          <label style={lbl}>{t('cause', lang)}</label>
          <select value={issueId} onChange={e => setIssueId(e.target.value)} style={field}>
            <option value="">{t('pick_issue', lang)}</option>
            {issueTypes.map(it => <option key={it.id} value={it.id}>{nm(it, 'issue')}</option>)}
            <option value="other">{t('other_issue', lang)}</option>
          </select>
          {issueId === 'other' && <input value={otherText} onChange={e => setOtherText(e.target.value)} placeholder={t('cause_ph', lang)} style={{ ...field, marginTop: 8 }} />}
          <label style={{ ...lbl, marginTop: 12 }}>{t('notes', lang)}</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t('notes_ph', lang)} style={{ ...field, resize: 'none' }} />
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={e => setPhotoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ ...field, marginTop: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: photoFile ? 'var(--v2-green, #10B981)' : 'var(--v2-ink-1, #cbd5e1)' }}>{photoFile ? <Check size={18} /> : <Camera size={18} />}{photoFile ? t('photo_added', lang) : t('upload_photo', lang)}</button>
          <button onClick={submitIssue} disabled={busy} style={{ width: '100%', marginTop: 12, padding: 13, borderRadius: 10, border: 'none', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1, background: yellow, color: 'var(--v2-ink-on-yellow, #0f172a)' }}>{busy ? t('saving', lang) : t('submit_proc', lang)}</button>
        </div>
      </div>
    )
  }

  function CallSheet() {
    const c = callFor.contact
    const outs = [['reached', t('out_reached', lang)], ['no_answer', t('out_no_answer', lang)], ['will_come', t('out_will_come', lang)], ['fixed_call', t('out_fixed_call', lang)]]
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 9000, display: 'flex', alignItems: 'flex-end' }} onClick={() => setCallFor(null)}>
        <div style={{ ...card, width: '100%', maxWidth: 480, margin: '0 auto', borderRadius: '16px 16px 0 0' }} onClick={e => e.stopPropagation()}>
          <div style={{ textAlign: 'center', padding: '4px 0 14px' }}>
            <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--success-soft, rgba(16,185,129,.12))', margin: '0 auto 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Phone size={24} style={{ color: 'var(--v2-green, #10B981)' }} /></div>
            <div style={{ fontWeight: 700 }}>{t('calling', lang)} {c?.name || ''}</div>
            <div style={{ fontSize: 12, color: ink2 }}>{c ? ((lang === 'gu' ? c.role_gu : c.role_en) || c.role_en || '') + ' · ' + (c.phone || '') : ''}</div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-3, #64748b)', marginTop: 3 }}>{t('recorded_auto', lang)}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t('call_ended_q', lang)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {outs.map(([k, label]) => <button key={k} onClick={() => setOutcome(k)} className="btn btn-sm" style={outcome === k ? { borderColor: yellow, color: yellow } : {}}>{label}</button>)}
          </div>
          <textarea value={callNote} onChange={e => setCallNote(e.target.value)} rows={2} placeholder={t('call_note_ph', lang)} style={{ ...field, resize: 'none', marginBottom: 12 }} />
          <button onClick={saveCall} disabled={busy} style={{ width: '100%', padding: 13, borderRadius: 10, border: 'none', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? .6 : 1, background: yellow, color: 'var(--v2-ink-on-yellow, #0f172a)' }}>{busy ? t('saving', lang) : t('save_call', lang)}</button>
        </div>
      </div>
    )
  }
}
