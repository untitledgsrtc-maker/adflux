# Operation-executive ticket dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the operation_executive's single home — an assigned-city filter + 3 tabs (Open / In process / Fixed) that carry a screen fault from offline → issue logged → contact called (recorded like a sales call) → fixed.

**Architecture:** One new page `OpsTicketsV2.jsx` reusing the live ops tables (`ops_screens`/`ops_depots`/`ops_issue_types`/`ops_tickets`/`ops_depot_contacts`) exactly as OpsLogV2 does. Manual per-screen tickets are created via a direct RLS-gated `ops_tickets` insert (the OpsLogV2 pattern, exec owns their rows). Fix-it calls write one `call_logs` row each with a new nullable `ops_ticket_id` FK. Mark-fixed is a client soft-warn (live CMS status check) + a direct `status='resolved'` update. No head approval (rejected §244). Sales flow byte-unchanged (`ops_ticket_id` NULL on every sales row).

**Tech Stack:** React 18 + Vite, Supabase JS, `opsStrings` (Gujarati-first §231), v2 tokens, lucide-react. No test harness — verification is `esbuild` parse + `npm run build` + sales-module-guardian on the 2 frozen files + owner smoke.

**Reference:** spec `docs/superpowers/specs/2026-08-27-ops-exec-ticket-dashboard-design.md`; approved clickable mockup this session; pattern source `src/pages/v2/OpsLogV2.jsx`.

**Discipline:** ops files are NOT §28-frozen EXCEPT `src/App.jsx` + `src/components/v2/V2AppShell.jsx` (Task 4 → guardian). Commit ONLY the named files per task (never `git add -A`). Sandbox self-pushes after each commit (§211): `git push origin untitled-os` then verify `git log origin/untitled-os..HEAD` is empty. Owner runs SQL in Studio.

---

### Task 1: SQL — `call_logs.ops_ticket_id` (the one additive column)

**Files:**
- Create: `supabase_ops_p3_ticket_calls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase_ops_p3_ticket_calls.sql
-- OPERATIONS — link a fix-it call to its ticket so an ops call records "like a
-- sales call" but attaches to the ticket (spec 2026-08-27-ops-exec-ticket-dashboard).
-- ONE additive nullable column on call_logs. Sales rows keep it NULL → zero impact
-- on the sales call flow, the §92 STOP-rule, or the §170/§173 dedup. Idempotent.
-- Owner runs in Studio.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS ops_ticket_id uuid
  REFERENCES public.ops_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_ops_ticket
  ON public.call_logs (ops_ticket_id) WHERE ops_ticket_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY (run in Studio after the file) =================================
-- Expect: has_col = 1, has_index = 1.
-- SELECT
--   (SELECT count(*) FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='call_logs' AND column_name='ops_ticket_id') AS has_col,
--   (SELECT count(*) FROM pg_indexes
--      WHERE schemaname='public' AND indexname='idx_call_logs_ops_ticket') AS has_index;
```

- [ ] **Step 2: Schema-lint it**

