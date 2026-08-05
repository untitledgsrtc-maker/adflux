// =============================================================================
// HRCandidatesV2 — HR Recruit pipeline (Phase 281, spec §B).
// Candidates + resume storage (private bucket, signed-URL download) + shortlist
// stages + recruitment call LOGS (no audio) + convert-to-hire prefill.
// Admin / co_owner / hr only (route guard RequireHROrPrivileged + hr_* RLS).
// Additive, HR-facing. No leads/quotes/payroll touched.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, Plus, Phone, FileText, Upload, Star, Trash2, UserPlus, X,
  ClipboardList, Loader2, Search, Sparkles,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'
import { dialPhone } from '../../utils/openExternal'
import { syncCandidateCalls } from '../../utils/hrCandidateCallSync'

const STAGES = [
  { key: 'applied',     label: 'Applied',     color: 'var(--blue, #3B82F6)' },
  { key: 'shortlisted', label: 'Shortlisted', color: 'var(--warning, #F59E0B)' },
  { key: 'interview',   label: 'Interview',   color: 'var(--accent, #FFE600)' },
  { key: 'hired',       label: 'Hired',       color: 'var(--success, #10B981)' },
  { key: 'rejected',    label: 'Rejected',    color: 'var(--danger, #EF4444)' },
]
const STAGE_META = Object.fromEntries(STAGES.map(s => [s.key, s]))
const ROLE_SUGGESTIONS = ['Sales', 'Telecaller', 'Accounts', 'HR', 'Designer', 'Video Editor', 'Admin', 'Office Staff']
const CALL_OUTCOMES = ['connected', 'no_answer', 'callback', 'not_interested', 'shortlisted', 'rejected']

function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d)) return '—'
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}
function cleanPhone(raw) { return (raw || '').replace(/\D/g, '') }

