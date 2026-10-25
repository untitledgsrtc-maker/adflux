// src/pages/v2/OpsFixV2.jsx — the technician's ONE station screen (/ops-fix/:depotId).
// Owner-approved flow (mockup _design_reference/ops_technician_flow_mockup.html, 2026-10-25):
//   LOG      which screens are off → what is wrong (reason chips, or a different reason
//            for a few screens) → WHO TO CALL for that reason appears → notes + photo
//            (optional) → "Called, start work" (tickets go In process).
//   IN PROCESS  "N of M back online" live, "fixes itself after 30 min online", call again,
//            add a note, "Can't fix, tell office" (ops_ticket_cant_fix).
//   FIXED    tickets closed by the system (ops_faults_reconcile) or by the technician,
//            with downtime.
// All real: ops_screens / ops_depot_contacts / ops_issue_types / ops_tickets / call_logs.
// Gujarati-first (§231). Dark brand tokens only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ArrowLeft, Phone, WifiOff, Wifi, Check, Camera, AlertTriangle, Clock, Wrench } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { t, getOpsLang, setOpsLang, numL } from '../../utils/opsStrings'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { dialPhone } from '../../utils/openExternal'
import { normalizeIndianPhone } from '../../utils/phone'

// Labels used only on this page (kept local so the shared strings file is untouched).
const S = {
  tab_log: { gu: 'ખરાબી નોંધો', en: 'Log problem' },
  tab_proc: { gu: 'કામ ચાલુ', en: 'In process' },
  tab_fixed: { gu: 'ઠીક થયું', en: 'Fixed' },
  step1: { gu: '૧ · કયા સ્ક્રીન?', en: '1 · Which screens' },
  step2: { gu: '૨ · શું ખરાબી છે?', en: '2 · What is wrong' },
  step3: { gu: '૩ · નોંધ અને ફોટો', en: '3 · Note and photo' },
  optional: { gu: 'વૈકલ્પિક', en: 'optional' },
  all_off: { gu: 'બધા બંધ સ્ક્રીન', en: 'All off screens' },
  diff: { gu: 'થોડા સ્ક્રીન માટે અલગ કારણ', en: 'Different reason for a few screens' },
  same: { gu: 'બધા માટે એક જ કારણ', en: 'Same reason for all' },
  as_above: { gu: 'ઉપરના મુજબ', en: 'As above' },
  call_for: { gu: 'આ ખરાબી માટે ફોન કરો', en: 'Call for this problem' },
  start: { gu: 'ફોન કર્યો, કામ શરૂ કરો', en: 'Called, start work' },
  start_hint: { gu: 'ટિકિટ “કામ ચાલુ” માં જશે', en: 'The ticket moves to “In process”' },
  other: { gu: 'બીજું (લખો)', en: 'Other (type it)' },
  other_ph: { gu: 'ખરાબી લખો…', en: 'Type the problem…' },
  note_ph: { gu: 'કંઈ જણાવવું હોય તો લખો…', en: 'Write anything to tell…' },
  photo: { gu: 'ફોટો ઉમેરો (વૈકલ્પિક)', en: 'Add photo (optional)' },
  photo_ok: { gu: 'ફોટો ઉમેર્યો', en: 'Photo added' },
  back_on: { gu: 'પાછા ચાલુ', en: 'back online' },
  of: { gu: 'માંથી', en: 'of' },
  self_fix: { gu: 'સ્ક્રીન 30 મિનિટ સતત ચાલુ રહે એટલે ટિકિટ આપમેળે ઠીક થઈ જશે. તમારે કંઈ દબાવવાનું નથી.', en: 'When the screens stay online for 30 minutes the ticket fixes itself. You do not need to tap anything.' },
  call_again: { gu: 'ફરી ફોન કરો', en: 'Call again' },
  add_note: { gu: 'નોંધ ઉમેરો', en: 'Add note' },
  save_note: { gu: 'નોંધ સેવ કરો', en: 'Save note' },
  cant: { gu: 'ઠીક નથી થતું — ઓફિસને જણાવો', en: "Can't fix — tell the office" },
  cant_why: { gu: 'શું કારણ છે? (ઓફિસને જશે)', en: 'What is the reason? (goes to the office)' },
  send: { gu: 'મોકલો', en: 'Send' },
  fixed_now: { gu: 'જાતે ઠીક કર્યું', en: 'Mark fixed myself' },
  report_more: { gu: 'બીજી ખરાબી નોંધો', en: 'Report another problem' },
  no_proc: { gu: 'કોઈ કામ ચાલુ નથી.', en: 'No work in process.' },
  no_fixed: { gu: 'હજી કંઈ ઠીક થયું નથી.', en: 'Nothing fixed yet.' },
  all_ok: { gu: 'બધા સ્ક્રીન ચાલુ છે.', en: 'All screens are working.' },
  down_for: { gu: 'બંધ રહ્યા', en: 'was down' },
  fixed_auto: { gu: 'આપમેળે ઠીક', en: 'Fixed by itself' },
  fixed_by_you: { gu: 'તમે ઠીક કર્યું', en: 'You fixed it' },
  fix_steps: { gu: 'ઠીક કરવાના સ્ટેપ', en: 'Fix steps' },
  call_saved: { gu: 'ફોન નોંધાયો', en: 'Call recorded' },
  note_saved: { gu: 'નોંધ સેવ થઈ', en: 'Note saved' },
}
const T = (k, lang) => (S[k] ? (S[k][lang] || S[k].en) : k)

