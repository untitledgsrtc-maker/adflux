// =============================================================================
// MyOnboardingV2 — the hire's own onboarding (Phase 282). Every role. Steps in
// order: open material in-app, pass a test (answers scored server-side, never
// exposed), tick their own steps. HR-owned steps show "HR is setting up".
// Route guard = RequireAuth (all roles); a user with no run sees an empty state.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GraduationCap, CheckCircle2, Circle, FileText, Video, ExternalLink,
  ListChecks, Loader2, X, PartyPopper,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { openExternalUrl } from '../../utils/openExternal'

export default function MyOnboardingV2() {
  const profile = useAuthStore(s => s.profile)
  const [run, setRun] = useState(null)
  const [steps, setSteps] = useState([])
  const [prog, setProg] = useState({})          // step_id -> progress row
  const [loading, setLoading] = useState(true)
  const [testStep, setTestStep] = useState(null)

  async function load() {
    setLoading(true)
    const { data: runs } = await supabase.from('onboarding_runs').select('*').eq('user_id', profile?.id).limit(1)
    const r = runs?.[0] || null
    setRun(r)
    if (!r) { setSteps([]); setProg({}); setLoading(false); return }
    const [stepRes, progRes] = await Promise.all([
      supabase.from('onboarding_steps').select('*').eq('template_id', r.template_id).eq('is_active', true).order('step_order').limit(500),
      supabase.from('onboarding_progress').select('*').eq('run_id', r.id).limit(500),
    ])
    setSteps(stepRes.data || [])
    setProg(Object.fromEntries((progRes.data || []).map(p => [p.step_id, p])))
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() }, [profile?.id])

  const { done, total } = useMemo(() => {
    const ids = steps.map(s => s.id)
    const d = ids.filter(id => prog[id]?.status === 'done').length
    return { done: d, total: ids.length }
  }, [steps, prog])
  const pct = total ? Math.round(100 * done / total) : 0
  const allDone = total > 0 && done === total

  async function tick(step, makeDone) {
    const pr = prog[step.id]
    if (!pr) { toastError(null, 'This step is still being set up — check back soon.'); return }
    const patch = makeDone
      ? { status: 'done', done_by: profile?.id || null, done_at: new Date().toISOString() }
      : { status: 'pending', done_by: null, done_at: null }
    const { error } = await supabase.from('onboarding_progress').update(patch).eq('id', pr.id)
    if (error) { toastError(error, 'Could not update — is this your step?'); return }
    setProg(p => ({ ...p, [step.id]: { ...p[step.id], ...patch } }))
  }

  async function openMaterial(step) {
    if (!step.material_url) return
    if (step.material_type === 'link') { openExternalUrl(step.material_url); return }
    const { data, error } = await supabase.storage.from('onboarding-material').createSignedUrl(step.material_url, 600)
    if (error || !data?.signedUrl) { toastError(error, 'Could not open material.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const name = (profile?.name || 'there').split(' ')[0]

  return (
    <div className="v2d-page">
      <div className="v2d-page-head">
        <div className="v2d-page-kicker">Onboarding</div>
        <h1 className="v2d-page-title">Welcome, {name}</h1>
        <div className="v2d-page-sub">Everything you need to know to get started. Work through it in order.</div>
      </div>

      {loading ? (
        <div style={centerBox}><Loader2 size={22} className="spin" /></div>
      ) : !run ? (
        <div style={centerBox}>
          <GraduationCap size={28} style={{ opacity: .5 }} />
          <div style={{ marginTop: 8 }}>No onboarding assigned yet. Your HR will set it up.</div>
        </div>
      ) : (
        <>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ color: 'var(--text)' }}>{allDone ? 'All done — nicely done!' : `${done} of ${total} done`}</strong>
              {allDone && <PartyPopper size={20} style={{ color: 'var(--success)' }} />}
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-2, #334155)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: allDone ? 'var(--success, #10B981)' : 'var(--accent, #FFE600)', transition: 'width .3s' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {steps.map((s, i) => {
              const p = prog[s.id]
              const isDone = p?.status === 'done'
              const mine = s.owner === 'hire'
              return (
                <div key={s.id} style={{ ...card, borderColor: isDone ? 'var(--success, #10B981)' : 'var(--border)' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    {isDone ? <CheckCircle2 size={20} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} /> : <Circle size={20} style={{ color: 'var(--text-subtle)', flexShrink: 0, marginTop: 2 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>
                        <span style={{ color: 'var(--text-subtle)', marginRight: 6 }}>{i + 1}.</span>{s.title}
                      </div>
                      {s.description && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{s.description}</div>}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                        {s.material_url && (
                          <button onClick={() => openMaterial(s)} style={actBtn}>
                            {s.material_type === 'video' ? <Video size={14} /> : s.material_type === 'link' ? <ExternalLink size={14} /> : <FileText size={14} />}
                            Open material
                          </button>
                        )}
                        {mine && p && s.has_test && (
                          <button onClick={() => setTestStep(s)} style={{ ...actBtn, borderColor: isDone ? 'var(--border)' : 'var(--accent)' }}>
                            <ListChecks size={14} /> {isDone ? 'Retake test' : 'Take test'}
                            {p?.test_passed != null && <span style={{ marginLeft: 4, color: p.test_passed ? 'var(--success)' : 'var(--danger)' }}>{p.test_score}%</span>}
                          </button>
                        )}
                        {mine && p && !s.has_test && (
                          <button onClick={() => tick(s, !isDone)} style={{ ...actBtn, borderColor: isDone ? 'var(--border)' : 'var(--accent)', color: isDone ? 'var(--text-muted)' : 'var(--text)' }}>
                            {isDone ? 'Mark not done' : 'Mark done'}
                          </button>
                        )}
                        {mine && !p && (
                          <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>being set up — check back soon</span>
                        )}
                        {!mine && (
                          <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
                            {isDone ? 'Set up for you' : `${s.owner === 'manager' ? 'Your manager' : 'HR'} is setting this up`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {testStep && run && (
        <TestModal step={testStep} runId={run.id}
          onClose={() => setTestStep(null)}
          onDone={() => { setTestStep(null); load() }} />
      )}
      <style>{`.spin{animation:hrspin 1s linear infinite}@keyframes hrspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── in-app test ─────────────────────────────────────────────────────────────
function TestModal({ step, runId, onClose, onDone }) {
  const [qs, setQs] = useState(null)
  const [answers, setAnswers] = useState({})     // q_index -> option_index
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const submitRef = useRef(false)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_onboarding_step_quiz', { p_step_id: step.id })
      if (error) { toastError(error, 'Could not load the test.'); onClose(); return }
      setQs(data || [])
    })()
  }, [step.id])

  async function submit() {
    if (submitRef.current || submitting) return
    if (!qs || Object.keys(answers).length < qs.length) { toastError(null, 'Answer every question first.'); return }
    submitRef.current = true; setSubmitting(true)
    const ordered = qs.map((_, i) => answers[i])   // aligned to q_order (RPC returns ordered)
    const { data, error } = await supabase.rpc('submit_onboarding_test', { p_run_id: runId, p_step_id: step.id, p_answers: ordered })
    setSubmitting(false); submitRef.current = false
    if (error) { toastError(error, 'Could not submit.'); return }
    setResult(data)
    if (data?.passed) toastSuccess(`Passed — ${data.score_pct}%`)
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...card, width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ color: 'var(--text)' }}>{step.title} — test</strong>
          <X size={18} onClick={onClose} style={{ cursor: 'pointer', color: 'var(--text-subtle)' }} />
        </div>

        {qs === null ? (
          <div style={{ padding: 24, textAlign: 'center' }}><Loader2 size={20} className="spin" /></div>
        ) : result ? (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <div style={{ fontSize: 40, fontWeight: 800, fontFamily: 'Space Grotesk, sans-serif', color: result.passed ? 'var(--success)' : 'var(--danger)' }}>{result.score_pct}%</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{result.correct}/{result.total} correct — {result.passed ? 'passed, step complete.' : 'need 70% to pass. Review the material and retry.'}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
              {result.passed
                ? <button onClick={onDone} style={primaryBtn}>Done</button>
                : <><button onClick={() => { setResult(null); setAnswers({}) }} style={primaryBtn}>Retry</button>
                    <button onClick={onDone} style={ghostBtn}>Close</button></>}
            </div>
          </div>
        ) : qs.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>This test has no questions yet.</div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 14 }}>
              {qs.map((q, i) => (
                <div key={q.id}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{i + 1}. {q.question}</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {(q.options || []).map((o, oi) => (
                      <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: answers[i] === oi ? 'var(--accent-soft, rgba(255,230,0,.14))' : 'var(--bg, #0f172a)', border: `1px solid ${answers[i] === oi ? 'var(--accent, #FFE600)' : 'var(--border)'}` }}>
                        <input type="radio" name={`q-${i}`} checked={answers[i] === oi} onChange={() => setAnswers(a => ({ ...a, [i]: oi }))} />
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>{o}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={submit} disabled={submitting} style={primaryBtn}>{submitting ? <Loader2 size={16} className="spin" /> : <ListChecks size={16} />} Submit</button>
              <button onClick={onClose} style={ghostBtn}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const card = { background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, padding: 16 }
const centerBox = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, color: 'var(--text-muted, #94a3b8)', flexDirection: 'column', textAlign: 'center', gap: 8 }
const actBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border, #334155)', background: 'var(--surface-2, #334155)', color: 'var(--text, #f1f5f9)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 16 }