export default function HRCandidatesV2() {
  const nav = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const [rows, setRows] = useState([])
  const [callMap, setCallMap] = useState({})   // candidate_id -> { count, last }
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [stageFilter, setStageFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [callFor, setCallFor] = useState(null)  // candidate being logged

  // call counts + latest outcome per candidate — server-side aggregate RPC
  // (§66/§274: never pull raw call rows to count client-side; the ~1000-row cap
  // would silently undercount). Errors → empty map (deploy-before-SQL).
  async function loadCallCounts() {
    const { data: counts } = await supabase.rpc('hr_candidate_call_counts')
    const m = {}
    for (const c of counts || []) m[c.candidate_id] = { count: Number(c.call_count) || 0, last: c.last_outcome }
    setCallMap(m)
  }

  async function load() {
    setLoading(true); setErr(null)
    const { data, error } = await supabase
      .from('hr_candidates')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) { setErr(error.message); setLoading(false); return }
    const list = data || []
    setRows(list)
    // Phase 284 — auto-fetch device calls to these candidates (native-only,
    // best-effort), THEN load the counts so they reflect the fresh device rows.
    try { await syncCandidateCalls(list, profile?.id) } catch { /* best-effort */ }
    await loadCallCounts()
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Phase 284 — when HR returns from a call (app foregrounds), re-scan the device
  // log so the just-ended call appears without a manual refresh.
  useEffect(() => {
    function onVis() {
      if (document.visibilityState !== 'visible') return
      ;(async () => { try { await syncCandidateCalls(rows, profile?.id) } catch { /* noop */ } await loadCallCounts() })()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [rows, profile?.id])

  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const s of STAGES) c[s.key] = 0
    for (const r of rows) if (c[r.stage] != null) c[r.stage] += 1
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = q.replace(/\D/g, '')
    return rows.filter(r => {
      if (stageFilter !== 'all' && r.stage !== stageFilter) return false
      if (!q) return true
      return (r.name || '').toLowerCase().includes(q)
        || (r.role_applied || '').toLowerCase().includes(q)
        || (qd.length >= 3 && cleanPhone(r.phone).includes(qd))
    })
  }, [rows, stageFilter, search])

  async function patch(id, obj) {
    const { error } = await supabase.from('hr_candidates').update(obj).eq('id', id)
    if (error) { toastError(error, 'Could not update candidate.'); return false }
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...obj } : r))
    return true
  }

  async function removeCandidate(r) {
    if (!(await confirmDialog({
      title: 'Delete candidate?',
      message: `Delete ${r.name} and their call history? This cannot be undone.`,
      confirmLabel: 'Delete', danger: true,
    }))) return
    if (r.resume_path) {
      await supabase.storage.from('candidate-resumes').remove([r.resume_path]) // best-effort
    }
    const { error } = await supabase.from('hr_candidates').delete().eq('id', r.id)
    if (error) { toastError(error, 'Could not delete.'); return }
    setRows(rs => rs.filter(x => x.id !== r.id))
    toastSuccess('Candidate deleted.')
  }

  return (
    <div className="v2d-page">
      <div className="v2d-page-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="v2d-page-kicker">HR · Recruit</div>
          <h1 className="v2d-page-title">Candidates</h1>
          <div className="v2d-page-sub">Resumes, shortlist pipeline and recruitment calls.</div>
        </div>
        <button onClick={() => setShowAdd(true)} style={primaryBtn}><Plus size={16} /> Add candidate</button>
      </div>

      {/* stage filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <Chip active={stageFilter === 'all'} onClick={() => setStageFilter('all')} label="All" count={counts.all} />
        {STAGES.map(s => (
          <Chip key={s.key} active={stageFilter === s.key} onClick={() => setStageFilter(s.key)}
            label={s.label} count={counts[s.key]} dot={s.color} />
        ))}
      </div>

      {/* search */}
      <div style={{ position: 'relative', maxWidth: 340, marginBottom: 16 }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-subtle, #64748b)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, role or number"
          style={{ ...inp, paddingLeft: 32, width: '100%' }} />
        {search && <X size={15} onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: 10, cursor: 'pointer', color: 'var(--text-subtle)' }} />}
      </div>

      {showAdd && <AddForm profile={profile} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />}

      {loading ? (
        <div style={centerBox}><Loader2 size={22} className="spin" /> <span style={{ marginLeft: 8 }}>Loading…</span></div>
      ) : err ? (
        <div style={{ ...centerBox, border: '1px solid var(--danger, #EF4444)', color: 'var(--danger)' }}>
          {err} <button onClick={load} style={{ ...ghostBtn, marginLeft: 12 }}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={centerBox}>
          <ClipboardList size={26} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>{rows.length === 0 ? 'No candidates yet. Add your first one.' : 'No candidates match.'}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map(r => (
            <CandidateCard key={r.id} r={r} calls={callMap[r.id]}
              onPatch={patch} onDelete={removeCandidate} onCall={() => setCallFor(r)}
              onConvert={() => nav('/hr/new-user', { state: { prefill: { name: r.name, email: r.email, phone: r.phone, candidate_id: r.id } } })}
              onReload={load} />
          ))}
        </div>
      )}

      {callFor && <CallLogModal candidate={callFor} profile={profile}
        onClose={() => setCallFor(null)} onLogged={() => { setCallFor(null); load() }} />}

      <style>{`.spin{animation:hrspin 1s linear infinite}@keyframes hrspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── candidate card ──────────────────────────────────────────────────────────
function CandidateCard({ r, calls, onPatch, onDelete, onCall, onConvert, onReload }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const meta = STAGE_META[r.stage] || STAGES[0]

  async function viewResume() {
    if (!r.resume_path) return
    const { data, error } = await supabase.storage.from('candidate-resumes').createSignedUrl(r.resume_path, 600)
    if (error || !data?.signedUrl) { toastError(error, 'Could not open resume.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function uploadResume(file) {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toastError(null, 'File too large — 10 MB max.'); return }
    setBusy(true)
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${r.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('candidate-resumes').upload(path, file, { upsert: false })
    if (upErr) { setBusy(false); toastError(upErr, 'Upload failed.'); return }
    if (r.resume_path) await supabase.storage.from('candidate-resumes').remove([r.resume_path]) // drop old
    const ok = await onPatch(r.id, { resume_path: path })
    setBusy(false)
    if (ok) toastSuccess('Resume uploaded.')
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>{r.name}</span>
            <span style={{ ...chip, background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}>{meta.label}</span>
            {r.role_applied && <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>· {r.role_applied}</span>}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12.5, color: 'var(--text-muted, #94a3b8)' }}>
            {r.phone && <span>{r.phone}</span>}
            {r.email && <span>{r.email}</span>}
            {r.source && <span>via {r.source}</span>}
            <span>added {fmtDate(r.created_at)}</span>
            {calls?.count > 0 && <span>{calls.count} call{calls.count > 1 ? 's' : ''}{calls.last ? ` · ${calls.last}` : ''}</span>}
          </div>
          <Rating value={r.rating} onSet={v => onPatch(r.id, { rating: v })} />
        </div>

        {/* stage select */}
        <select value={r.stage} onChange={e => onPatch(r.id, { stage: e.target.value })} style={sel}>
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {r.phone && (
          <button onClick={() => dialPhone(r.phone)} style={actBtn}><Phone size={14} /> Call</button>
        )}
        {r.phone && (
          <button onClick={onCall} style={{ ...actBtn, borderColor: 'transparent', color: 'var(--text-subtle)' }} title="Add a note about a call">
            <FileText size={14} /> Note
          </button>
        )}
        {r.resume_path
          ? <button onClick={viewResume} style={actBtn}><FileText size={14} /> Resume</button>
          : null}
        <button onClick={() => fileRef.current?.click()} disabled={busy} style={actBtn}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {r.resume_path ? 'Replace' : 'Resume'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,image/*" style={{ display: 'none' }}
          onChange={e => { uploadResume(e.target.files?.[0]); e.target.value = '' }} />
        {r.stage === 'hired' && !r.converted_user_id && (
          <button onClick={onConvert} style={{ ...actBtn, borderColor: 'var(--success, #10B981)', color: 'var(--success)' }}>
            <UserPlus size={14} /> Create login
          </button>
        )}
        {r.converted_user_id && <span style={{ ...chip, background: 'var(--success-soft, rgba(16,185,129,.12))', color: 'var(--success)' }}>Login created</span>}
        <button onClick={() => onDelete(r)} style={{ ...actBtn, marginLeft: 'auto', borderColor: 'transparent', color: 'var(--text-subtle)' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {r.notes && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{r.notes}</div>}
    </div>
  )
}

function Rating({ value, onSet }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginTop: 8 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={15} onClick={() => onSet(value === n ? null : n)}
          style={{ cursor: 'pointer', fill: value >= n ? 'var(--accent, #FFE600)' : 'transparent', color: value >= n ? 'var(--accent, #FFE600)' : 'var(--text-subtle, #64748b)' }} />
      ))}
    </div>
  )
}

// ─── add candidate ───────────────────────────────────────────────────────────
function AddForm({ profile, onClose, onAdded }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', role_applied: '', source: '', notes: '' })
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [parsing, setParsing] = useState(false)
  const savingRef = useRef(false)
  const set = (k, v) => setF(o => ({ ...o, [k]: v }))

  // Phase 283 — read a resume PDF / platform screenshot with Claude and pre-fill
  // the empty fields. HR reviews + edits + saves; the file still uploads on save.
  async function parseFile() {
    if (!file || parsing) return
    const okType = file.type === 'application/pdf' || file.type.startsWith('image/')
    if (!okType) { toastError(null, 'Auto-fill needs a PDF or an image screenshot.'); return }
    if (file.size > 4.5 * 1024 * 1024) { toastError(null, 'File too large to read (4.5 MB max) — compress it first.'); return }
    setParsing(true)
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file)
      })
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/hr/parse-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ fileBase64: dataUrl, mediaType: file.type }),
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        toastError(null, j?.error === 'too_large' ? 'File too large to read.'
          : j?.error === 'unsupported_type' ? 'Auto-fill needs a PDF or image.'
          : j?.error === 'rate_limited' ? 'Too many reads — wait a minute and retry.'
          : 'Could not read the file — fill in manually.')
        return
      }
      setF(o => ({
        ...o,
        name:         o.name         || j.name || '',
        phone:        o.phone        || j.phone || '',
        email:        o.email        || j.email || '',
        role_applied: o.role_applied || j.role_applied || '',
      }))
      const got = [j.name, j.phone, j.email, j.role_applied].filter(Boolean).length
      if (got) toastSuccess(`Filled ${got} field${got > 1 ? 's' : ''} — review, then save.`)
      else toastError(null, 'Nothing readable found — fill in manually.')
    } catch { toastError(null, 'Could not read the file.') }
    finally { setParsing(false) }
  }

  async function save() {
    if (savingRef.current || saving) return
    if (!f.name.trim()) { toastError(null, 'Name is required.'); return }
    if (file && file.size > 10 * 1024 * 1024) { toastError(null, 'Resume too large — 10 MB max.'); return }
    savingRef.current = true; setSaving(true)
    const { data, error } = await supabase.from('hr_candidates').insert({
      name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null,
      role_applied: f.role_applied.trim() || null, source: f.source.trim() || null,
      notes: f.notes.trim() || null, created_by: profile?.id || null,
    }).select('id').single()
    if (error) { setSaving(false); savingRef.current = false; toastError(error, 'Could not add candidate.'); return }
    if (file && data?.id) {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `${data.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('candidate-resumes').upload(path, file, { upsert: false })
      if (!upErr) await supabase.from('hr_candidates').update({ resume_path: path }).eq('id', data.id)
      else toastError(upErr, 'Candidate saved, but resume upload failed.')
    }
    setSaving(false); savingRef.current = false
    toastSuccess('Candidate added.')
    onAdded()
  }

  return (
    <div style={{ ...card, marginBottom: 16, border: '1px solid var(--accent-soft, rgba(255,230,0,0.25))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ color: 'var(--text)' }}>New candidate</strong>
        <X size={18} onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-subtle)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <Field label="Name *"><input value={f.name} onChange={e => set('name', e.target.value)} style={inp} autoFocus /></Field>
        <Field label="Phone"><input value={f.phone} onChange={e => set('phone', e.target.value)} style={inp} inputMode="tel" /></Field>
        <Field label="Email"><input value={f.email} onChange={e => set('email', e.target.value)} style={inp} inputMode="email" /></Field>
        <Field label="Role applied">
          <input list="role-opts" value={f.role_applied} onChange={e => set('role_applied', e.target.value)} style={inp} />
          <datalist id="role-opts">{ROLE_SUGGESTIONS.map(r => <option key={r} value={r} />)}</datalist>
        </Field>
        <Field label="Source"><input value={f.source} onChange={e => set('source', e.target.value)} style={inp} placeholder="Referral / Naukri / Walk-in" /></Field>
        <Field label="Resume / screenshot (PDF or image)">
          <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={e => setFile(e.target.files?.[0] || null)} style={{ ...inp, padding: 6 }} />
          {file && (file.type === 'application/pdf' || file.type.startsWith('image/')) && (
            <button type="button" onClick={parseFile} disabled={parsing} style={{ ...actBtn, marginTop: 6, borderColor: 'var(--accent, #FFE600)' }}>
              {parsing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Auto-fill from file
            </button>
          )}
        </Field>
      </div>
      <Field label="Notes"><textarea value={f.notes} onChange={e => set('notes', e.target.value)} style={{ ...inp, minHeight: 60, resize: 'vertical' }} /></Field>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Save candidate</button>
        <button onClick={onClose} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  )
}

// ─── call log modal ──────────────────────────────────────────────────────────
function CallLogModal({ candidate, profile, onClose, onLogged }) {
  const [outcome, setOutcome] = useState('connected')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  async function save() {
    if (savingRef.current || saving) return
    savingRef.current = true; setSaving(true)
    const row = { candidate_id: candidate.id, called_by: profile?.id || null, outcome, notes: notes.trim() || null }
    let { error } = await supabase.from('hr_candidate_calls').insert({ ...row, source: 'manual' })
    // deploy-before-SQL: the `source` column ships in phase-p2; if it isn't run
    // yet the insert 400s on the unknown column — retry without it (§45).
    if (error && (error.code === '42703' || /source/i.test(error.message || ''))) {
      ;({ error } = await supabase.from('hr_candidate_calls').insert(row))
    }
    if (error) { setSaving(false); savingRef.current = false; toastError(error, 'Could not log call.'); return }
    // convenience: shortlisted/rejected outcome nudges the candidate stage
    if (outcome === 'shortlisted' && candidate.stage === 'applied') await supabase.from('hr_candidates').update({ stage: 'shortlisted' }).eq('id', candidate.id)
    if (outcome === 'rejected') await supabase.from('hr_candidates').update({ stage: 'rejected' }).eq('id', candidate.id)
    setSaving(false); savingRef.current = false
    toastSuccess('Call logged.')
    onLogged()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...card, width: 'min(440px, 92vw)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ color: 'var(--text)' }}>Log call · {candidate.name}</strong>
          <X size={18} onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-subtle)' }} />
        </div>
        <Field label="Outcome">
          <select value={outcome} onChange={e => setOutcome(e.target.value)} style={sel}>
            {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="What did they say?" /></Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? <Loader2 size={16} className="spin" /> : <Phone size={16} />} Save log</button>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── little primitives ───────────────────────────────────────────────────────
function Chip({ active, onClick, label, count, dot }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999,
      border: `1px solid ${active ? 'var(--accent, #FFE600)' : 'var(--border, #334155)'}`,
      background: active ? 'var(--accent-soft, rgba(255,230,0,0.14))' : 'var(--surface, #1e293b)',
      color: active ? 'var(--accent, #FFE600)' : 'var(--text-muted, #94a3b8)',
      fontSize: 13, fontWeight: 600, cursor: 'pointer',
    }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: 999, background: dot }} />}
      {label} <span style={{ opacity: 0.7 }}>{count}</span>
    </button>
  )
}
function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-subtle, #64748b)', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  )
}

const card = { background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, padding: 16 }
const centerBox = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, color: 'var(--text-muted, #94a3b8)', flexDirection: 'column', textAlign: 'center' }
const inp = { width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--border, #334155)', background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)', fontSize: 13.5, boxSizing: 'border-box' }
const sel = { ...inp, width: 'auto', minWidth: 130, cursor: 'pointer' }
const chip = { fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999 }
const actBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 10, border: '1px solid var(--border, #334155)', background: 'var(--surface-2, #334155)', color: 'var(--text, #f1f5f9)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border, #334155)', background: 'transparent', color: 'var(--text-muted, #94a3b8)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 16 }
