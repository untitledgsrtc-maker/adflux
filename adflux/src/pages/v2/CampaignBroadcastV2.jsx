// src/pages/v2/CampaignBroadcastV2.jsx
//
// Campaign Module — Broadcast. STEP 1 (this build): manage Meta message
// templates from INSIDE the app (create + submit + see approval status) — no
// business.facebook.com needed. STEP 2 (next): pick an approved template + a
// saved segment and send.
//
// §45-safe: new admin page (RequirePrivileged). Talks to api/wa/templates
// (admin-gated; the token stays server-side). No live-app table touched.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, AlertTriangle, RefreshCw, Plus, CheckCircle2, Clock, XCircle, FileText, Send,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CampaignChrome from '../../components/v2/CampaignChrome'
import { toastError, toastSuccess } from '../../components/v2/Toast'

async function authedFetch(url, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const jwt = session?.access_token
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${jwt || ''}` },
  })
}

const STATUS = {
  APPROVED: { label: 'Approved', color: 'var(--v2-green, #22c55e)', bg: 'var(--v2-green-soft, rgba(34,197,94,0.14))', Icon: CheckCircle2 },
  PENDING:  { label: 'Pending',  color: 'var(--v2-amber, #F59E0B)', bg: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', Icon: Clock },
  IN_APPEAL:{ label: 'In appeal',color: 'var(--v2-amber, #F59E0B)', bg: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', Icon: Clock },
  REJECTED: { label: 'Rejected', color: 'var(--v2-rose, #f87171)',  bg: 'var(--v2-rose-soft, rgba(248,113,113,0.14))', Icon: XCircle },
  PAUSED:   { label: 'Paused',   color: 'var(--v2-ink-2, #6a7590)', bg: 'var(--v2-bg-2, #1a2742)', Icon: Clock },
  DISABLED: { label: 'Disabled', color: 'var(--v2-rose, #f87171)',  bg: 'var(--v2-rose-soft, rgba(248,113,113,0.14))', Icon: XCircle },
}
function statusOf(s) { return STATUS[String(s || '').toUpperCase()] || STATUS.PENDING }
function bodyOf(t) {
  const b = (t.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')
  return b?.text || ''
}

const DEFAULT_BODY = 'Hi {{1}}, this is Untitled Advertising. We have new outdoor advertising availability — hoardings, LED, bus media — in your area. If you would like the current rate card, reply here or call us.'

export default function CampaignBroadcastV2() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [templates, setTemplates] = useState([])

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('MARKETING')
  const [bodyText, setBodyText] = useState(DEFAULT_BODY)
  const [example, setExample] = useState('Rajesh')
  const [submitting, setSubmitting] = useState(false)
  const submitRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await authedFetch('/api/wa/templates')
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.detail || j?.error || `Could not load templates (${r.status})`); setTemplates([]) }
      else setTemplates(j.templates || [])
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit() {
    const nm = name.trim()
    if (!nm) { toastError(new Error('name'), 'Name the template (lowercase, no spaces).'); return }
    if (!bodyText.trim()) { toastError(new Error('body'), 'Write the message body.'); return }
    if (submitRef.current || submitting) return
    submitRef.current = true; setSubmitting(true)
    try {
      const r = await authedFetch('/api/wa/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nm, category, body_text: bodyText.trim(), example: example.trim() || 'Rajesh' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toastError(new Error(j?.detail || j?.error || 'Submit failed'), 'Meta rejected the template.'); return }
      toastSuccess(`Submitted "${j.name || nm}" — Meta is reviewing it.`)
      setShowForm(false); setName('')
      load()
    } catch (e) {
      toastError(e, 'Could not submit the template.')
    } finally {
      setSubmitting(false); submitRef.current = false
    }
  }

  const approvedCount = templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED').length
  const refreshBtn = (
    <button type="button" onClick={load} style={btnG}><RefreshCw size={14} strokeWidth={1.6} /> Refresh</button>
  )

  return (
    <CampaignChrome
      active="broadcast"
      title="Broadcast"
      sub="Create your message templates here (Meta reviews them — no need to leave the app). Once a template is Approved, you'll send it to a saved segment."
      right={refreshBtn}
    >
      {/* step note */}
      <div style={{ ...panel, marginBottom: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Send size={18} strokeWidth={1.6} style={{ color: 'var(--v2-yellow, #FFE600)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', lineHeight: 1.55 }}>
          <b style={{ color: 'var(--v2-ink-0)' }}>Step 1 — templates (you are here).</b> Marketing messages to your own
          leads must use a Meta-approved template. Create one below; Meta usually approves within minutes.
          <b style={{ color: 'var(--v2-ink-0)' }}> Step 2 — sending</b> to a saved Segment unlocks once a template is Approved
          {approvedCount > 0 ? <span style={{ color: 'var(--v2-green, #22c55e)' }}> — you have {approvedCount} approved.</span> : <span> (and a payment method is on the WABA).</span>}
        </div>
      </div>

      {/* templates */}
      <div style={{ ...panel, padding: 0 }}>
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--v2-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 14 }}>
            Message templates{!loading && ` · ${templates.length}`}
          </span>
          <button type="button" style={btnY} onClick={() => setShowForm((s) => !s)}><Plus size={14} strokeWidth={1.6} /> New template</button>
        </div>

        {/* create form */}
        {showForm && (
          <div style={{ padding: 18, borderBottom: '1px solid var(--v2-line)', background: 'var(--v2-bg-2, #1a2742)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <label style={lbl}>Name (lowercase, no spaces)</label>
                <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="reengage_2026" />
              </div>
              <div>
                <label style={lbl}>Type</label>
                <select style={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="MARKETING">Marketing (promotions)</option>
                  <option value="UTILITY">Utility (transactional)</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Sample for {'{{1}}'}</label>
                <input style={inp} value={example} onChange={(e) => setExample(e.target.value)} placeholder="Rajesh" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Message body — use {'{{1}}'} for the lead&rsquo;s name</label>
              <textarea style={{ ...inp, height: 96, padding: '9px 12px', resize: 'vertical' }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button type="button" style={{ ...btnY, opacity: submitting ? 0.6 : 1 }} onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 size={14} strokeWidth={1.6} className="spin" /> : <Send size={14} strokeWidth={1.6} />} Submit to Meta
              </button>
              <button type="button" style={btnG} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={20} strokeWidth={1.6} className="spin" style={{ color: 'var(--v2-yellow, #FFE600)' }} /></div>
        ) : error ? (
          <div style={{ padding: 18, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={18} strokeWidth={1.6} style={{ color: 'var(--v2-amber, #F59E0B)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>{error}</div>
          </div>
        ) : templates.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
            <FileText size={22} strokeWidth={1.6} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: 8 }}>No templates yet. Tap <b style={{ color: 'var(--v2-ink-1)' }}>New template</b> to create your first.</div>
          </div>
        ) : (
          <div>
            {templates.map((t) => {
              const st = statusOf(t.status)
              return (
                <div key={t.name + (t.language || '')} style={{ padding: '14px 18px', borderBottom: '1px solid var(--v2-line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: 'var(--v2-ink-0)', fontFamily: 'var(--v2-display)' }}>{t.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 8px', borderRadius: 999, color: st.color, background: st.bg }}>
                      <st.Icon size={12} strokeWidth={1.8} /> {st.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--v2-ink-2)' }}>{t.category} · {(t.language || 'en')}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--v2-ink-2)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{bodyOf(t)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </CampaignChrome>
  )
}

// ─── inline styles ───────────────────────────────────────────────────────
const panel = { background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, padding: 18 }
const lbl = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 38, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 38, padding: '0 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
