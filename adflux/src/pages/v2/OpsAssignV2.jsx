// src/pages/v2/OpsAssignV2.jsx - an office person gives a field technician a job (Phase 495).
// Three kinds: Fix a screen / Campaign photo (ops_office_assign RPC -> ops_tickets) and
// Office work (a normal Work task via work_create_task, shows in the technician's My Work).
// Office roles only (route guard + RPC gate). English UI for the office; lead-* / global tokens.
import { useCallback, useEffect, useRef, useState } from 'react'
import OpsSectionNav from '../../components/ops/OpsSectionNav'
import { Wrench, Camera, ClipboardList, Loader2, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../components/v2/Toast'
import { istTodayISO } from '../../utils/istDate'

const KINDS = [
  { key: 'fault', label: 'Fix a screen', icon: Wrench, hint: 'A screen needs fixing. It lands in the technician’s In-process list.' },
  { key: 'photo', label: 'Campaign photo', icon: Camera, hint: 'Ask for a live photo of a running campaign at a station.' },
  { key: 'work', label: 'Office work', icon: ClipboardList, hint: 'Any other job (collect a document, deliver something). Shows in their My Work.' },
]
const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, display: 'block' }
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 15 }

export default function OpsAssignV2() {
  const [kind, setKind] = useState('fault')
  const [techs, setTechs] = useState([])
  const [depots, setDepots] = useState([])
  const [screens, setScreens] = useState([])
  const [issues, setIssues] = useState([])
  const [quotes, setQuotes] = useState([])
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const latch = useRef(false)
  const [f, setF] = useState({ tech: '', depot: '', screen: '', issue: '', quote: '', note: '', title: '', due: istTodayISO() })
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const [allScreens, setAllScreens] = useState([])
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('ops_office_lookup')
      if (error) throw error
      if (!data || !data.techs) throw new Error('You do not have access to this page.')
      setTechs(data.techs); setDepots(data.depots); setIssues(data.issues); setQuotes(data.quotes || []); setAllScreens(data.screens || [])
      setRecent((data.recent || []).map((r) => ({ ...r, depot: { name: r.depot }, tech: { name: r.tech } })))
      setErr('')
    } catch (e) { setErr(e?.message || 'Could not load.') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { setScreens(allScreens.filter((s) => s.depot_id === f.depot)) }, [f.depot, allScreens])

  const submit = async () => {
    if (latch.current) return
    if (!f.tech) return toastError(new Error(''), 'Pick a technician.')
    if (kind !== 'work' && !f.depot) return toastError(new Error(''), 'Pick a station.')
    if (kind === 'work' && f.title.trim().length < 3) return toastError(new Error(''), 'Write what the job is.')
    latch.current = true; setBusy(true)
    try {
      if (kind === 'work') {
        const { error } = await supabase.rpc('work_create_task', {
          p_title: f.title.trim(), p_project: null, p_note: f.note.trim() || null, p_due: f.due || istTodayISO(),
          p_parts: [{ assignee: f.tech, label: '', due: null }], p_steps: [],
        })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('ops_office_assign', {
          p_kind: kind, p_tech: f.tech, p_depot: f.depot, p_screen: f.screen || null,
          p_issue: kind === 'fault' ? (f.issue || null) : null, p_note: f.note.trim() || null, p_quote: kind === 'photo' ? (f.quote || null) : null,
        })
        if (error) throw error
      }
      toastSuccess('Sent to the technician.')
      setF((p) => ({ ...p, screen: '', issue: '', quote: '', note: '', title: '' }))
      load()
    } catch (e) { toastError(e, 'Could not send.') } finally { latch.current = false; setBusy(false) }
  }

  if (loading) return <div className="lead-root" style={{ textAlign: 'center', paddingTop: 60 }}><Loader2 size={28} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} /></div>
  const cur = KINDS.find((k) => k.key === kind)

  return (
    <div className="lead-root">
      <OpsSectionNav />
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Operations · office</div>
          <div className="lead-page-title">Give work to a technician</div>
        </div>
      </div>
      {err && <div style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{err} <button className="lead-btn" onClick={load} style={{ marginLeft: 8 }}>Retry</button></div>}

      <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 4, marginBottom: 12 }}>
        {KINDS.map((k) => (
          <button key={k.key} onClick={() => setKind(k.key)} style={{ flex: 1, minHeight: 44, border: 'none', borderRadius: 9, fontSize: 13, fontWeight: kind === k.key ? 700 : 500, cursor: 'pointer', background: kind === k.key ? 'var(--surface-3)' : 'transparent', color: kind === k.key ? 'var(--text)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <k.icon size={16} strokeWidth={1.6} />{k.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{cur.hint}</div>

      <div className="lead-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={lbl}>Technician</label>
          <select style={field} value={f.tech} onChange={(e) => set('tech', e.target.value)}>
            <option value="">Pick a technician</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {kind !== 'work' && (
          <>
            <div>
              <label style={lbl}>Station</label>
              <select style={field} value={f.depot} onChange={(e) => { set('depot', e.target.value); set('screen', '') }}>
                <option value="">Pick a station</option>
                {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {f.depot && (
              <div>
                <label style={lbl}>Screen (optional)</label>
                <select style={field} value={f.screen} onChange={(e) => set('screen', e.target.value)}>
                  <option value="">Whole station</option>
                  {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </>
        )}
        {kind === 'photo' && (
          <div>
            <label style={lbl}>Campaign (optional)</label>
            <select style={field} value={f.quote} onChange={(e) => set('quote', e.target.value)}>
              <option value="">Not linked to a campaign</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.client || 'Client'} · {q.no}</option>)}
            </select>
          </div>
        )}
        {kind === 'fault' && (
          <div>
            <label style={lbl}>What is wrong</label>
            <select style={field} value={f.issue} onChange={(e) => set('issue', e.target.value)}>
              <option value="">Not sure</option>
              {issues.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        )}
        {kind === 'work' && (
          <>
            <div>
              <label style={lbl}>The job</label>
              <input style={field} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Collect the cheque from Anand depot" />
            </div>
            <div>
              <label style={lbl}>Due date</label>
              <input style={field} type="date" value={f.due} onChange={(e) => set('due', e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label style={lbl}>Note (optional)</label>
          <textarea style={{ ...field, resize: 'none' }} rows={3} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Anything the technician should know" />
        </div>
        <button className="lead-btn lead-btn-primary" disabled={busy} onClick={submit} style={{ minHeight: 48, justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>
          {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} strokeWidth={1.6} />} Send to technician
        </button>
      </div>

      <div style={{ ...lbl, margin: '18px 0 8px' }}>Recently sent</div>
      {recent.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing sent yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map((t) => (
            <div key={t.id} className="lead-card" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.type === 'photo_request' ? 'Campaign photo' : 'Fix a screen'} · {t.depot?.name || '-'}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>to {t.tech?.name || '-'}</div>
                {t.cant_fix && <div style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 600 }}>Can&apos;t fix: {t.cant_fix}</div>}
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: t.status === 'resolved' ? 'var(--success)' : 'var(--warning)', whiteSpace: 'nowrap' }}>{t.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
