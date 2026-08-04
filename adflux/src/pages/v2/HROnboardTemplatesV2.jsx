// =============================================================================
// HROnboardTemplatesV2 — HR authors the per-role onboarding TEMPLATE (Phase 282).
// Pick a role -> add/reorder steps -> set owner (HR vs hire) -> attach material
// (pdf/video upload to the private bucket, or a link) -> mark has_test + author
// MCQs. Admin/co_owner/hr only (route guard + onboarding_* RLS).
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GraduationCap, Plus, Trash2, ChevronUp, ChevronDown, X, Loader2,
  ListChecks, FileText, Video, Check,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { confirmDialog } from '../../components/v2/ConfirmDialog'

const ROLES = ['sales', 'telecaller', 'accounts', 'hr', 'designer', 'video_editor', 'admin', 'office_staff']
const OWNERS = [
  { key: 'hire', label: 'New hire does it' },
  { key: 'hr', label: 'HR sets up' },
  { key: 'manager', label: 'Manager does it' },
]
const MAT_TYPES = [
  { key: '', label: 'No material' },
  { key: 'link', label: 'Link (URL)' },
  { key: 'pdf', label: 'PDF (upload)' },
  { key: 'video', label: 'Video (upload)' },
]

export default function HROnboardTemplatesV2() {
  const profile = useAuthStore(s => s.profile)
  const [templates, setTemplates] = useState([])
  const [selId, setSelId] = useState(null)
  const [steps, setSteps] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [newRole, setNewRole] = useState('sales')
  const savingRef = useRef(false)

  async function loadTemplates() {
    setLoading(true); setErr(null)
    const { data, error } = await supabase.from('onboarding_templates').select('*').order('role').limit(500)
    if (error) { setErr(error.message); setLoading(false); return }
    setTemplates(data || [])
    setLoading(false)
    if (!selId && data?.length) { setSelId(data[0].id) }
  }
  useEffect(() => { loadTemplates() }, [])

  async function loadSteps(tid) {
    if (!tid) { setSteps([]); return }
    const { data } = await supabase.from('onboarding_steps').select('*').eq('template_id', tid).order('step_order').limit(500)
    setSteps(data || [])
  }
  useEffect(() => { loadSteps(selId) }, [selId])

  const sel = useMemo(() => templates.find(t => t.id === selId) || null, [templates, selId])

  async function createTemplate() {
    if (savingRef.current) return
    savingRef.current = true
    const name = `${newRole.replace('_', ' ')} onboarding`
    const { data, error } = await supabase.from('onboarding_templates')
      .insert({ role: newRole, name, created_by: profile?.id || null }).select('*').single()
    savingRef.current = false
    if (error) {
      toastError(error, error.message?.includes('uniq_onboarding_template_active_role')
        ? `An active ${newRole} template already exists.` : 'Could not create template.')
      return
    }
    setTemplates(t => [...t, data]); setSelId(data.id); toastSuccess('Template created.')
  }

  async function addStep() {
    if (!selId) return
    const order = (steps[steps.length - 1]?.step_order ?? -1) + 1
    const { data, error } = await supabase.from('onboarding_steps')
      .insert({ template_id: selId, step_order: order, title: 'New step', owner: 'hire' }).select('*').single()
    if (error) { toastError(error, 'Could not add step.'); return }
    setSteps(s => [...s, data])
  }

  async function patchStep(id, obj) {
    const { error } = await supabase.from('onboarding_steps').update(obj).eq('id', id)
    if (error) { toastError(error, 'Could not save step.'); return false }
    setSteps(s => s.map(x => x.id === id ? { ...x, ...obj } : x))
    return true
  }

  async function removeStep(st) {
    if (!(await confirmDialog({ title: 'Delete step?', message: `Delete "${st.title}" and its test questions?`, confirmLabel: 'Delete', danger: true }))) return
    if (st.material_url && st.material_type && st.material_type !== 'link') {
      await supabase.storage.from('onboarding-material').remove([st.material_url])
    }
    const { error } = await supabase.from('onboarding_steps').delete().eq('id', st.id)
    if (error) { toastError(error, 'Could not delete.'); return }
    setSteps(s => s.filter(x => x.id !== st.id))
  }

  async function move(st, dir) {
    const idx = steps.findIndex(x => x.id === st.id)
    const j = idx + dir
    if (j < 0 || j >= steps.length) return
    const a = steps[idx], b = steps[j]
    await Promise.all([
      supabase.from('onboarding_steps').update({ step_order: b.step_order }).eq('id', a.id),
      supabase.from('onboarding_steps').update({ step_order: a.step_order }).eq('id', b.id),
    ])
    loadSteps(selId)
  }

  async function toggleActive(t) {
    // when re-activating, the partial unique index blocks a second active role
    const { error } = await supabase.from('onboarding_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    if (error) { toastError(error, error.message?.includes('uniq_') ? `Another active ${t.role} template exists.` : 'Could not update.'); return }
    setTemplates(ts => ts.map(x => x.id === t.id ? { ...x, is_active: !t.is_active } : x))
  }

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div className="v2d-page-kicker">HR · Onboard &amp; train</div>
        <h1 className="v2d-page-title">Onboarding templates</h1>
        <div className="v2d-page-sub">One checklist per role — steps, material and tests a new hire must clear.</div>
      </div>

      {/* create + template picker */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <select value={newRole} onChange={e => setNewRole(e.target.value)} style={sel_}>
          {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
        </select>
        <button onClick={createTemplate} style={primaryBtn}><Plus size={16} /> New template</button>
      </div>

      {loading ? (
        <div style={centerBox}><Loader2 size={22} className="spin" /></div>
      ) : err ? (
        <div style={{ ...centerBox, color: 'var(--danger)' }}>{err} <button onClick={loadTemplates} style={ghostBtn}>Retry</button></div>
      ) : templates.length === 0 ? (
        <div style={centerBox}><GraduationCap size={26} style={{ opacity: .5 }} /><div style={{ marginTop: 8 }}>No templates yet — create one per role above.</div></div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {templates.map(t => (
            <button key={t.id} onClick={() => setSelId(t.id)} style={{
              ...tab, ...(selId === t.id ? tabOn : {}), opacity: t.is_active ? 1 : 0.5,
            }}>{t.role.replace('_', ' ')}{!t.is_active && ' (off)'}</button>
          ))}
        </div>
      )}

      {sel && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <strong style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{sel.role.replace('_', ' ')} template</strong>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)', marginLeft: 8 }}>{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => toggleActive(sel)} style={ghostBtn}>{sel.is_active ? 'Deactivate' : 'Activate'}</button>
              <button onClick={addStep} style={primaryBtn}><Plus size={16} /> Add step</button>
            </div>
          </div>

          {steps.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No steps yet. Add the first onboarding step.</div>
            : <div style={{ display: 'grid', gap: 10 }}>
                {steps.map((st, i) => (
                  <StepEditor key={st.id} st={st} idx={i} total={steps.length}
                    onPatch={patchStep} onDelete={removeStep} onMove={move} />
                ))}
              </div>}
        </div>
      )}
      <style>{`.spin{animation:hrspin 1s linear infinite}@keyframes hrspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── step editor ─────────────────────────────────────────────────────────────
function StepEditor({ st, idx, total, onPatch, onDelete, onMove }) {
  const [title, setTitle] = useState(st.title)
  const [desc, setDesc] = useState(st.description || '')
  const [linkUrl, setLinkUrl] = useState(st.material_type === 'link' ? (st.material_url || '') : '')
  const [busy, setBusy] = useState(false)
  const [showTest, setShowTest] = useState(false)
  const fileRef = useRef(null)

  async function uploadMaterial(file, kind) {
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { toastError(null, 'File too large — 50 MB max.'); return }
    setBusy(true)
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${st.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('onboarding-material').upload(path, file, { upsert: false })
    if (error) { setBusy(false); toastError(error, 'Upload failed.'); return }
    if (st.material_url && st.material_type !== 'link') await supabase.storage.from('onboarding-material').remove([st.material_url])
    await onPatch(st.id, { material_url: path, material_type: kind })
    setBusy(false); toastSuccess('Material uploaded.')
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--bg, #0f172a)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)', textAlign: 'center' }}>{idx + 1}</span>
          <button onClick={() => onMove(st, -1)} disabled={idx === 0} style={miniBtn}><ChevronUp size={14} /></button>
          <button onClick={() => onMove(st, 1)} disabled={idx === total - 1} style={miniBtn}><ChevronDown size={14} /></button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => title !== st.title && onPatch(st.id, { title: title.trim() || 'Step' })}
            style={{ ...inp, fontWeight: 600 }} placeholder="Step title" />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => desc !== (st.description || '') && onPatch(st.id, { description: desc.trim() || null })}
            style={{ ...inp, marginTop: 6, minHeight: 42, resize: 'vertical' }} placeholder="What the hire should know/do (optional)" />

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <select value={st.owner} onChange={e => onPatch(st.id, { owner: e.target.value })} style={sel_}>
              {OWNERS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>

            <select value={st.material_type || ''} onChange={e => {
              const v = e.target.value
              if (v === '' || v === 'link') onPatch(st.id, { material_type: v || null, material_url: v === 'link' ? (st.material_type === 'link' ? st.material_url : '') : null })
              else onPatch(st.id, { material_type: v })  // upload sets material_url
            }} style={sel_}>
              {MAT_TYPES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>

            {st.material_type === 'link' && (
              <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onBlur={() => onPatch(st.id, { material_url: linkUrl.trim() || null })}
                placeholder="https://…" style={{ ...inp, maxWidth: 240 }} />
            )}
            {(st.material_type === 'pdf' || st.material_type === 'video') && (
              <>
                <button onClick={() => fileRef.current?.click()} disabled={busy} style={actBtn}>
                  {busy ? <Loader2 size={14} className="spin" /> : (st.material_type === 'video' ? <Video size={14} /> : <FileText size={14} />)}
                  {st.material_url ? ' Replace' : ' Upload'}
                </button>
                {st.material_url && <span style={{ fontSize: 11.5, color: 'var(--success)' }}>uploaded</span>}
                <input ref={fileRef} type="file" accept={st.material_type === 'video' ? 'video/*' : '.pdf'} style={{ display: 'none' }}
                  onChange={e => { uploadMaterial(e.target.files?.[0], st.material_type); e.target.value = '' }} />
              </>
            )}

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={st.has_test} onChange={e => onPatch(st.id, { has_test: e.target.checked })} /> Has test
            </label>
            {st.has_test && (
              <button onClick={() => setShowTest(v => !v)} style={actBtn}><ListChecks size={14} /> Questions</button>
            )}
          </div>

          {st.has_test && showTest && <QuestionEditor stepId={st.id} />}
        </div>
        <button onClick={() => onDelete(st)} style={{ ...miniBtn, color: 'var(--text-subtle)' }}><Trash2 size={14} /></button>
      </div>
    </div>
  )
}

// ─── question editor (HR-only; owns correct_index) ───────────────────────────
function QuestionEditor({ stepId }) {
  const [qs, setQs] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const [correct, setCorrect] = useState(0)
  const savingRef = useRef(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('onboarding_step_questions').select('*').eq('step_id', stepId).order('q_order').limit(200)
    setQs(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [stepId])

  async function add() {
    if (savingRef.current) return
    const cleanOpts = opts.map(o => o.trim()).filter(Boolean)
    if (!q.trim()) { toastError(null, 'Enter the question.'); return }
    if (cleanOpts.length < 2) { toastError(null, 'At least 2 options.'); return }
    // correct_index must index the SAVED (filtered) options, not the raw array —
    // a blank option before the correct one would otherwise shift the answer.
    const selectedText = (opts[correct] || '').trim()
    const ci = cleanOpts.indexOf(selectedText)
    if (!selectedText || ci < 0) { toastError(null, 'Fill in and select the correct option.'); return }
    savingRef.current = true
    const order = (qs[qs.length - 1]?.q_order ?? -1) + 1
    const { error } = await supabase.from('onboarding_step_questions')
      .insert({ step_id: stepId, q_order: order, question: q.trim(), options: cleanOpts, correct_index: ci })
    savingRef.current = false
    if (error) { toastError(error, 'Could not add question.'); return }
    setQ(''); setOpts(['', '']); setCorrect(0); load()
  }

  async function del(id) {
    const { error } = await supabase.from('onboarding_step_questions').delete().eq('id', id)
    if (error) { toastError(error, 'Could not delete.'); return }
    setQs(x => x.filter(y => y.id !== id))
  }

  return (
    <div style={{ marginTop: 10, padding: 12, border: '1px dashed var(--border)', borderRadius: 10 }}>
      {loading ? <Loader2 size={16} className="spin" /> : qs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 8 }}>No questions yet.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {qs.map((x, i) => (
            <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
              <div style={{ color: 'var(--text)' }}>
                <strong>{i + 1}. {x.question}</strong>
                <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                  {(x.options || []).map((o, oi) => (
                    <span key={oi} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 10, color: oi === x.correct_index ? 'var(--success)' : 'var(--text-muted)' }}>
                      {oi === x.correct_index && <Check size={12} />}{o}
                    </span>
                  ))}
                </div>
              </div>
              <Trash2 size={14} onClick={() => del(x.id)} style={{ cursor: 'pointer', color: 'var(--text-subtle)', flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Question" style={inp} />
      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        {opts.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="radio" name={`c-${stepId}`} checked={correct === i} onChange={() => setCorrect(i)} title="Correct answer" />
            <input value={o} onChange={e => setOpts(a => a.map((x, xi) => xi === i ? e.target.value : x))} placeholder={`Option ${i + 1}`} style={inp} />
            {opts.length > 2 && <X size={14} onClick={() => setOpts(a => a.filter((_, xi) => xi !== i))} style={{ cursor: 'pointer', color: 'var(--text-subtle)' }} />}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {opts.length < 4 && <button onClick={() => setOpts(a => [...a, ''])} style={ghostBtn}>+ option</button>}
        <button onClick={add} style={primaryBtn}><Plus size={14} /> Add question</button>
      </div>
    </div>
  )
}

const card = { background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, padding: 16 }
const centerBox = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, color: 'var(--text-muted, #94a3b8)', flexDirection: 'column', textAlign: 'center', gap: 8 }
const inp = { width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border, #334155)', background: 'var(--surface, #1e293b)', color: 'var(--text, #f1f5f9)', fontSize: 13, boxSizing: 'border-box' }
const sel_ = { ...inp, width: 'auto', cursor: 'pointer' }
const tab = { padding: '7px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }
const tabOn = { border: '1px solid var(--accent, #FFE600)', background: 'var(--accent-soft, rgba(255,230,0,.14))', color: 'var(--accent, #FFE600)' }
const miniBtn = { display: 'grid', placeItems: 'center', width: 26, height: 22, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2, #334155)', color: 'var(--text-muted)', cursor: 'pointer' }
const actBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2, #334155)', color: 'var(--text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: 'none', background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