// Which kind of person to call for which problem. Matches the contact's role text
// (Electrician N / Depot office / Cleaning (safai) / Canteen). First match wins.
const CALL_RULES = [
  [/clean|bird|pigeon|nest|dust/i, /clean|safai|સફાઈ/i],
  [/bill|internet|ethernet|software|network/i, /depot|ડેપો|office/i],
  [/./, /electric|ઇલેક્ટ્રિશિયન/i],
]
function contactsFor(issueEn, contacts) {
  if (!contacts.length) return []
  for (const [issueRe, roleRe] of CALL_RULES) {
    if (!issueRe.test(issueEn || '')) continue
    const hit = contacts.filter(c => roleRe.test(`${c.role_en || ''} ${c.role_gu || ''}`))
    if (hit.length) return hit
  }
  return contacts.slice(0, 1)
}

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12 }
const label = { fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '16px 0 8px' }
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }

function hoursText(ms, lang) {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${numL(m, lang)} ${lang === 'gu' ? 'મિનિટ' : 'min'}`
  const h = Math.floor(m / 60), r = m % 60
  return `${numL(h, lang)} ${lang === 'gu' ? 'કલાક' : 'h'}${r ? ` ${numL(r, lang)} ${lang === 'gu' ? 'મિ' : 'm'}` : ''}`
}

export default function OpsFixV2() {
  const { depotId } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()
  const uid = profile?.id
  const isHead = ['operation_head', 'admin', 'co_owner'].includes(profile?.role)
  const [lang, setLang] = useState(getOpsLang())
  const flip = () => { const n = lang === 'gu' ? 'en' : 'gu'; setLang(n); setOpsLang(n) }
  const nm = (row, base) => (lang === 'gu' ? row?.[`${base}_gu`] : row?.[`${base}_en`]) || row?.[`${base}_en`] || ''

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [depot, setDepot] = useState(null)
  const [screens, setScreens] = useState([])        // every active screen of the station
  const [contacts, setContacts] = useState([])
  const [issueTypes, setIssueTypes] = useState([])
  const [proc, setProc] = useState([])              // manual tickets In process at this station
  const [fixed, setFixed] = useState([])            // last closed tickets
  const [tab, setTab] = useState(null)              // null = pick automatically after the first load

  // Log form
  const [picked, setPicked] = useState({})          // screenId -> true
  const [reasonId, setReasonId] = useState('')      // '' | issue id | 'other'
  const [otherText, setOtherText] = useState('')
  const [perScreen, setPerScreen] = useState(false)
  const [reasonBy, setReasonBy] = useState({})      // screenId -> issue id ('' = as above)
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const fileRef = useRef(null)
  const savingRef = useRef(false)
  const [busy, setBusy] = useState(false)

  // In-process extras
  const [noteText, setNoteText] = useState('')
  const [cantOpen, setCantOpen] = useState(false)
  const [cantText, setCantText] = useState('')

  const load = useCallback(async () => {
    if (!depotId || !uid) return
    try {
      let pQ = supabase.from('ops_tickets')
        .select('id, screen_id, cause, notes, created_at, cant_fix_reason, issue_type_id')
        .eq('depot_id', depotId).eq('source', 'manual').eq('status', 'in_progress').order('created_at', { ascending: true })
      let fQ = supabase.from('ops_tickets')
        .select('id, screen_id, cause, created_at, resolved_at, source, screen:ops_screens!ops_tickets_screen_id_fkey(name)')
        .eq('depot_id', depotId).eq('status', 'resolved').order('resolved_at', { ascending: false }).limit(8)
      if (!isHead) { pQ = pQ.eq('assigned_to', uid); fQ = fQ.eq('assigned_to', uid) }
      const [dRes, sRes, cRes, iRes, pRes, fRes] = await Promise.all([
        supabase.from('ops_depots').select('id, name').eq('id', depotId).eq('is_active', true).maybeSingle(),
        supabase.from('ops_screens').select('id, name, status').eq('depot_id', depotId).eq('is_active', true).order('name'),
        supabase.from('ops_depot_contacts').select('id, role_en, role_gu, name, phone, display_order').eq('depot_id', depotId).order('display_order'),
        supabase.from('ops_issue_types').select('id, issue_en, issue_gu, solution_en, solution_gu, display_order').eq('is_active', true).order('display_order'),
        pQ, fQ,
      ])
      const bad = [dRes, sRes, cRes, iRes, pRes, fRes].find(r => r.error)
      if (bad) throw bad.error
      setDepot(dRes.data || null)
      setScreens([...(sRes.data || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })))
      setContacts(cRes.data || [])
      setIssueTypes(iRes.data || [])
      setProc(pRes.data || [])
      setFixed(fRes.data || [])
      setErr('')
    } catch (e) { setErr(e?.message || 'load failed') }
  }, [depotId, uid, isHead])

  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false) })() }, [load])
  useAutoRefresh(load, { userId: uid, enabled: !!uid, pollSeconds: 60 })

  const procScreenIds = useMemo(() => new Set(proc.map(p => p.screen_id).filter(Boolean)), [proc])
  const offScreens = useMemo(() => screens.filter(s => s.status === 'offline' && !procScreenIds.has(s.id)), [screens, procScreenIds])
  const screenName = useCallback((s, i) => s?.name || `${t('screen', lang)} ${numL((i ?? 0) + 1, lang)}`, [lang])

  // Choose the first tab once: work in process → that; else something off → log; else fixed.
  useEffect(() => {
    if (loading || tab) return
    setTab(proc.length ? 'proc' : offScreens.length ? 'log' : 'fixed')
  }, [loading, tab, proc.length, offScreens.length])

  // Default: every off screen ticked (once, when the list first arrives).
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || !offScreens.length) return
    seededRef.current = true
    setPicked(Object.fromEntries(offScreens.map(s => [s.id, true])))
  }, [offScreens])

  const pickedIds = offScreens.filter(s => picked[s.id]).map(s => s.id)
  const issueOf = (id) => issueTypes.find(x => x.id === id) || null
  const reasonIssue = reasonId && reasonId !== 'other' ? issueOf(reasonId) : null
  const issueEnFor = (id) => (id === 'other' ? otherText.trim() : (issueOf(id)?.issue_en || ''))
  const callList = contactsFor(reasonIssue ? reasonIssue.issue_en : (reasonId === 'other' ? otherText : ''), contacts)
  const effReason = (sid) => (perScreen && reasonBy[sid] ? reasonBy[sid] : reasonId)
  const canStart = pickedIds.length > 0 && reasonId && (reasonId !== 'other' || otherText.trim())

  const callNow = (c) => { if (c?.phone) dialPhone(normalizeIndianPhone(c.phone).value || c.phone) }

  async function startWork() {
    if (savingRef.current || busy) return
    if (!canStart) { toastError(new Error(''), t('pick_issue', lang)); return }
    savingRef.current = true; setBusy(true)
    try {
      // one screen = one open job: skip screens already in process
      const { data: dup, error: dupErr } = await supabase.from('ops_tickets').select('screen_id').eq('source', 'manual').eq('status', 'in_progress').in('screen_id', pickedIds)
      if (dupErr) { toastError(dupErr, t('save_failed', lang)); return }
      const taken = new Set((dup || []).map(r => r.screen_id))
      const ids = pickedIds.filter(id => !taken.has(id))
      if (!ids.length) { toastError(new Error(''), t('already_in_proc', lang)); return }
      let photo_path = null
      if (photoFile) {
        const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase()
        const key = `${depotId}/${Date.now()}.${ext}`
        const up = await supabase.storage.from('ops-photos').upload(key, photoFile, { upsert: false })
        if (up.error) { toastError(up.error, t('save_failed', lang)); return }
        photo_path = key
      }
      const rows = ids.map(sid => {
        const rid = effReason(sid)
        const preset = rid && rid !== 'other' ? issueOf(rid) : null
        return {
          type: 'fault', source: 'manual', status: 'in_progress',
          depot_id: depotId, screen_id: sid,
          created_by: uid, assigned_to: uid,   // exec INSERT needs created_by = self; read/update need assigned_to = self
          issue_type_id: preset ? preset.id : null,
          cause: preset ? preset.issue_en : (otherText.trim() || issueEnFor(rid)),
          notes: notes.trim() || null, photo_path,
        }
      })
      const { error } = await supabase.from('ops_tickets').insert(rows)
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t('issue_saved', lang))
      setReasonId(''); setOtherText(''); setNotes(''); setPhotoFile(null); setPerScreen(false); setReasonBy({})
      if (fileRef.current) fileRef.current.value = ''
      seededRef.current = false
      await load(); setTab('proc')
    } finally { setBusy(false); savingRef.current = false }
  }

  // In process: live "N of M back online" from the screens' own status.
  const procBackOn = proc.filter(p => screens.find(s => s.id === p.screen_id)?.status === 'online').length
  const procReason = proc[0] ? (issueOf(proc[0].issue_type_id) ? nm(issueOf(proc[0].issue_type_id), 'issue') : proc[0].cause) : ''
  const procIssue = proc[0] ? issueOf(proc[0].issue_type_id) : null
  const procCall = contactsFor(procIssue?.issue_en || proc[0]?.cause || '', contacts)
  const pct = proc.length ? Math.round((procBackOn / proc.length) * 100) : 0

  async function callAgain(c) {
    callNow(c)
    // audit row so the call is recorded like sales (never counts as a talked call without a duration)
    try {
      await supabase.from('call_logs').insert([{
        user_id: uid,
        client_phone: c?.phone ? String(c.phone).replace(/[^0-9]/g, '').slice(-10) : null,
        outcome: 'no_answer', notes: 'Station screen call',
        ops_ticket_id: proc[0]?.id || null,
      }])
      toastSuccess(T('call_saved', lang))
    } catch { /* the dial already happened; the record is best-effort */ }
  }

  async function saveNote() {
    const txt = noteText.trim()
    if (!txt || savingRef.current || busy) return
    savingRef.current = true; setBusy(true)
    try {
      for (const p of proc) {
        const merged = [p.notes, txt].filter(Boolean).join('\n')
        const { error } = await supabase.from('ops_tickets').update({ notes: merged }).eq('id', p.id)
        if (error) { toastError(error, t('save_failed', lang)); return }
      }
      setNoteText(''); toastSuccess(T('note_saved', lang)); await load()
    } finally { setBusy(false); savingRef.current = false }
  }

  async function sendCant() {
    if (cantText.trim().length < 3 || savingRef.current || busy) { toastError(new Error(''), t('cant_fix_ph', lang)); return }
    savingRef.current = true; setBusy(true)
    try {
      for (const p of proc) {
        const { error } = await supabase.rpc('ops_ticket_cant_fix', { p_ticket: p.id, p_reason: cantText.trim() })
        if (error) { toastError(error, t('save_failed', lang)); return }
      }
      toastSuccess(t('cant_fix_sent', lang)); setCantOpen(false); setCantText(''); await load()
    } finally { setBusy(false); savingRef.current = false }
  }

  async function markFixedMyself() {
    if (busy) return
    setBusy(true)
    try {
      for (const p of proc) {
        const { error } = await supabase.rpc('ops_ticket_resolve', { p_ticket: p.id })
        if (error) { toastError(error, t('still_offline_q', lang)); await load(); return }
      }
      toastSuccess(t('fixed_word', lang)); await load(); setTab('fixed')
    } finally { setBusy(false) }
  }

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={30} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  if (err || !depot) return (
    <div className="lead-root">
      <button className="lead-btn" onClick={() => nav('/ops-home')} style={{ marginBottom: 12 }}><ArrowLeft size={16} /> {t('go_home', lang)}</button>
      <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '12px 16px', fontSize: 13 }}>
        {err || t('no_depot', lang)} <button className="lead-btn" onClick={() => { setErr(''); load() }} style={{ marginLeft: 10 }}>{t('retry', lang)}</button>
      </div>
    </div>
  )

  const pill = (key, n, active) => (
    <button key={key} onClick={() => setTab(key)} style={{ flex: 1, minHeight: 44, borderRadius: 999, border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'), background: active ? 'var(--accent-soft, rgba(255,230,0,.14))' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
      {T('tab_' + key, lang)} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{numL(n, lang)}</span>
    </button>
  )

  return (
    <div className="lead-root">
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={() => nav('/ops-home')} aria-label={t('go_home', lang)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--text)', flexShrink: 0 }}><ArrowLeft size={24} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{depot.name}</div>
          <div style={{ fontSize: 13.5, color: offScreens.length || proc.length ? 'var(--danger)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
            {offScreens.length || proc.length ? <WifiOff size={15} /> : <Wifi size={15} />}
            {numL(screens.filter(s => s.status === 'offline').length, lang)} {T('of', lang)} {numL(screens.length, lang)} {t('screens_down', lang)}
          </div>
        </div>
        <button className="lead-btn" onClick={flip} style={{ fontWeight: 700, flexShrink: 0 }}>{lang === 'gu' ? 'EN' : 'ગુ'}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {pill('log', offScreens.length, tab === 'log')}
        {pill('proc', proc.length, tab === 'proc')}
        {pill('fixed', fixed.length, tab === 'fixed')}
      </div>

      {/* ───────── LOG ───────── */}
      {tab === 'log' && (
        offScreens.length === 0
          ? <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>{T('all_ok', lang)}</div>
          : (
            <div style={card}>
              <div style={{ ...label, marginTop: 0 }}>{T('step1', lang)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {offScreens.map((s, i) => {
                  const on = !!picked[s.id]
                  return (
                    <button key={s.id} onClick={() => setPicked(p => ({ ...p, [s.id]: !p[s.id] }))} aria-pressed={on}
                      style={{ minWidth: 44, minHeight: 44, borderRadius: 10, border: '1px solid ' + (on ? 'var(--danger)' : 'var(--border)'), background: on ? 'var(--danger-soft)' : 'transparent', color: on ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: '0 8px' }}>
                      {s.name ? s.name.replace(/^.*\s(\d+)$/, '$1') : numL(i + 1, lang)}
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6 }}>{numL(pickedIds.length, lang)} / {numL(offScreens.length, lang)} · {T('all_off', lang)}</div>

              <div style={label}>{T('step2', lang)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[...issueTypes, { id: 'other', issue_en: 'Other', issue_gu: T('other', 'gu') }].map(it => {
                  const on = reasonId === it.id
                  return (
                    <button key={it.id} onClick={() => setReasonId(it.id)} aria-pressed={on}
                      style={{ minHeight: 44, borderRadius: 999, padding: '4px 14px', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent-soft, rgba(255,230,0,.14))' : 'var(--surface-2)', color: 'var(--text)', fontWeight: on ? 700 : 500, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                      {it.id === 'other' ? T('other', lang) : nm(it, 'issue')}
                    </button>
                  )
                })}
              </div>
              {reasonId === 'other' && <input value={otherText} onChange={e => setOtherText(e.target.value)} placeholder={T('other_ph', lang)} style={{ ...field, marginTop: 8 }} />}

              {/* fix steps for the chosen reason */}
              {reasonIssue && nm(reasonIssue, 'solution') ? (
                <div style={{ marginTop: 10, background: 'var(--success-soft)', border: '1px solid var(--success)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)', marginBottom: 4 }}>{T('fix_steps', lang)}</div>
                  <div style={{ fontSize: 13.5, whiteSpace: 'pre-line', lineHeight: 1.5 }}>{nm(reasonIssue, 'solution')}</div>
                </div>
              ) : null}

              {/* who to call for THIS reason */}
              {reasonId && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{T('call_for', lang)}</div>
                  {callList.length === 0
                    ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('no_contacts', lang)}</div>
                    : callList.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || nm(c, 'role')}</div>
                          {c.name ? <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{nm(c, 'role')}</div> : null}
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{c.phone || '—'}</div>
                        </div>
                        <button onClick={() => callNow(c)} disabled={!c.phone} aria-label={t('call', lang)}
                          style={{ minWidth: 104, minHeight: 48, borderRadius: 12, border: 'none', background: c.phone ? 'var(--success)' : 'var(--surface-3)', color: c.phone ? 'var(--text)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 15, fontWeight: 700, cursor: c.phone ? 'pointer' : 'default' }}>
                          <Phone size={17} /> {t('call', lang)}
                        </button>
                      </div>
                    ))}
                </div>
              )}

              {/* a different reason for a few screens */}
              {offScreens.length > 1 && reasonId && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => setPerScreen(v => !v)} style={{ minHeight: 44, width: '100%', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>
                    {perScreen ? T('same', lang) : T('diff', lang)}
                  </button>
                  {perScreen && (
                    <div style={{ marginTop: 8 }}>
                      {offScreens.filter(s => picked[s.id]).map((s, i) => (
                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ flex: 1, fontSize: 14 }}>{screenName(s, i)}</span>
                          <select value={reasonBy[s.id] || ''} onChange={e => setReasonBy(m => ({ ...m, [s.id]: e.target.value }))} style={{ ...field, width: 'auto', minWidth: 150, padding: '8px 10px', fontSize: 13.5 }}>
                            <option value="">{T('as_above', lang)}</option>
                            {issueTypes.map(it => <option key={it.id} value={it.id}>{nm(it, 'issue')}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={label}>{T('step3', lang)} <span style={{ textTransform: 'none', fontWeight: 500 }}>· {T('optional', lang)}</span></div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={T('note_ph', lang)} style={{ ...field, resize: 'none' }} />
              <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={e => setPhotoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} style={{ ...field, marginTop: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: photoFile ? 'var(--success)' : 'var(--text-muted)', borderStyle: 'dashed', minHeight: 48 }}>
                {photoFile ? <Check size={18} /> : <Camera size={18} />}{photoFile ? T('photo_ok', lang) : T('photo', lang)}
              </button>

              <button onClick={startWork} disabled={busy || !canStart}
                style={{ width: '100%', marginTop: 16, minHeight: 52, borderRadius: 999, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg, #0f172a)', fontWeight: 700, fontSize: 15.5, cursor: busy || !canStart ? 'default' : 'pointer', opacity: busy || !canStart ? 0.55 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Check size={18} /> {busy ? t('saving', lang) : T('start', lang)}
              </button>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{T('start_hint', lang)}</div>
            </div>
          )
      )}

      {/* ───────── IN PROCESS ───────── */}
      {tab === 'proc' && (
        proc.length === 0
          ? <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>
              {T('no_proc', lang)}
              {offScreens.length > 0 && <div style={{ marginTop: 10 }}><button className="lead-btn" onClick={() => setTab('log')}>{T('tab_log', lang)}</button></div>}
            </div>
          : (
            <>
              <div style={card}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lang === 'gu' ? 'કારણ' : 'Reason'}</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>{procReason}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lang === 'gu' ? 'સ્ક્રીન હમણાં' : 'Screens now'}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, fontVariantNumeric: 'tabular-nums' }}>
                  {numL(procBackOn, lang)} {T('of', lang)} {numL(proc.length, lang)} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>{T('back_on', lang)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden', marginTop: 10 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--success)', borderRadius: 999, transition: 'width .4s' }} />
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}><Clock size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {T('self_fix', lang)}</div>
                {proc.some(p => p.cant_fix_reason) && (
                  <div style={{ marginTop: 10, background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 10, padding: '8px 10px', fontSize: 13 }}>
                    <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 4 }} />{proc.find(p => p.cant_fix_reason)?.cant_fix_reason}
                  </div>
                )}
              </div>

              <div style={card}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{T('call_for', lang)}</div>
                {procCall.length === 0
                  ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('no_contacts', lang)}</div>
                  : procCall.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name || nm(c, 'role')}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{c.phone || '—'}</div>
                      </div>
                      <button onClick={() => callAgain(c)} disabled={!c.phone} style={{ minWidth: 120, minHeight: 48, borderRadius: 12, border: 'none', background: c.phone ? 'var(--success)' : 'var(--surface-3)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
                        <Phone size={16} /> {T('call_again', lang)}
                      </button>
                    </div>
                  ))}
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={2} placeholder={T('note_ph', lang)} style={{ ...field, resize: 'none', marginTop: 6 }} />
                <button className="lead-btn" onClick={saveNote} disabled={busy || !noteText.trim()} style={{ width: '100%', marginTop: 8, minHeight: 44 }}>{T('save_note', lang)}</button>
              </div>

              {cantOpen ? (
                <div style={card}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{T('cant_why', lang)}</div>
                  <textarea value={cantText} onChange={e => setCantText(e.target.value)} rows={3} style={{ ...field, resize: 'none' }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="lead-btn" onClick={() => setCantOpen(false)} style={{ flex: 1, minHeight: 44 }}>{t('cancel', lang)}</button>
                    <button onClick={sendCant} disabled={busy} style={{ flex: 1, minHeight: 44, borderRadius: 999, border: 'none', background: 'var(--danger)', color: 'var(--text)', fontWeight: 700, cursor: 'pointer' }}>{T('send', lang)}</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setCantOpen(true)} style={{ width: '100%', minHeight: 48, borderRadius: 999, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer', marginBottom: 10 }}>
                  {T('cant', lang)}
                </button>
              )}
              <button className="lead-btn" onClick={markFixedMyself} disabled={busy} style={{ width: '100%', minHeight: 44, marginBottom: 8 }}><Wrench size={15} /> {T('fixed_now', lang)}</button>
              {offScreens.length > 0 && <button className="lead-btn" onClick={() => setTab('log')} style={{ width: '100%', minHeight: 44 }}>{T('report_more', lang)}</button>}
            </>
          )
      )}

      {/* ───────── FIXED ───────── */}
      {tab === 'fixed' && (
        fixed.length === 0
          ? <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)' }}>{T('no_fixed', lang)}</div>
          : fixed.map(f => {
            const ms = f.resolved_at && f.created_at ? new Date(f.resolved_at) - new Date(f.created_at) : 0
            return (
              <div key={f.id} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{f.screen?.name || f.cause || depot.name}</div>
                  <span style={{ background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {f.source === 'manual' ? T('fixed_by_you', lang) : T('fixed_auto', lang)}
                  </span>
                </div>
                {f.cause ? <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{f.cause}</div> : null}
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{hoursText(ms, lang)} {T('down_for', lang)} · {new Date(f.resolved_at).toLocaleString('en-GB')}</div>
              </div>
            )
          })
      )}
    </div>
  )
}
