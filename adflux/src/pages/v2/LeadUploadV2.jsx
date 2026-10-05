// src/pages/v2/LeadUploadV2.jsx
//
// Phase 12 — bulk lead import from Excel / CSV (Cronberry-style).
//
// Per master spec §17.4 + §17.5:
//   1. Strip single quotes from mobile cells ("'9924714064'" → "9924714064")
//   2. Parse Cronberry "Remarks" field with regex:
//        ^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*:-\s*(.*?)\s*\(([^)]+)\)$
//      → timestamp + status_text + telecaller_name
//   3. Map status_text to lead.stage via keyword table
//   4. Look up telecaller_name → users.id (case-insensitive)
//   5. Create lead + 1 lead_activities row from the parsed data
//   6. Optional: 90-day cutoff — older rows imported as Lost/Stale
//
// Admin / co_owner: full import (Cronberry parse, owner pickers, cutoff).
//
// Phase 330 — sales + telecaller reps can ALSO upload a CSV, but ONLY of their
// own leads ("self mode"): every row lands in the uploader's own list, stage
// New, quiet (no per-lead push / auto follow-up / "Leads today" count — the
// three leads triggers carry WHEN (NOT lead_is_self_import(...))). 500 leads
// per file, CSV only. The admin import (commitImport + its mapping/options UI) is unchanged;
// the only shared-path differences are: UTF-8 BOM strip, the name-in-column-0 preview fix, the
// file input resetting after a pick, and the users list loading for admins only.
// Live progress bar. Audit row in lead_imports.

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Copy,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { pushToast, toastError, toastSuccess } from '../../components/v2/Toast'

/* ─── Hand-rolled CSV parser ───
   Handles RFC 4180 quoted fields with commas + escaped quotes inside,
   and the Cronberry quirk where mobile numbers are wrapped in single
   quotes ('9924714064'). We strip the wrapping quotes in cleanMobile()
   below; the parser leaves them intact.

   For .xlsx files, the user converts to CSV first (Excel: File → Save As → CSV).
   Cronberry's "Download Data" already exports CSV directly. */
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue }
      if (ch === '"') { inQuotes = false; i++; continue }
      cell += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue }
    cell += ch; i++
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => String(c).trim()))
}

/* ─── Cronberry status → architecture stage mapping ───
   Phase 30A — collapsed to 5 stages. "Nurture" CSV remarks now map
   to Lost (the import sets nurture_revisit_date so the lead surfaces
   later via the "Lost with revisit" filter). "Qualified" and
   "Contacted" both map to Working. */
const STATUS_KEYWORD_MAP = [
  { stage: 'Lost',    reason: 'NoNeed',       keywords: ['no enquiry', 'only time pass', 'not interested', 'no need', 'not required'] },
  { stage: 'Lost',    reason: 'WrongContact', keywords: ['wrong number', 'wrong contact', 'wrong person', 'unknown'] },
  { stage: 'Lost',    reason: 'NoResponse',   keywords: ['no response', 'not picking', 'not connected'] },
  { stage: 'Lost',    reason: 'Price',        keywords: ['price issue', 'too costly', 'budget issue', 'expensive'] },
  { stage: 'Lost',    reason: null, isNurture: true,
                                            keywords: ['call later', 'callback', 'future prospect', 'follow up later', 'next month'] },
  { stage: 'Working', reason: null,         keywords: ['interested', 'send proposal', 'send quote', 'want quote', 'meeting fixed', 'demo'] },
  { stage: 'Won',     reason: null,         keywords: ['won', 'closed', 'order placed'] },
  { stage: 'Working', reason: null,         keywords: ['contacted', 'call done', 'spoke', 'talked'] },
]

function classifyStatus(text) {
  const lower = (text || '').toLowerCase()
  for (const entry of STATUS_KEYWORD_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      // Phase 30A — flag the ex-Nurture branch so the importer can set
      // nurture_revisit_date alongside stage='Lost'.
      return {
        stage: entry.stage,
        lost_reason: entry.reason,
        isNurture: !!entry.isNurture,
      }
    }
  }
  return { stage: 'New', lost_reason: null, isNurture: false }
}

const REMARKS_REGEX = /^(\d{4}-\d{2}-\d{2}[\s,T]\d{2}:\d{2}:\d{2})\s*:-\s*(.+?)\s*\(([^)]+)\)\s*$/

function parseRemarks(remarks) {
  if (!remarks) return null
  const m = String(remarks).trim().match(REMARKS_REGEX)
  if (!m) return { raw: remarks, timestamp: null, statusText: remarks, telecallerName: null }
  return {
    raw: remarks,
    timestamp: m[1].replace(' ', 'T') + (m[1].length === 19 ? '+05:30' : ''),
    statusText: m[2].trim(),
    telecallerName: m[3].trim(),
  }
}

