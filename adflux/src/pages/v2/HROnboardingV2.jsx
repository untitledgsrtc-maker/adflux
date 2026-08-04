// =============================================================================
// HROnboardingV2 — HR watches every hire's onboarding + assigns new ones (Phase 282).
// Timeline: role, X/Y steps done, who's stuck. Assign = create_onboarding_run RPC
// (seeds the hire's checklist from their role's active template). HR marks the
// HR-owned steps done. Admin/co_owner/hr only.
// =============================================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  GraduationCap, UserPlus, CheckCircle2, Circle, ChevronDown, Loader2, Settings,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError, toastSuccess } from '../../components/v2/Toast'

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s); if (isNaN(d)) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function HROnboardingV2() {
  const nav = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const [runs, setRuns] = useState([])
  const [users, setUsers] = useState([])          // id -> {name, role}
  const [tmpls, setTmpls] = useState({})          // template_id -> {role,name}
  const [stepMap, setStepMap] = useState({})      // step_id -> {title, owner, template_id}
  const [progByRun, setProgByRun] = useState({})  // run_id -> [progress rows]
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [openRun, setOpenRun] = useState(null)
  const savingRef = useRef(false)

  async function load() {
    setLoading(true); setErr(null)
    const [runRes, userRes, tmplRes, stepRes] = await Promise.all([
      supabase.from('onboarding_runs').select('*').order('started_at', { ascending: false }).limit(500),
      supabase.from('users').select('id, name, role, is_active').limit(1000),
      supabase.from('onboarding_templates').select('id, role, name').limit(500),
      supabase.from('onboarding_steps').select('id, title, owner, template_id').limit(2000),
    ])
    if (runRes.error) { setErr(runRes.error.message); setLoading(false); return }
    const runList = runRes.data || []
    setRuns(runList)
    setUsers(userRes.data || [])
    setTmpls(Object.fromEntries((tmplRes.data || []).map(t => [t.id, t])))
    setStepMap(Object.fromEntries((stepRes.data || []).map(s => [s.id, s])))

    const runIds = runList.map(r => r.id)
    if (runIds.length) {
      const { data: prog } = await supabase.from('onboarding_progress').select('*').in('run_id', runIds).limit(5000)
      const m = {}
      for (const p of prog || []) (m[p.run_id] = m[p.run_id] || []).push(p)
      setProgByRun(m)
    } else { setProgByRun({}) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const userMap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users])
  const assignedIds = useMemo(() => new Set(runs.map(r => r.user_id)), [runs])
  const assignable = useMemo(() => users.filter(u => u.is_active && !assignedIds.has(u.id)), [users, assignedIds])

  async function assign(userId) {
    if (savingRef.current) return
    savingRef.current = true
    const { data, error } = await supabase.rpc('create_onboarding_run', { p_user_id: userId })
    savingRef.current = false
    if (error) { toastError(error, 'Could not start onboarding.'); return }
    if (!data) { toastError(null, 'No active template for that role yet — create one first.'); return }
    toastSuccess('Onboarding started.'); setAssignOpen(false); load()
  }

  async function markStep(runId, prog, done) {
    const { error } = await supabase.from('onboarding_progress')
      .update({ status: done ? 'done' : 'pending', done_by: done ? (profile?.id ?? null) : null, done_at: done ? new Date().toISOString() : null })
      .eq('id', prog.id)
    if (error) { toastError(error, 'Could not update step.'); return }
    setProgByRun(m => ({ ...m, [runId]: (m[runId] || []).map(p => p.id === prog.id ? { ...p, status: done ? 'done' : 'pending' } : p) }))
  }

  return (
    <div className="v2d-page">
      <div className="v2d-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="v2d-page-kicker">HR · Onboard &amp; train</div>
          <h1 className="v2d-page-title">Onboarding</h1>
          <div className="v2d-page-sub">Every new hire's progress — and who is stuck.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => nav('/hr/onboarding/templates')} style={ghostBtn}><Settings size={16} /> Templates</button>
          <button onClick={() => setAssignOpen(v => !v)} style={primaryBtn}><UserPlus size={16} /> Onboard someone</button>
        </div>
      </div>

      {assignOpen && (
        <div style={{ ...card, marginBottom: 16 }}>
          <strong style={{ color: 'var(--text)' }}>Start onboarding for…</strong>
          {assignable.length === 0
            ? <div style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 13 }}>Everyone active is already onboarding.</div>
            : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {assignable.map(u => (
                  <button key={u.id} onClick={() => assign(u.id)} style={chipBtn}>
                    {u.name || u.id.slice(0, 6)} <span style={{ opacity: .6 }}>· {u.role}</span>
                  </button>
                ))}
              </div>}
        </div>
      )}

      {loading ? (
        <div style={centerBox}><Loader2 size={22} className="spin" /></div>
      ) : err ? (
        <div style={{ ...centerBox, color: 'var(--danger)' }}>{err} <button onClick={load} style={ghostBtn}>Retry</button></div>
      ) : runs.length === 0 ? (
        <div style={centerBox}><GraduationCap size={26} style={{ opacity: .5 }} /><div style={{ marginTop: 8 }}>No one is onboarding yet.</div></div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {runs.map(r => {
            const prog = progByRun[r.id] || []
            const done = prog.filter(p => p.status === 'done').length
            const total = prog.length
            const u = userMap[r.user_id]
            const pct = total ? Math.round(100 * done / total) : 0
            const complete = total > 0 && done === total
            return (
              <div key={r.id} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }}
                  onClick={() => setOpenRun(openRun === r.id ? null : r.id)}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                      {u?.name || r.user_id.slice(0, 8)}
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8, textTransform: 'capitalize' }}>{tmpls[r.template_id]?.role || u?.role || ''}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>started {fmtDate(r.started_at)}</div>
                  </div>
                  <div style={{ minWidth: 130 }}>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-2, #334155)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: complete ? 'var(--success, #10B981)' : 'var(--accent, #FFE600)' }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{done}/{total} steps{complete ? ' · done' : ''}</div>
                  </div>
                  <ChevronDown size={18} style={{ color: 'var(--text-subtle)', transform: openRun === r.id ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </div>

                {openRun === r.id && (
                  <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                    {prog.length === 0 && <div style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>No steps seeded (template had none).</div>}
                    {prog.slice().sort((a, b) => (stepMap[a.step_id]?.step_order ?? 0) - (stepMap[b.step_id]?.step_order ?? 0)).map(p => {
                      const s = stepMap[p.step_id]
                      const isDone = p.status === 'done'
                      const hrOwned = s?.owner === 'hr' || s?.owner === 'manager'
                      return (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg, #0f172a)' }}>
                          {isDone ? <CheckCircle2 size={16} style={{ color: 'var(--success)' }} /> : <Circle size={16} style={{ color: 'var(--text-subtle)' }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 13, color: 'var(--text)' }}>{s?.title || 'step'}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 8 }}>
                              {s?.owner === 'hire' ? 'hire' : s?.owner === 'manager' ? 'manager' : 'HR'}
                              {p.test_passed != null ? ` · test ${p.test_score}%` : ''}
                            </span>
                          </div>
                          {hrOwned && (
                            <button onClick={() => markStep(r.id, p, !isDone)} style={{ ...miniAct, color: isDone ? 'var(--text-subtle)' : 'var(--accent)' }}>
                              {isDone ? 'Undo' : 'Mark done'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <style>{`.spin{animation:hrspin 1s linear infinite}@keyframes hrspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

const card = { background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, padding: 16 }
const centerBox = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)', borderRadius: 14, color: 'var(--text-muted, #94a3b8)', flexDirection: 'column', textAlign: 'center', gap: 8 }
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const chipBtn = { padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2, #334155)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }
const miniAct = { padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2, #334155)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