Run: `bash scripts/check-sql-schema.sh supabase_ops_p3_ticket_calls.sql`
Expected: no structure warning (has `IF NOT EXISTS`, `NOTIFY pgrst`, a VERIFY block). A record-alias/dotted-literal false-positive is documented (§72#15) — ignore if it appears.

- [ ] **Step 3: Confirm no new RLS is needed**

Reasoning check (no command): the exec already inserts their own `call_logs` rows — reps do this today via `callAudit.js`, and §230/§47 records the `call_logs` own-insert policy (`user_id = auth.uid()`) is NOT role-gated ("ops works free"). The new column is additive; existing own-insert covers it. Do NOT add a call_logs RLS policy.

- [ ] **Step 4: Commit + push**

```bash
git add supabase_ops_p3_ticket_calls.sql
git commit -m "Ops p3: additive call_logs.ops_ticket_id (link a fix-it call to its ticket)"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 2: opsStrings — the new dashboard labels

**Files:**
- Modify: `src/utils/opsStrings.js` (the `STR` object — append keys before the closing `}`)

- [ ] **Step 1: Add the keys**

Add these entries inside the `STR = { ... }` object (Gujarati-first, §231 pattern — keep both `gu` and `en` filled):

```js
  // — exec ticket dashboard —
  tickets_title:   { gu: 'ટિકિટ',                     en: 'Tickets' },
  tab_open:        { gu: 'ખુલ્લા',                     en: 'Open' },
  tab_proc:        { gu: 'ચાલુ',                       en: 'In process' },
  tab_fixed:       { gu: 'સુધારેલા',                   en: 'Fixed' },
  grouped:         { gu: 'સ્ટેશન પ્રમાણે',              en: 'Grouped' },
  individual:      { gu: 'એક એક',                      en: 'Individual' },
  down_word2:      { gu: 'બંધ',                        en: 'down' },
  log_whole:       { gu: 'આખું સ્ટેશન નોંધો',           en: 'Log the whole station' },
  submit_proc:     { gu: 'સાચવો → ચાલુમાં',            en: 'Submit → In process' },
  in_process:      { gu: 'ચાલુ છે',                    en: 'In process' },
  mark_fixed:      { gu: 'સુધારાયું',                  en: 'Mark fixed' },
  fixed_word:      { gu: 'સુધારેલું',                  en: 'Fixed' },
  no_open:         { gu: 'બધી સ્ક્રીન ચાલુ છે',         en: 'All screens up' },
  no_proc:         { gu: 'કંઈ ચાલુ નથી',               en: 'Nothing in process' },
  no_fixed:        { gu: 'હજુ કંઈ સુધાર્યું નથી',       en: 'Nothing fixed yet' },
  calling:         { gu: 'ફોન થાય છે',                 en: 'Calling' },
  recorded_auto:   { gu: 'આપોઆપ નોંધાય છે',            en: 'recorded automatically' },
  call_ended_q:    { gu: 'ફોન પૂરો — શું થયું?',        en: 'Call ended — what happened?' },
  out_reached:     { gu: 'વાત થઈ',                     en: 'Reached' },
  out_no_answer:   { gu: 'ઉપાડ્યો નહીં',               en: 'No answer' },
  out_will_come:   { gu: 'આવશે',                       en: 'Will come' },
  out_fixed_call:  { gu: 'ફોન પર જ સુધાર્યું',          en: 'Fixed on call' },
  save_call:       { gu: 'ફોન સાચવો',                  en: 'Save call' },
  call_note_ph:    { gu: 'નોંધ (વૈકલ્પિક)',            en: 'Note (optional)' },
  n_calls:         { gu: 'ફોન',                        en: 'call(s)' },
  still_offline_q: { gu: 'CMS હજુ બંધ બતાવે છે — તોય સુધારેલું નોંધવું?', en: 'The CMS still shows this offline — mark fixed anyway?' },
  fixed_by:        { gu: 'સુધાર્યું',                   en: 'Fixed by' },
```

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/utils/opsStrings.js >/dev/null`
Expected: no output (parses clean). Also confirm no duplicate key you added already exists (grep each new key name once):
`for k in tab_open tab_proc mark_fixed out_reached; do echo -n "$k: "; grep -c "  $k:" src/utils/opsStrings.js; done` — expect `1` each.

- [ ] **Step 3: Commit + push**

