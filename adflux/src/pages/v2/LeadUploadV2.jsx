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
// Admin-only. Live progress bar. Audit row in lead_imports.

import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2,
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

function buildColumnMap(headers) {
  const map = {}
  for (const target of Object.keys(HEADER_ALIASES)) {
    const idx = headers.findIndex(h => detectColumn(h, target))
    if (idx >= 0) map[target] = idx
  }
  return map
}

/* ─── Component ─── */
export default function LeadUploadV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)

  const [file, setFile]                 = useState(null)
  const [parsing, setParsing]           = useState(false)
  const [rows, setRows]                 = useState([])
  const [headers, setHeaders]           = useState([])
  const [columnMap, setColumnMap]       = useState({})
  const [defaultSegment, setDefaultSegment] = useState('PRIVATE')
  const [defaultAssignee, setDefaultAssignee] = useState('')
  const [cutoffDays, setCutoffDays]     = useState(90)
  const [staleAsLost, setStaleAsLost]   = useState(true)
  const [users, setUsers]               = useState([])
  const [importing, setImporting]       = useState(false)
  const [progress, setProgress]         = useState({ done: 0, total: 0 })
  const [result, setResult]             = useState(null)

  if (!isPrivileged) {
    return (
      <div className="v2d-leads">
        <div style={{
          background: 'rgba(248,113,113,.10)',
          border: '1px solid rgba(248,113,113,.28)',
          color: '#f87171',
          borderRadius: 12, padding: '14px 18px', fontSize: 13,
        }}>
          ⚠ Admin or co-owner access required to import leads.
        </div>
      </div>
    )
  }

  /* ─── File parse ─── */
  async function handleFile(f) {
    if (!f) return
    setFile(f)
    setParsing(true)
    setResult(null)
    setRows([])
    try {
      const text = await f.text()
      const all = parseCsv(text)
      if (all.length < 2) throw new Error('File has no data rows.')
      const hdrs = all[0].map(h => String(h || '').trim())
      const data = all.slice(1)
      setHeaders(hdrs)
      setColumnMap(buildColumnMap(hdrs))
      setRows(data)
    } catch (e) {
      // Phase 34a — was browser alert(); now surfaces in the v2 toast
      // viewport so the rep can keep working while reading the error.
      toastError(e, 'Could not parse file.')
    } finally {
      setParsing(false)
    }
  }

  /* ─── Load users for assignee picker + telecaller name lookup ─── */
  useEffect(() => {
    supabase
      .from('users')
      .select('id, name, team_role, is_active')
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
    if (!rows.length || !columnMap.name) return []
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
  }, [rows, columnMap, cutoffDays, staleAsLost, userByName])

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
        default_assignee_id: defaultAssignee || null,
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

    let imported = 0
    let skipped  = 0
    let dupes    = 0
    const errors = []
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
        if (phone && existingPhones.has(phone)) { dupes++; continue }
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
          assigned_to: defaultAssignee || null,
          telecaller_id: telecaller?.id || null,
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
    setResult({ imported, skipped, dupes, errors })

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
          <div className="lead-page-eyebrow">Bulk import · admin only</div>
          <div className="lead-page-title">Upload CSV</div>
          <div className="lead-page-sub">
            Cronberry / Excel exports · auto-classifies stage from Remarks
          </div>
        </div>
      </div>

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
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Drop file or click to browse</div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 16 }}>
            Accepts .csv files. For .xlsx, save as CSV in Excel first.
            Cronberry's "Download Data" exports CSV directly.
          </div>
          <label className="v2d-cta" style={{ display: 'inline-flex', cursor: parsing ? 'wait' : 'pointer' }}>
            {parsing ? (
              <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Reading…</>
            ) : (
              <><Upload size={14} /> Choose CSV</>
            )}
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              disabled={parsing}
              onChange={e => handleFile(e.target.files?.[0])}
            />
          </label>
        </div>
      )}

      {/* Column mapping + preview */}
      {rows.length > 0 && !result && (
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
              <div className="fg">
                <label>Default assignee</label>
                <select value={defaultAssignee} onChange={e => setDefaultAssignee(e.target.value)} style={{ width: '100%' }}>
                  <option value="">— unassigned —</option>
                  {/* Phase 27 — telecallers can also own raw imported leads
                      (the inside-sales caller works the queue first). Office
                      staff stays excluded — they don't work leads. */}
                  {users.filter(u => ['sales','agency','sales_manager','telecaller'].includes(u.team_role)).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
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
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.phone || '—'}</td>
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
                      <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--v2-ink-2)' }}>
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
            <div>
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 24, fontWeight: 600, color: '#f87171' }}>{result.errors.length}</div>
              <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Errors</div>
            </div>
          </div>
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