/* ─── Mobile sanitizer — strip quotes/spaces, keep digits ─── */
function cleanMobile(raw) {
  if (!raw) return null
  return String(raw).replace(/['"\s]/g, '').replace(/^\+91/, '').replace(/[^0-9]/g, '') || null
}

/* ─── Header auto-detect ─── */
const HEADER_ALIASES = {
  name:    ['name', 'lead name', 'customer name', 'contact'],
  phone:   ['mobile', 'phone', 'contact number', 'mobile number', 'phone number'],
  email:   ['email', 'email id', 'mail'],
  company: ['company', 'company name', 'organization', 'firm'],
  city:    ['city', 'location', 'area'],
  address: ['address', 'addr'],
  remarks: ['remarks', 'notes', 'comments', 'note'],
  source:  ['source', 'lead source', 'channel'],
}

function detectColumn(header, target) {
  const norm = (header || '').toLowerCase().trim()
  return HEADER_ALIASES[target].some(a => norm === a || norm.includes(a))
}

// preferExact (Phase 330, self mode only): try an exact header match first so
// "Company Name" before "Name" can't steal the Name column. Admin path passes
// nothing -> identical to before.
function buildColumnMap(headers, preferExact = false) {
  const map = {}
  if (!preferExact) {
    for (const target of Object.keys(HEADER_ALIASES)) {
      const idx = headers.findIndex(h => detectColumn(h, target))
      if (idx >= 0) map[target] = idx
    }
    return map
  }
  // Self mode: exact matches first, then loose matches — and one column can only
  // serve ONE target ("Contact Number" must not become both Name and Mobile).
  const claimed = new Set()
  const targets = Object.keys(HEADER_ALIASES)
  for (const target of targets) {
    const idx = headers.findIndex((h, i) => !claimed.has(i)
      && HEADER_ALIASES[target].includes((h || '').toLowerCase().trim()))
    if (idx >= 0) { map[target] = idx; claimed.add(idx) }
  }
  for (const target of targets) {
    if (map[target] !== undefined) continue
    const idx = headers.findIndex((h, i) => !claimed.has(i) && detectColumn(h, target))
    if (idx >= 0) { map[target] = idx; claimed.add(idx) }
  }
  return map
}

/* ─── Phase 330 — self-mode helpers ─── */
const SELF_MAX_ROWS = 500          // owner decision 2026-10-05
const SELF_MAX_BYTES = 2 * 1024 * 1024
const SELF_BATCH = 25
const SELF_SOURCE = 'Excel'        // same free-text source the admin import uses

// Indian mobile -> exactly 10 digits starting 6-9, else null. Handles
// "+91 98765 43210", "919876543210", "09876543210", "98765-43210".
function normalizeMobile10(raw) {
  if (raw === null || raw === undefined) return null
  let d = String(raw).replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

const SELF_EXAMPLE_CSV =
  'name,phone,email,company,city,notes\n' +
  'Rajesh Patel,9876543210,rajesh@example.com,Patel Traders,Vadodara,Met at expo\n' +
  'Meena Shah,9898012345,,Shah Textiles,Surat,Wants LED rates'

/* ─── Component ─── */
export default function LeadUploadV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)
  // Phase 330 — a sales / telecaller rep uploading their OWN leads. Agency and
  // every other role fall through to the access-denied panel (route guard
  // RequireLeadUpload keeps them out too; this is the second lock).
  const selfMode  = !isPrivileged && ['sales', 'telecaller'].includes(profile?.role)
  const canUpload = isPrivileged || selfMode
  // Segments this rep may create (DB trg_leads_segment_access_ins is strict on
  // users.segment_access — no manager exemption — so mirror it exactly).
  const segAccess  = profile?.segment_access || 'ALL'
  const selfCanPriv = segAccess === 'ALL' || segAccess === 'PRIVATE'
  const selfCanGovt = segAccess === 'ALL' || segAccess === 'GOVERNMENT'

  const [file, setFile]                 = useState(null)
  const [parsing, setParsing]           = useState(false)
  const [rows, setRows]                 = useState([])
  const [headers, setHeaders]           = useState([])
  const [columnMap, setColumnMap]       = useState({})
  const [defaultSegment, setDefaultSegment] = useState('PRIVATE')
  const [defaultSalesAssignee, setDefaultSalesAssignee] = useState('')
  // Phase 99.B (2026-05-29) — TC pick now has its own state. Was
  // lumped into a single `defaultAssignee` that wrote to
  // `leads.assigned_to` regardless of selected user's role. 107
  // TC-meant leads landed in the wrong column over 5 days and
  // /telecaller stayed empty for Dhara + Rima. Phase 99.A migration
  // repaired the data; this form fix prevents recurrence by
  // splitting the single dropdown into explicit Sales + Telecaller
  // picks. Admin TC pick overrides Cronberry Remarks parse
  // (Decision 3 from /telecaller routing repair memo).
  const [defaultTelecallerAssignee, setDefaultTelecallerAssignee] = useState('')
  const [cutoffDays, setCutoffDays]     = useState(90)
  const [staleAsLost, setStaleAsLost]   = useState(true)
  const [users, setUsers]               = useState([])
  const [importing, setImporting]       = useState(false)
  const [progress, setProgress]         = useState({ done: 0, total: 0 })
  const [result, setResult]             = useState(null)
  // Phase 330 — synchronous re-entrancy latch (§47): a WebView ghost-click can
  // fire the import button several times in one tick; `importing` STATE flips
  // only after a render, so a second tap would start a second 500-row import.
  const importingRef = useRef(false)
  // Phase 330 — null = checking, true = quiet-import SQL is live, false = not yet.
  const [quietReady, setQuietReady] = useState(null)

  /* ─── File parse ─── */
  async function handleFile(f) {
    if (!f) return
    // Phase 330 — self mode: friendly guards BEFORE reading the file.
    if (selfMode) {
      if (/\.xlsx?$/i.test(f.name || '')) {
        toastError(null, 'Excel files are not supported yet. In Excel choose File → Save As → CSV UTF-8, then pick that file.')
        return
      }
      if (f.size > SELF_MAX_BYTES) {
        toastError(null, 'That file is larger than 2 MB. Split it into smaller files (500 leads each) and upload them one by one.')
        return
      }
    }
    setFile(f)
    setParsing(true)
    setResult(null)
    setRows([])
    try {
      // Phase 330 — strip the UTF-8 BOM Excel adds, or the first header
      // ("name") reads as "﻿name" and never maps.
      const text = (await f.text()).replace(/^﻿/, '')
      const all = parseCsv(text)
      if (all.length < 2) throw new Error('File has no data rows.')
      const hdrs = all[0].map(h => String(h || '').trim())
      const data = all.slice(1)
      if (selfMode && hdrs.length === 1 && /[;\t|]/.test(hdrs[0])) {
        throw new Error('This file separates columns with ; or tabs. Save it as "CSV UTF-8 (comma delimited)" and pick it again.')
      }
      if (selfMode && data.length > SELF_MAX_ROWS) {
        throw new Error(`This file has ${data.length} leads. The limit is ${SELF_MAX_ROWS} per file — split it and upload again.`)
      }
      setHeaders(hdrs)
      setColumnMap(buildColumnMap(hdrs, selfMode))
      setRows(data)
    } catch (e) {
      // Phase 34a — was browser alert(); now surfaces in the v2 toast
      // viewport so the rep can keep working while reading the error.
      toastError(e, 'Could not parse file.')
      setFile(null)
    } finally {
      setParsing(false)
    }
  }

  /* ─── Phase 330 — is the quiet-import SQL live? (self mode only) ───
     true = ready · false = the SQL has not been run (admin must) · 'error' = the
     check itself failed (weak network) -> the rep can retry. */
  function checkQuiet() {
    setQuietReady(null)
    supabase.rpc('lead_import_quiet_ready').then(({ data, error }) => {
      if (!error) setQuietReady(data === true)
      else setQuietReady(/PGRST202|42883|Could not find|does not exist/i.test(`${error.code} ${error.message}`) ? false : 'error')
    }, () => setQuietReady('error'))
  }
  useEffect(() => {
    if (selfMode) checkQuiet()
    // eslint-disable-next-line
  }, [selfMode])

  /* ─── Load users for assignee picker + telecaller name lookup ─── */
  useEffect(() => {
    // Phase 330 — reps don't need the user list (no owner picker, no Cronberry
    // telecaller lookup in self mode) -> skip the query entirely.
    if (!isPrivileged) return
    supabase
      .from('users')
      // Phase 99.B — added `role` so the new "Default telecaller"
      // dropdown's `u.role === 'telecaller'` filter actually resolves.
      // Without `role` in the SELECT the filter would always evaluate
      // undefined === 'telecaller' and the dropdown would show empty.
      .select('id, name, role, team_role, is_active')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setUsers(data || []))
  }, [])

  const userByName = useMemo(() => {
    const m = new Map()
    users.forEach(u => m.set((u.name || '').toLowerCase(), u))
    return m
  }, [users])

  /* ─── Preview ─── */
  const preview = useMemo(() => {
    // Phase 330 — was `!columnMap.name`: the column INDEX is a Number, so a
    // file whose Name is the FIRST column (index 0, the common case) read as
    // "not mapped" and the preview stayed empty (same falsy-0 trap Phase 27
    // fixed in commitImport). typeof check = 0 counts as mapped.
    if (selfMode || !rows.length || typeof columnMap.name !== 'number') return []
    const cutoffMs = cutoffDays > 0 ? Date.now() - cutoffDays * 24 * 60 * 60 * 1000 : null
    return rows.slice(0, 10).map(r => {
      const name = String(r[columnMap.name] || '').trim()
      const phoneRaw = columnMap.phone !== undefined ? r[columnMap.phone] : null
      const phone = cleanMobile(phoneRaw)
      const email = columnMap.email !== undefined ? String(r[columnMap.email] || '').trim() || null : null
      const company = columnMap.company !== undefined ? String(r[columnMap.company] || '').trim() || null : null
      const city = columnMap.city !== undefined ? String(r[columnMap.city] || '').trim() || null : null
      const remarks = columnMap.remarks !== undefined ? String(r[columnMap.remarks] || '').trim() || null : null
      const source = columnMap.source !== undefined ? String(r[columnMap.source] || '').trim() || 'Excel' : 'Excel'

      const parsed = parseRemarks(remarks)
      const classified = parsed?.statusText ? classifyStatus(parsed.statusText) : { stage: 'New' }
      const telecaller = parsed?.telecallerName ? userByName.get(parsed.telecallerName.toLowerCase()) : null

      let stage = classified.stage
      let lost_reason = classified.lost_reason
      let isNurture = !!classified.isNurture
      if (cutoffMs && parsed?.timestamp) {
        const ts = new Date(parsed.timestamp).getTime()
        if (!isNaN(ts) && ts < cutoffMs && staleAsLost && stage !== 'Won') {
          stage = 'Lost'
          lost_reason = 'Stale'
          isNurture = false
        }
      }

      return { name, phone, email, company, city, source, remarks, parsed, stage, lost_reason, isNurture, telecaller }
    })
  }, [rows, columnMap, cutoffDays, staleAsLost, userByName, selfMode])

  /* ─── Phase 330 — self mode: parse + check EVERY row once (<= 500) ───
     Drives the preview table and the "Import N leads" button, so the rep sees
     exactly what will be imported / skipped before pressing the button. */
  const selfCheck = useMemo(() => {
    if (!selfMode || !rows.length || typeof columnMap.name !== 'number') return null
    const cell = (r, key) => (columnMap[key] !== undefined ? String(r[columnMap[key]] ?? '').trim() : '')
    const seen = new Set()
    const items = []
    let ready = 0, noName = 0, badPhone = 0, dupInFile = 0
    rows.forEach((r, i) => {
      const name = cell(r, 'name')
      const phone = normalizeMobile10(columnMap.phone !== undefined ? r[columnMap.phone] : null)
      let status = 'ok'
      if (!name) { status = 'noName'; noName++ }
      else if (!phone) { status = 'badPhone'; badPhone++ }
      else if (seen.has(phone)) { status = 'dupInFile'; dupInFile++ }
      else { seen.add(phone); ready++ }
      items.push({
        row: i + 2, status, name, phone,
        company: cell(r, 'company') || null,
        email: cell(r, 'email') || null,
        city: cell(r, 'city') || null,
        notes: cell(r, 'remarks') || null,
      })
    })
    // Same column for Name and Mobile, or a Name column full of phone numbers =
    // the mapping is wrong; block the import instead of creating phone-named leads.
    const filled = items.filter(it => it.name)
    const phoneish = filled.filter(it => /^[+\d][\d\s().-]{7,}$/.test(it.name)).length
    let problem = null
    if (columnMap.name === columnMap.phone) problem = 'The Name and Mobile boxes point at the same column. Pick the right column for each.'
    else if (filled.length >= 3 && phoneish / filled.length > 0.5) problem = 'The Name column looks like phone numbers. Pick the column that holds the customer name.'
    return { items, ready, noName, badPhone, dupInFile, problem }
  }, [selfMode, rows, columnMap])

  const selfSegmentOk = selfCanPriv || selfCanGovt

  /* ─── Phase 330 — self-mode import ───
     Every row -> THIS rep's own list: assigned_to = me (telecaller also
     telecaller_id = me, §113), stage New, created_by = me, import_id set =
     the three quiet triggers skip it (lead_is_self_import). No lead_activities,
     no remarks classification, no stale/lost logic — a rep's own contacts all
     start as fresh New leads. Batches of 25 (one request each) with a per-row
     fallback so one rejected phone never loses its 24 neighbours. */
  async function commitSelfImport() {
    if (importingRef.current || importing) return
    if (!selfCheck || !selfCheck.ready) {
      pushToast('Nothing to import — no row has a name and a valid 10-digit mobile number.', 'warning')
      return
    }
    if (selfCheck.problem) { pushToast(selfCheck.problem, 'warning'); return }
    if (quietReady !== true) {
      pushToast('Upload is not switched on yet. Please ask the admin.', 'warning')
      return
    }
    if (!selfSegmentOk) {
      pushToast('Your account is not allowed to add leads. Please ask the admin.', 'warning')
      return
    }
    importingRef.current = true
    setImporting(true)
    setProgress({ done: 0, total: selfCheck.items.length })
    try {
      // Re-check right before the first insert: the readiness probe ran once at page
      // open; if an old phase SQL file was re-run since, the quiet triggers could be
      // gone and 500 inserts would flood this rep with alerts + follow-ups.
      const { data: qr, error: qe } = await supabase.rpc('lead_import_quiet_ready')
      if (qe || qr !== true) {
        setQuietReady(qe ? 'error' : false)
        pushToast(qe ? 'Could not confirm the setup. Check your internet and try again.'
                     : 'Upload is not switched on right now. Please ask the admin.', 'warning')
        return
      }
      const segment = (defaultSegment === 'GOVERNMENT' && selfCanGovt) ? 'GOVERNMENT'
                    : (selfCanPriv ? 'PRIVATE' : 'GOVERNMENT')

      // Audit row first (Phase 34a: abort if it didn't land — no orphan leads).
      const { data: importRow, error: impErr } = await supabase
        .from('lead_imports')
        .insert([{
          file_name: file?.name || 'unknown',
          uploaded_by: profile.id,
          total_rows: rows.length,
          default_assignee_id: profile.id,
          default_segment: segment,
          status: 'processing',
        }])
        .select()
        .single()
      if (impErr || !importRow?.id) {
        toastError(impErr, 'Could not start the upload. No leads were added.')
        return
      }
      const importId = importRow.id

      // Phones this rep already owns (created, assigned or telecaller-owned; paged
      // with a stable order — PostgREST caps one request at ~1000 rows, §66).
      // Compared on the LAST 10 DIGITS so "+91 98…" and "98…" are the same number.
      // A failed read stops the import: carrying on with a partial list would let
      // already-owned numbers through as duplicates.
      const own = new Set()
      for (let from = 0; from < 20000; from += 1000) {
        const { data: ex, error: exErr } = await supabase
          .from('leads')
          .select('phone')
          .or(`created_by.eq.${profile.id},assigned_to.eq.${profile.id},telecaller_id.eq.${profile.id}`)
          .order('id')
          .range(from, from + 999)
        if (exErr) {
          await supabase.from('lead_imports').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', importId)
          toastError(exErr, 'Could not check your existing leads. Nothing was added — please try again.')
          return
        }
        ;(ex || []).forEach(x => { const p = normalizeMobile10(x.phone); if (p) own.add(p) })
        if (!ex || ex.length < 1000) break
      }

      let imported = 0, dupes = 0
      const skipped = selfCheck.noName
      const skippedPhone = selfCheck.badPhone
      const errors = []
      const toInsert = []
      for (const it of selfCheck.items) {
        if (it.status === 'dupInFile') { dupes++; continue }
        if (it.status !== 'ok') continue
        if (own.has(it.phone)) { dupes++; continue }
        toInsert.push({
          source: SELF_SOURCE,
          name: it.name,
          company: it.company,
          phone: it.phone,
          email: it.email,
          city: it.city,
          segment,
          stage: 'New',
          assigned_to: profile.id,
          telecaller_id: profile.role === 'telecaller' ? profile.id : null,
          notes: it.notes,
          import_id: importId,
          created_by: profile.id,
          _row: it.row,
        })
      }

      let done = selfCheck.items.length - toInsert.length
      const strip = ({ _row, ...lead }) => lead
      // "This phone is already in an open lead ..." (leads_block_dup_phone) is the
      // normal reason one row is refused; anything else is a systematic problem.
      const isDupMsg = (m) => /already in an open lead|already exists|duplicate/i.test(m || '')
      let sysFailBatches = 0
      let stoppedAt = -1
      for (let i = 0; i < toInsert.length; i += SELF_BATCH) {
        const batch = toInsert.slice(i, i + SELF_BATCH)
        const { error: bErr } = await supabase.from('leads').insert(batch.map(strip))
        if (!bErr) {
          imported += batch.length
          sysFailBatches = 0
        } else {
          // The batch is one atomic request. A lost response can hide a batch that
          // actually landed, so first ask which of these numbers are already in this
          // upload before retrying anything (else they'd be reported as duplicates).
          let remaining = batch
          const { data: landed } = await supabase.from('leads').select('phone')
            .eq('import_id', importId).in('phone', batch.map(r => r.phone))
          if (landed && landed.length) {
            const have = new Set(landed.map(x => x.phone))
            imported += batch.filter(r => have.has(r.phone)).length
            remaining = batch.filter(r => !have.has(r.phone))
          }
          // One bad row (usually "already in someone's list") fails the whole
          // batch -> retry row by row so the rest still land.
          let okInBatch = 0, nonDupErr = null
          for (const row of remaining) {
            const { error: rErr } = await supabase.from('leads').insert([strip(row)])
            if (rErr) {
              errors.push({ row: row._row, error: rErr.message })
              if (!isDupMsg(rErr.message)) nonDupErr = rErr.message
            } else { imported++; okInBatch++ }
          }
          // Two whole batches in a row that failed for a non-duplicate reason (RLS,
          // segment, network): stop instead of hammering ~500 single requests.
          sysFailBatches = (okInBatch === 0 && nonDupErr) ? sysFailBatches + 1 : 0
          if (sysFailBatches >= 2) { stoppedAt = i + SELF_BATCH; break }
        }
        done += batch.length
        setProgress({ done: Math.min(done, selfCheck.items.length), total: selfCheck.items.length })
      }
      if (stoppedAt >= 0) {
        for (const row of toInsert.slice(stoppedAt)) {
          errors.push({ row: row._row, error: 'Not added — the upload stopped after repeated errors. Try again.' })
        }
        pushToast('Upload stopped after repeated errors. See the summary below.', 'warning')
      }

      const { error: finErr } = await supabase.from('lead_imports').update({
        imported_count: imported,
        skipped_count: skipped + skippedPhone,
        duplicate_count: dupes,
        errors: errors.length ? errors : null,
        status: (imported === 0 && errors.length > 0) ? 'failed' : 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', importId)
      if (finErr) toastError(finErr, 'Upload finished but the record could not be closed.')

      setProgress({ done: selfCheck.items.length, total: selfCheck.items.length })
      setResult({ imported, skipped, skippedPhone, dupes, errors })
      if (imported > 0) toastSuccess(`Added ${imported} lead${imported === 1 ? '' : 's'} to your list.`)
      else pushToast('No leads were added. See the summary below.', 'warning')
    } catch (e) {
      toastError(e, 'Upload stopped unexpectedly. Check My Leads before trying again.')
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  async function copyExample() {
    try {
      await navigator.clipboard.writeText(SELF_EXAMPLE_CSV)
      toastSuccess('Example copied. Paste it into a new file in Excel / Sheets.')
    } catch {
      pushToast('Could not copy. Select the example text and copy it by hand.', 'warning')
    }
  }

  /* ─── Import ─── */
  async function commitImport() {
    // Phase 27 — falsy bug: columnMap.name stores the column INDEX as
    // a Number. When Name is the FIRST column (index 0) — which is the
    // common case for CSVs starting with `name,email,phone,…` —
    // `!columnMap.name` evaluates to TRUE because `!0 === true`. That
    // made the import silently return without doing anything. Use a
    // typeof check so 0 is treated as a valid index.
    if (!rows.length || typeof columnMap.name !== 'number') {
      pushToast('Pick the Name column at minimum.', 'warning')
      return
    }
    setImporting(true)
    setProgress({ done: 0, total: rows.length })

    // Phase 34a — audit row first. The old code destructured `data`
    // without checking `error`, so if RLS or a constraint blocked the
    // insert, `importId` ended up undefined and the loop below
    // proceeded to insert hundreds of leads with `import_id = null` —
    // orphan rows with no audit trail. Abort the import if the
    // audit row didn't land.
    const { data: importRow, error: impErr } = await supabase
      .from('lead_imports')
      .insert([{
        file_name: file?.name || 'unknown',
        uploaded_by: profile.id,
        total_rows: rows.length,
        default_assignee_id: defaultSalesAssignee || null,
        default_segment: defaultSegment,
        status: 'processing',
      }])
      .select()
      .single()

    if (impErr || !importRow?.id) {
      setImporting(false)
      toastError(impErr, 'Could not start import — audit row failed to save. No leads were imported.')
      return
    }

    const importId = importRow.id

    let imported     = 0
    let skipped      = 0
    // Phase 99.C — phone-less Excel rows are skipped separately so
    // the result summary can surface them as "Skipped — missing
    // phone: N" instead of folding into the generic skipped count.
    let skippedPhone = 0
    let dupes        = 0
    const errors    = []
    const cutoffMs = cutoffDays > 0 ? Date.now() - cutoffDays * 24 * 60 * 60 * 1000 : null

    // Phone-based dedup against existing leads (created_by = me).
    const existingPhones = new Set()
    {
      const { data: ex } = await supabase
        .from('leads')
        .select('phone')
        .eq('created_by', profile.id)
      ;(ex || []).forEach(r => r.phone && existingPhones.add(r.phone))
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      try {
        const name = String(r[columnMap.name] || '').trim()
        if (!name) { skipped++; continue }
        const phone = columnMap.phone !== undefined ? cleanMobile(r[columnMap.phone]) : null
        // Phase 99.C — block phone-less Excel rows. Telecallers
        // can't call without a number; the row is unactionable.
        // Counted separately from generic `skipped` so the result
        // summary surfaces "Skipped — missing phone: N" explicitly.
        if (!phone) { skippedPhone++; continue }
        if (existingPhones.has(phone)) { dupes++; continue }
        const email = columnMap.email !== undefined ? String(r[columnMap.email] || '').trim() || null : null
        const company = columnMap.company !== undefined ? String(r[columnMap.company] || '').trim() || null : null
        const city = columnMap.city !== undefined ? String(r[columnMap.city] || '').trim() || null : null
        const remarks = columnMap.remarks !== undefined ? String(r[columnMap.remarks] || '').trim() || null : null
        const source = columnMap.source !== undefined ? String(r[columnMap.source] || '').trim() || 'Excel' : 'Excel'

        const parsed = parseRemarks(remarks)
        const classified = parsed?.statusText ? classifyStatus(parsed.statusText) : { stage: 'New' }
        let stage = classified.stage
        let lost_reason = classified.lost_reason
        // Phase 30A — ex-Nurture branch sets nurture_revisit_date
        // 90 days out so the lead surfaces in the "Lost with revisit"
        // filter for the rep to follow up later.
        let isNurture = !!classified.isNurture
        const telecaller = parsed?.telecallerName ? userByName.get(parsed.telecallerName.toLowerCase()) : null

        if (cutoffMs && parsed?.timestamp) {
          const ts = new Date(parsed.timestamp).getTime()
          if (!isNaN(ts) && ts < cutoffMs && staleAsLost && stage !== 'Won') {
            stage = 'Lost'
            lost_reason = 'Stale'
            isNurture = false
          }
        }

        const ninetyDaysOut = new Date()
        ninetyDaysOut.setDate(ninetyDaysOut.getDate() + 90)

        const leadRow = {
          source,
          name,
          company,
          phone,
          email,
          city,
          segment: defaultSegment,
          stage,
          lost_reason,
          nurture_revisit_date: isNurture ? ninetyDaysOut.toISOString().slice(0, 10) : null,
          // Phase 99.B — split sources. Sales-owner pick writes to
          // assigned_to. TC pick writes to telecaller_id. Admin
          // explicit TC pick overrides Cronberry Remarks parse
          // result (`telecaller?.id`) per Decision 3 in the
          // /telecaller routing repair memo.
          assigned_to:   defaultSalesAssignee || null,
          telecaller_id: defaultTelecallerAssignee || telecaller?.id || null,
          notes_legacy_telecaller: parsed?.telecallerName && !telecaller ? parsed.telecallerName : null,
          notes: parsed?.statusText || remarks,
          last_contact_at: parsed?.timestamp || null,
          import_id: importId,
          created_by: profile.id,
        }

        const { data: leadInserted, error: leadErr } = await supabase
          .from('leads')
          .insert([leadRow])
          .select()
          .single()

        if (leadErr) {
          errors.push({ row: i + 2, error: leadErr.message })
          continue
        }

        // Activity row from parsed Cronberry remarks
        if (parsed?.statusText && parsed?.timestamp) {
          await supabase.from('lead_activities').insert([{
            lead_id: leadInserted.id,
            activity_type: 'note',
            outcome: ['no enquiry','not interested','wrong number','only time pass'].some(
              k => parsed.statusText.toLowerCase().includes(k)
            ) ? 'negative' : null,
            notes: parsed.statusText + (parsed.telecallerName ? ` (by ${parsed.telecallerName})` : ''),
            created_by: telecaller?.id || profile.id,
            created_at: parsed.timestamp,
          }])
        }

        imported++
        if (phone) existingPhones.add(phone)
      } catch (e) {
        errors.push({ row: i + 2, error: e.message })
      }
      if (i % 5 === 0) setProgress({ done: i + 1, total: rows.length })
    }

    // Finalize audit. Phase 34a — surface error if the audit update
    // itself fails so the rep doesn't see "import finished" while the
    // lead_imports row stays stuck on "processing".
    if (importId) {
      const { error: finErr } = await supabase.from('lead_imports').update({
        imported_count: imported,
        skipped_count: skipped,
        duplicate_count: dupes,
        errors: errors.length ? errors : null,
        status: errors.length === rows.length ? 'failed' : 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', importId)
      if (finErr) toastError(finErr, 'Import audit row could not be finalised.')
    }

    setProgress({ done: rows.length, total: rows.length })
    setImporting(false)
    // Phase 99.C — surface skippedPhone separately in the result.
    setResult({ imported, skipped, skippedPhone, dupes, errors })

    // Phase 34a — summary toast so the rep sees the outcome even if
    // they scroll past the result panel.
    if (errors.length === rows.length) {
      pushToast(`Import failed — all ${rows.length} rows rejected. See error list.`, 'danger', { ttl: 0 })
    } else if (errors.length) {
      pushToast(`Imported ${imported} of ${rows.length} leads. ${errors.length} failed, ${dupes} duplicates skipped.`, 'warning')
    } else {
      toastSuccess(`Imported ${imported} leads${dupes ? ` (${dupes} duplicates skipped)` : ''}.`)
    }
  }

  /* ─── Render ─── */
  // Phase 16 — wrapped in lead-root so typography matches the rest of
  // the lead module. Underlying v2d-panel + v2d-q-table classes still
  // resolve from v2.css; visual style stays close to the lead-card
  // aesthetic since both share the same tokens.css source.
  const stepIdx = !rows.length && !result ? 0 : result ? 3 : 2

  // Phase 330 — access gate moved BELOW every hook (was an early return above
  // the useEffect/useMemo calls = rules-of-hooks violation). Same message for
  // roles that may not import; Lucide icon instead of the old emoji.
  if (!canUpload) {
    return (
      <div className="v2d-leads">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--danger-soft, rgba(239,68,68,.12))',
          border: '1px solid var(--danger, #EF4444)',
          color: 'var(--danger, #EF4444)',
          borderRadius: 12, padding: '14px 18px', fontSize: 13,
        }}>
          <AlertTriangle size={16} />
          <span>Only sales, telecaller, admin and co-owner users can import leads.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="lead-root">
      <button
        className="lead-btn lead-btn-sm"
        onClick={() => navigate('/leads')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={12} /> All Leads
      </button>

      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">
            {selfMode ? 'Bulk import · your own leads' : 'Bulk import · admin only'}
          </div>
          <div className="lead-page-title">{selfMode ? 'Upload leads (CSV)' : 'Upload CSV'}</div>
          <div className="lead-page-sub">
            {selfMode
              ? `Add many of your own contacts at once · up to ${SELF_MAX_ROWS} per file · they go quietly into your list (no alerts, no follow-ups created)`
              : 'Cronberry / Excel exports · auto-classifies stage from Remarks'}
          </div>
        </div>
      </div>

      {/* Phase 330 — the quiet-import SQL has not been run yet: refuse instead
          of letting reps flood themselves with one alert + follow-up per lead. */}
      {selfMode && quietReady === 'error' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap',
          background: 'var(--warning-soft, rgba(245,158,11,.12))',
          border: '1px solid var(--warning, #F59E0B)',
          color: 'var(--warning, #F59E0B)',
          borderRadius: 12, padding: '12px 16px', fontSize: 13,
        }}>
          <AlertTriangle size={16} />
          <span>Could not check the connection. Check your internet and try again.</span>
          <button className="v2d-ghost v2d-ghost--btn" onClick={checkQuiet}>Try again</button>
        </div>
      )}
      {selfMode && quietReady === false && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
          background: 'var(--warning-soft, rgba(245,158,11,.12))',
          border: '1px solid var(--warning, #F59E0B)',
          color: 'var(--warning, #F59E0B)',
          borderRadius: 12, padding: '12px 16px', fontSize: 13,
        }}>
          <AlertTriangle size={16} />
          <span>Lead upload is not switched on yet. Please ask the admin to finish the setup.</span>
        </div>
      )}

      {/* Step strip from design */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center' }}>
        {['Pick file', 'Preview', 'Map columns', 'Import'].map((s, i) => (
          <div key={s} style={{ display: 'flex', flex: i < 3 ? 1 : 'none', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: i <= stepIdx ? 'var(--text)' : 'var(--text-subtle)' }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: i < stepIdx ? 'var(--success)' : i === stepIdx ? 'var(--accent)' : 'var(--surface-2)',
                color: i === stepIdx ? 'var(--accent-fg)' : i < stepIdx ? 'white' : 'var(--text-muted)',
                display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600,
              }}>{i < stepIdx ? '✓' : i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: i === stepIdx ? 600 : 500, whiteSpace: 'nowrap' }}>{s}</span>
            </span>
            {i < 3 ? <div style={{ flex: 1, height: 1, background: 'var(--border)' }} /> : null}
          </div>
        ))}
      </div>

      {/* File pick */}
      {!rows.length && !result && (
        <div className="v2d-panel" style={{ padding: 28, textAlign: 'center' }}>
          <FileSpreadsheet size={22} style={{ color: 'var(--v2-yellow, #FFE600)', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {selfMode ? 'Choose your CSV file' : 'Drop file or click to browse'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 16 }}>
            {selfMode
              ? 'CSV files only. In Excel or Google Sheets choose File → Save As → CSV UTF-8. Each row needs a name and a 10-digit mobile number.'
              : 'Accepts .csv files. For .xlsx, save as CSV in Excel first. Cronberry\'s "Download Data" exports CSV directly.'}
          </div>
          <label className="v2d-cta" style={{ display: 'inline-flex', cursor: parsing ? 'wait' : 'pointer' }}>
            {parsing ? (
              <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Reading…</>
            ) : (
              <><Upload size={14} /> Choose CSV</>
            )}
            <input
              type="file"
              accept={selfMode
                ? '.csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain'
                : '.csv,text/csv'}
              style={{ display: 'none' }}
              disabled={parsing}
              onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }}
            />
          </label>

          {selfMode && (
            <div style={{ marginTop: 22, textAlign: 'left', maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Example file (first row = column names)</div>
              <pre style={{
                margin: 0, padding: 12, fontSize: 11, lineHeight: 1.5,
                background: 'var(--v2-bg-2, var(--surface-2))',
                border: '1px solid var(--v2-line, var(--border))',
                borderRadius: 10, overflowX: 'auto', whiteSpace: 'pre',
                color: 'var(--v2-ink-1, var(--text))',
              }}>{SELF_EXAMPLE_CSV}</pre>
              <button
                className="v2d-ghost v2d-ghost--btn"
                onClick={copyExample}
                style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Copy size={14} /> Copy example
              </button>
            </div>
          )}
        </div>
      )}

      {/* Phase 330 — self mode: map → check → import (admin block below is untouched) */}
      {selfMode && rows.length > 0 && !result && (
        <>
          <div className="v2d-panel" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Check your columns · {rows.length} {rows.length === 1 ? 'row' : 'rows'} in {file?.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 12 }}>
              We matched the columns automatically. Change a box only if it is wrong.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {[['name', 'Name *'], ['phone', 'Mobile *'], ['email', 'Email'],
                ['company', 'Company'], ['city', 'City'], ['remarks', 'Notes']].map(([target, label]) => (
                <div key={target} className="fg" style={{ marginBottom: 0 }}>
                  <label>{label}</label>
                  <select
                    value={columnMap[target] ?? ''}
                    onChange={e => setColumnMap(m => ({
                      ...m,
                      [target]: e.target.value === '' ? undefined : Number(e.target.value),
                    }))}
                    style={{ width: '100%' }}
                  >
                    <option value="">— none —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="v2d-panel" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Where these leads go</div>
            {selfCanPriv && selfCanGovt ? (
              <div className="fg" style={{ marginBottom: 8, maxWidth: 260 }}>
                <label>Add them as</label>
                <select value={defaultSegment} onChange={e => setDefaultSegment(e.target.value)} style={{ width: '100%' }}>
                  <option value="PRIVATE">PRIVATE</option>
                  <option value="GOVERNMENT">GOVERNMENT</option>
                </select>
              </div>
            ) : (
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                Added as <strong>{selfCanGovt && !selfCanPriv ? 'GOVERNMENT' : 'PRIVATE'}</strong> leads (your account's segment).
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2)' }}>
              Every lead goes into <strong>your own list</strong> as <strong>New</strong>. No alerts are sent and no
              follow-up is created until you start working a lead. Numbers already in your list are skipped.
            </div>
          </div>

          {selfCheck ? (
            <div className="v2d-panel" style={{ padding: 18, marginBottom: 14 }}>
              {selfCheck.problem && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                  background: 'var(--danger-soft, rgba(239,68,68,.12))',
                  border: '1px solid var(--danger, #EF4444)',
                  color: 'var(--danger, #EF4444)',
                  borderRadius: 10, padding: '10px 12px', fontSize: 12,
                }}>
                  <AlertTriangle size={14} /> <span>{selfCheck.problem}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {[
                  { n: selfCheck.ready,     label: 'ready to import',            tone: 'success' },
                  { n: selfCheck.noName,    label: 'without a name',             tone: 'warning' },
                  { n: selfCheck.badPhone,  label: 'without a valid 10-digit mobile', tone: 'warning' },
                  { n: selfCheck.dupInFile, label: 'repeated in this file',      tone: 'warning' },
                ].filter(c => c.n > 0).map(c => (
                  <span key={c.label} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: `var(--${c.tone}-soft, rgba(245,158,11,.12))`,
                    color: `var(--${c.tone}, #F59E0B)`,
                  }}>
                    <span style={{ fontFamily: 'var(--v2-display)' }}>{c.n}</span> {c.label}
                  </span>
                ))}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="v2d-q-table">
                  <thead>
                    <tr><th>Row</th><th>Name</th><th>Mobile</th><th>Company</th><th>City</th><th>Check</th></tr>
                  </thead>
                  <tbody>
                    {selfCheck.items.slice(0, 10).map(it => (
                      <tr key={it.row}>
                        <td style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>{it.row}</td>
                        <td><strong>{it.name || '—'}</strong></td>
                        <td style={{ fontSize: 12 }}>{it.phone || '—'}</td>
                        <td style={{ fontSize: 12 }}>{it.company || '—'}</td>
                        <td style={{ fontSize: 12 }}>{it.city || '—'}</td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                            fontSize: 11, fontWeight: 600,
                            background: it.status === 'ok' ? 'var(--success-soft, rgba(16,185,129,.12))' : 'var(--warning-soft, rgba(245,158,11,.12))',
                            color: it.status === 'ok' ? 'var(--success, #10B981)' : 'var(--warning, #F59E0B)',
                          }}>
                            {it.status === 'ok' ? 'OK'
                              : it.status === 'noName' ? 'No name'
                              : it.status === 'badPhone' ? 'Bad mobile'
                              : 'Repeated'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {selfCheck.items.length > 10 && (
                <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 8 }}>
                  Showing the first 10 of {selfCheck.items.length} rows. The checks above cover every row.
                </div>
              )}
            </div>
          ) : (
            <div className="v2d-panel" style={{ padding: 18, marginBottom: 14, fontSize: 12, color: 'var(--v2-ink-2)' }}>
              Choose which column holds the <strong>Name</strong> to see your preview.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              className="v2d-ghost v2d-ghost--btn"
              onClick={() => { setRows([]); setFile(null); setColumnMap({}) }}
              disabled={importing}
            >
              Start over
            </button>
            <button
              className="v2d-cta"
              onClick={commitSelfImport}
              disabled={importing || !selfCheck || !selfCheck.ready || !!selfCheck.problem || quietReady !== true}
            >
              {importing ? (
                <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Adding {progress.done}/{progress.total}…</>
              ) : (
                <><Upload size={14} /> Add {selfCheck?.ready || 0} leads to my list</>
              )}
            </button>
          </div>
        </>
      )}

      {/* Column mapping + preview */}
      {!selfMode && rows.length > 0 && !result && (
        <>
          <div className="v2d-panel" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
              Column mapping ({rows.length} data rows in {file?.name})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {['name','phone','email','company','city','remarks','source'].map(target => (
                <div key={target} className="fg" style={{ marginBottom: 0 }}>
                  <label style={{ textTransform: 'capitalize' }}>{target}</label>
                  <select
                    value={columnMap[target] ?? ''}
                    onChange={e => setColumnMap(m => ({
                      ...m,
                      [target]: e.target.value === '' ? undefined : Number(e.target.value),
                    }))}
                    style={{ width: '100%' }}
                  >
                    <option value="">— skip —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>{h || `Column ${i+1}`}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="v2d-panel" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Import options</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="fg">
                <label>Default segment</label>
                <select value={defaultSegment} onChange={e => setDefaultSegment(e.target.value)} style={{ width: '100%' }}>
                  <option value="PRIVATE">PRIVATE</option>
                  <option value="GOVERNMENT">GOVERNMENT</option>
                </select>
              </div>
              <div className="fg" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Phase 99.B — split single "Default assignee" into
                    two explicit dropdowns. Pre-99.B the single
                    dropdown listed all 4 role buckets and wrote the
                    pick to leads.assigned_to regardless, so admin
                    picking a TC routed the lead to the wrong
                    column. Phase 99.A repaired 107 affected rows
                    on 2026-05-29. */}
                <div>
                  <label>Default sales owner</label>
                  <select
                    value={defaultSalesAssignee}
                    onChange={e => setDefaultSalesAssignee(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="">— unassigned —</option>
                    {users
                      // Phase 214 — no 'agency': commission-only, never owns leads
                      .filter(u => ['sales','sales_manager'].includes(u.team_role))
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label>Default telecaller</label>
                  <select
                    value={defaultTelecallerAssignee}
                    onChange={e => setDefaultTelecallerAssignee(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="">— unassigned —</option>
                    {users
                      .filter(u => u.role === 'telecaller')
                      .map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="fg">
                <label>Cutoff days for active leads</label>
                <input
                  type="number"
                  min="0"
                  value={cutoffDays}
                  onChange={e => setCutoffDays(Number(e.target.value) || 0)}
                />
                <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 4 }}>
                  Leads older than this get auto-marked Lost/Stale (per master spec §17.5). 0 = disable cutoff.
                </p>
              </div>
              <div className="fg" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 24 }}>
                <input
                  type="checkbox"
                  id="stale-as-lost"
                  checked={staleAsLost}
                  onChange={e => setStaleAsLost(e.target.checked)}
                />
                <label htmlFor="stale-as-lost" style={{ margin: 0 }}>
                  Mark stale leads as Lost (reason: Stale)
                </label>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="v2d-panel" style={{ marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', fontSize: 13, fontWeight: 600, borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))' }}>
              Preview (first 10 rows)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="v2d-q-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Stage</th>
                    <th>Telecaller</th>
                    <th>Last contact</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i}>
                      <td><strong>{p.name}</strong>{p.company && <div style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>{p.company}</div>}</td>
                      <td style={{ fontFamily: 'inherit', fontSize: 12 }}>{p.phone || '—'}</td>
                      <td>
                        {/* Phase 30A — 5 stages. Lost-with-revisit
                            (the ex-Nurture branch) gets the blue tint
                            so the importer preview still flags
                            "follow-up-later" rows differently from
                            the dead-Lost rows. */}
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                          fontSize: 11, fontWeight: 600,
                          background: p.isNurture ? 'rgba(96,165,250,.12)' :
                                       p.stage === 'Lost' ? 'rgba(248,113,113,.10)' :
                                       p.stage === 'Won' ? 'rgba(74,222,128,.10)' :
                                       'rgba(251,191,36,.10)',
                          color: p.isNurture ? '#60a5fa' :
                                 p.stage === 'Lost' ? '#f87171' :
                                 p.stage === 'Won' ? 'var(--success, #10B981)' :
                                 'var(--warning, #F59E0B)',
                        }}>
                          {p.isNurture ? 'Lost · revisit 90d' : p.stage}{p.lost_reason ? ` · ${p.lost_reason}` : ''}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {p.telecaller ? p.telecaller.name :
                          p.parsed?.telecallerName ? <span style={{ color: 'var(--v2-ink-2)' }}>{p.parsed.telecallerName} (no match)</span> :
                          <span style={{ color: 'var(--v2-ink-2)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 11, fontFamily: 'inherit', color: 'var(--v2-ink-2)' }}>
                        {p.parsed?.timestamp ? new Date(p.parsed.timestamp).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.parsed?.statusText || p.remarks || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              className="v2d-ghost v2d-ghost--btn"
              onClick={() => { setRows([]); setFile(null); setColumnMap({}) }}
              disabled={importing}
            >
              Start over
            </button>
            <button
              className="v2d-cta"
              onClick={commitImport}
              disabled={importing || typeof columnMap.name !== 'number'}
            >
              {importing ? (
                <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Importing {progress.done}/{progress.total}…</>
              ) : (
                <><Upload size={14} /> Import {rows.length} leads</>
              )}
            </button>
          </div>
        </>
      )}

      {/* Result */}
      {result && (
        <div className="v2d-panel" style={{ padding: 24, textAlign: 'center' }}>
          <CheckCircle2 size={22} style={{ color: 'var(--success, #10B981)', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Import complete</div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap', margin: '16px 0' }}>
            <div>
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 600, color: 'var(--success, #10B981)' }}>{result.imported}</div>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Imported</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 600, color: 'var(--warning, #F59E0B)' }}>{result.dupes}</div>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Duplicates</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 600, color: 'var(--v2-ink-2)' }}>{result.skipped}</div>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Skipped</div>
            </div>
            {/* Phase 99.C — phone-less rows surfaced as their own
                tile so admin sees the count without digging. Warning
                tint (not error) because the rows are user-correctable
                via Excel cleanup, not a system fault. */}
            {result.skippedPhone > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 600, color: 'var(--warning, #F59E0B)' }}>{result.skippedPhone}</div>
                <div style={{ fontSize: 11, color: 'var(--warning, #F59E0B)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Missing phone</div>
              </div>
            )}
            <div>
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 600, color: '#f87171' }}>{result.errors.length}</div>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Errors</div>
            </div>
          </div>
          {selfMode && result.errors.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginTop: 4 }}>
              A number listed under Errors is usually already in an open lead — the message says whose it is.
            </div>
          )}
          {result.errors.length > 0 && (
            <details style={{ textAlign: 'left', marginTop: 12, fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#f87171' }}>View {result.errors.length} errors</summary>
              <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--v2-ink-2)' }}>
                {result.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>Row {e.row}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="v2d-ghost v2d-ghost--btn" onClick={() => { setRows([]); setFile(null); setResult(null); setColumnMap({}) }}>
              Import another file
            </button>
            <button className="v2d-cta" onClick={() => navigate('/leads')}>
              View leads
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