```bash
git add src/utils/opsStrings.js
git commit -m "Ops: opsStrings keys for the exec ticket dashboard"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 3: The dashboard — `OpsTicketsV2.jsx` (complete page)

**Files:**
- Create: `src/pages/v2/OpsTicketsV2.jsx`

This is the whole feature: city filter + 3 tabs + Open (grouped/individual + issue sheet → manual ticket) + In process (contact + Call → outcome sheet → `call_logs` + history) + Fixed (soft-warn resolve). It mirrors `OpsLogV2.jsx` patterns (supabase, `t`/`nm`, `card`/`lbl`/`field` styles, `savingRef`, ops-photos upload, tel: contact link) and adds `confirmDialog` (§26) for the soft-warn.

**Contracts baked in:**
- Manual ticket insert: `{ type:'fault', source:'manual', status:'in_progress', depot_id, screen_id, issue_type_id, cause, notes, photo_path, assigned_to: profile.id }` — direct RLS insert (exec owns their rows, the OpsLogV2 pattern; setting `status:'in_progress'` because picking the issue = starting work, no separate Start click).
- Open tab = `ops_screens` offline in the exec's depots MINUS screens that already have an open/in_progress **manual** ticket (`screen_id`).
- In process / Fixed = the exec's OWN tickets (`assigned_to = me`, `source='manual'`). Auto `auto_offline` depot tickets are the head's aggregate (§243) and are intentionally excluded here.
- Call → tel: on the user gesture, open the outcome sheet; on Save write ONE `call_logs` row (deliberately not the sales two-step tap-audit — an ops tech calling an electrician has no outcome-fraud incentive; one honest row per call, `outcome` mapped to the enum, the label in `notes`, `ops_ticket_id` set).
- `call_logs.outcome` CHECK enum is sales-shaped — map: Reached/Will come/Fixed on call → `'connected'`; No answer → `'no_answer'`; the exact ops label goes in `notes` (never add ops values to the sales enum).
- Mark fixed → client checks the screen's live `ops_screens.status`; if still `offline` → `confirmDialog(still_offline_q)`; on confirm → direct UPDATE `status='resolved', resolved_at=now()` (no §243 hard-block RPC → soft-warn as the spec requires).

- [ ] **Step 1: Create the file**

```jsx
// src/pages/v2/OpsTicketsV2.jsx — the operation_executive's home (owner-approved
// mockup, 2026-08-27). Assigned-city filter + 3 tabs: Open (offline screens ->
// pick issue -> ticket) / In process (call the contact, recorded like sales) /
// Fixed. Consolidates the Down-now offline view + Log-issue + the old queue.
// Reuses ops_screens/ops_depots/ops_issue_types/ops_tickets/ops_depot_contacts +
// call_logs (ops_ticket_id). Gujarati-first (§231). Not §28-frozen.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MapPin, Phone, AlertTriangle, ChevronRight, Camera, Check, Circle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { t, getOpsLang, setOpsLang } from '../../utils/opsStrings'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const card  = { background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)', borderRadius: 14, padding: 14 }
const lbl   = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--v2-ink-2, #94a3b8)', display: 'block', marginBottom: 6 }
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-0, #f1f5f9)', border: '1px solid var(--v2-line, #334155)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }
const yellow = 'var(--v2-yellow, #FFE600)'
const ink2  = 'var(--v2-ink-2, #94a3b8)'

// Map an ops outcome label -> the sales call_logs.outcome enum (never widen the enum).
const OUTCOME_DB = { reached: 'connected', will_come: 'connected', fixed_call: 'connected', no_answer: 'no_answer' }

export default function OpsTicketsV2() {
  const { profile } = useAuth()
  const uid = profile?.id
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

      if (!depotIds.length) { setScreens([]); setProc([]); setFixed([]); setContactsByDepot({}); setIssueTypes([]); return }

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

      // Open = offline screens minus those already on an open/in-progress manual ticket
      const takenScreenIds = new Set(procRows.map(p => p.screen_id).filter(Boolean))
      setScreens((scr.data || []).filter(s => !takenScreenIds.has(s.id)))

      // call history for the in-process tickets
      const tIds = procRows.map(p => p.id)
      if (tIds.length) {
        const cl = await supabase.from('call_logs').select('id, ops_ticket_id, outcome, notes, call_at').in('ops_ticket_id', tIds).order('call_at', { ascending: false })
        const cbt = {}; (cl.data || []).forEach(r => { (cbt[r.ops_ticket_id] = cbt[r.ops_ticket_id] || []).push(r) }); setCallsByTicket(cbt)
      } else setCallsByTicket({})
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
    <div style={{ padding: '14px 14px 40px', maxWidth: 480, margin: '0 auto' }}>
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
        {[['open', t('tab_open', lang), 'var(--danger)'], ['proc', t('tab_proc', lang), 'var(--v2-amber, #F59E0B)'], ['fixed', t('tab_fixed', lang), 'var(--v2-green, #10B981)']].map(([k, label, col]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? yellow : 'transparent'}`, padding: '9px 0', fontSize: 14, fontWeight: tab === k ? 700 : 400, color: tab === k ? 'var(--v2-ink-0, #f1f5f9)' : ink2, cursor: 'pointer' }}>
            {label} <span style={{ color: col }}>{cnt[k]}</span>
          </button>
        ))}
      </div>

      {tab === 'open' && <OpenTab />}
      {tab === 'proc' && <ProcTab />}
      {tab === 'fixed' && <FixedTab />}

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
        {grouped
          ? Object.entries(byDepot).map(([did, list]) => (
            <div key={did} style={{ ...card, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{depotName(did)}</span>
                <span style={{ fontSize: 11, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', borderRadius: 999, padding: '2px 8px' }}>{list.length} {t('down_word2', lang)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                {list.map(s => (
                  <button key={s.id} onClick={() => openSheet([s.id], did)} className="btn btn-sm" style={{ justifyContent: 'space-between' }}>
                    <span>{t('screen', lang)} {screenNo[s.id]}</span><AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
                  </button>
                ))}
              </div>
              <button onClick={() => openSheet(list.map(s => s.id), did)} className="btn btn-sm" style={{ width: '100%', marginTop: 10, borderColor: yellow, color: yellow }}>{t('log_whole', lang)}</button>
            </div>
          ))
          : cityScreens.map(s => (
            <button key={s.id} onClick={() => openSheet([s.id], s.depot_id)} className="btn" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8, padding: 12 }}>
              <span style={{ textAlign: 'left' }}><span style={{ fontWeight: 600 }}>{t('screen', lang)} {screenNo[s.id]}</span><br /><span style={{ fontSize: 12, color: ink2 }}>{depotName(s.depot_id)}</span></span>
              <ChevronRight size={16} />
            </button>
          ))}
      </>
    )
  }

  function ProcTab() {
    if (!cityProc.length) return empty(t('no_proc', lang))
    return cityProc.map(tk => {
      const calls = callsByTicket[tk.id] || []
      const contact = (contactsByDepot[tk.depot_id] || [])[0]
      return (
        <div key={tk.id} style={{ ...card, marginBottom: 10 }}>
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
    })
  }

  function FixedTab() {
    if (!cityFixed.length) return empty(t('no_fixed', lang))
    return cityFixed.map(f => (
      <div key={f.id} style={{ ...card, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{f.screen?.name || t('screen', lang)}</span>
          <span style={{ fontSize: 11, background: 'var(--success-soft, rgba(16,185,129,.12))', color: 'var(--v2-green, #10B981)', borderRadius: 999, padding: '2px 8px' }}>{t('fixed_word', lang)}</span>
        </div>
        <div style={{ fontSize: 12, color: ink2, marginTop: 2 }}>{f.depot?.name || depotName(f.depot_id)} · {f.issue ? nm(f.issue, 'issue') : (f.cause || t('fault', lang))}</div>
        {f.resolved_at && <div style={{ fontSize: 11, color: ink2, marginTop: 6 }}>{new Date(f.resolved_at).toLocaleString('en-GB')}</div>}
      </div>
    ))
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
```

> Note on the modals: this page uses `position: fixed` bottom-sheets at `zIndex: 9000` (the Modal tier, §29). That is fine in the real app (unlike the mockup env). `confirmDialog` (10000) still sits above them.

- [ ] **Step 2: Parse-check**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/OpsTicketsV2.jsx >/dev/null`
Expected: no output.

- [ ] **Step 3: Confirm every `t()` key exists**

Run: `for k in tickets_title tab_open tab_proc tab_fixed grouped individual log_whole submit_proc in_process mark_fixed fixed_word no_open no_proc no_fixed calling recorded_auto call_ended_q out_reached out_no_answer out_will_come out_fixed_call save_call call_note_ph n_calls still_offline_q down_word2 offline pick_issue; do grep -q "  $k:" src/utils/opsStrings.js || echo "MISSING $k"; done`
Expected: no output (all keys present — `offline` + `pick_issue` are pre-existing §231 keys).

- [ ] **Step 4: Commit + push** (page is not routed yet — Task 4 wires it; committing a not-yet-routed page is safe, it's dead-imported until then)

```bash
git add src/pages/v2/OpsTicketsV2.jsx
git commit -m "Ops: OpsTicketsV2 — exec ticket dashboard (Open/In process/Fixed + call flow)"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 4: Wiring (FROZEN files — guardian required)

**Files:**
- Modify: `src/App.jsx` (lazy import ~line 79-81; RootRedirect line 315; route block ~line 449)
- Modify: `src/components/v2/V2AppShell.jsx` (`OPS_EXEC_NAV` line 267)

- [ ] **Step 1: App.jsx — lazy import**

Add next to the other ops lazy imports (after the `OpsDownV2` line ~81):

```jsx
const OpsTicketsV2 = lazyWithRetry(() => import('./pages/v2/OpsTicketsV2'))
```

- [ ] **Step 2: App.jsx — repoint the exec landing**

Change the RootRedirect exec line (currently line 315):

```jsx
  if (role === 'operation_executive')  return <Navigate to="/ops-tickets" replace />
```

(operation_head line 314 → `/ops-down` stays unchanged.)

- [ ] **Step 3: App.jsx — add the route**

Add after the `/ops-station` route (line 449):

```jsx
          <Route path="/ops-tickets"               element={<RequireOps><OpsTicketsV2 /></RequireOps>} />
```

`/ops`, `/ops-log`, `/ops-down` routes STAY (deep-links, §45 — nothing removed).

- [ ] **Step 4: V2AppShell — consolidate OPS_EXEC_NAV**

Replace the `OPS_EXEC_NAV` array (line 267). Use `LayoutDashboard` for the Tickets entry — it is ALREADY imported in this file (OPS_HEAD_NAV uses it), so no new import (the §245 white-screen foot-gun: an un-imported icon in a top-level const crashes every role at load, and `npm run build` does NOT catch it):

```jsx
const OPS_EXEC_NAV = [
  { to: '/ops-tickets',       label: 'Tickets',        icon: LayoutDashboard },
  { to: '/ops-log',           label: 'Log issue',      icon: FileText },
  { to: '/ops',               label: 'Check in',       icon: Tv },
]
```

(`/ops-down` drops from the exec nav — it's now the Open tab — but the route stays reachable.)

- [ ] **Step 5: Verify the icon import**

Run: `sed -n '55,75p' src/components/v2/V2AppShell.jsx | grep -c "LayoutDashboard"`
Expected: `1` (LayoutDashboard is in the lucide import block). If `0`, add `LayoutDashboard` to the import before committing.

- [ ] **Step 6: Parse + build**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/App.jsx src/components/v2/V2AppShell.jsx >/dev/null && npm run build 2>&1 | tail -2`
Expected: parse silent; build ends with `files generated` / `dist/sw.js` (no error).

- [ ] **Step 7: sales-module-guardian (MANDATORY — both files are §28-frozen)**

```
Agent(subagent_type="sales-module-guardian",
  description="Ops-tickets frozen wiring review",
  prompt="Audit the uncommitted git diff of src/App.jsx + src/components/v2/V2AppShell.jsx. Changes: (1) App.jsx lazy import OpsTicketsV2; new /ops-tickets route under RequireOps; RootRedirect operation_executive repointed /ops-log -> /ops-tickets (one string). (2) V2AppShell OPS_EXEC_NAV gains a Tickets entry (icon LayoutDashboard, already imported) and drops /ops-down from the exec nav (route kept). Confirm: no SALES/TELECALLER/AGENCY/OPS_HEAD nav or routing touched; no PostCallOutcomeModal/useAutoRefresh/push/GPS-skip-list change; operation_executive stays OUT of the GPS skip list; the icon is imported (no white-screen). Report PASS/FLAG/BLOCK with line-level findings.")
```
If BLOCK/FLAG (e.g. a missing import), fix and re-run. Do NOT commit on a BLOCK.

- [ ] **Step 8: Commit + push** (only the 2 files)

```bash
git add src/App.jsx src/components/v2/V2AppShell.jsx
git commit -m "Ops: route + nav the exec ticket dashboard (/ops-tickets is the exec home)"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 5: Document (§93) + owner handoff

**Files:**
- Modify: `CLAUDE.md` (append §246)

- [ ] **Step 1: Append the section** to `CLAUDE.md` following the §25 format — a `## 246 · Operation-executive ticket dashboard (…date…)` entry covering: the 3-tab consolidation (folds Down-now + Log-issue + the old queue), the `call_logs.ops_ticket_id` additive column, the outcome→enum mapping (Reached/Will come/Fixed-on-call → `connected`; No answer → `no_answer`; label in notes), the soft-warn Mark-fixed (client CMS check, no §243 hard block, no head approval per §244), the manual-ticket contract (`source='manual'`, `status='in_progress'`, `assigned_to=me`), and the foot-guns: (a) never widen the sales `call_logs.outcome` enum for ops — map + store the label in notes; (b) the §170/§173 dedup trigger accepted-tiny-risk (an ops call to a depot-contact phone won't collide with a rep's tel-tap audit within 60s; if it ever bites, add `AND NEW.ops_ticket_id IS NULL` to the dedup trigger); (c) the §245 un-imported-icon white-screen.

- [ ] **Step 2: Commit + push**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md §246 — operation-executive ticket dashboard"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

- [ ] **Step 3: Owner handoff (report, no command)**

Tell the owner, in plain language:
1. **Run** `supabase_ops_p3_ticket_calls.sql` in Supabase Studio → run its VERIFY (`has_col=1, has_index=1`). Until it runs, the Call step's save will error (the column is missing) but the rest of the dashboard works.
2. Everything else deploys on push (Vercel). **operation_executive now lands on the Tickets dashboard.** Log-issue + Down-now are still reachable but no longer the front door.
3. **Depot → tech** must be assigned (head console → Screens by station → Assigned tech) so a station shows in an exec's city dropdown + its contacts appear. An exec sees only their assigned stations.
4. Smoke (as an operation_executive with an assigned depot that has an offline screen): pick a city → Open lists the offline screens (Grouped + Individual) → tap one → pick a problem + notes + photo → Submit → it moves to In process as a ticket with the depot contact → Call (dials + records) → outcome sheet → Save → Mark fixed → Fixed tab with the call history.

---

## Self-review

**Spec coverage** (each spec §):
- §2 flow (city → 3 tabs → grouped/individual → issue → in process → call → fixed) → Task 3 (OpenTab/ProcTab/FixedTab/IssueSheet/CallSheet). ✓
- §3 data model reuse (ops_* tables) → Task 3 `load()`. ✓
- §3.1 `call_logs.ops_ticket_id` → Task 1. ✓
- §4 close model (soft-warn, no approval) → Task 3 `markFixed()`. ✓
- §5 navigation/consolidation (exec landing + OPS_EXEC_NAV, keep old routes) → Task 4. ✓
- §6 contracts (RLS-gated direct insert; outcome→enum map; Gujarati; guardian on frozen) → Tasks 1/3/4. ✓
- §8 acceptance → Task 5 Step 3 smoke. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. ✓

**Type/name consistency:** `OUTCOME_DB` keys (`reached/will_come/fixed_call/no_answer`) match the `outs` button keys in `CallSheet` and the `labelKey` map in `saveCall`. `screenNo`/`depotName`/`nm`/`t` used consistently. `ops_ticket_id` spelled identically in Task 1 (column), Task 3 (insert + select), and the FK. Tab keys `open/proc/fixed` consistent across `cnt`, `tab` state, and the tab buttons. ✓

**Known accepted risk (documented, not a gap):** the §170/§173 `call_logs` dedup BEFORE-INSERT trigger could, in theory, fold an ops call into a same-phone tel-tap audit within 60s — a depot-contact number colliding with a rep's just-tapped lead is implausible; if it ever surfaces, add `AND NEW.ops_ticket_id IS NULL` to the dedup trigger (Task 5 foot-gun (b)). Not touching the frozen trigger pre-emptively (§16/§45).
