// src/components/leads/WhatsAppSendModal.jsx
//
// Phase 47.1 — 1-click WhatsApp template send.
//
// Owner directive: TC needs to send WhatsApp follow-up in one tap
// after no-answer calls. Today they switch app + copy/paste = 90 sec
// per send. Template + render + wa.me link = 5 sec.
//
// Flow:
//   1. Caller opens modal with `lead` prop.
//   2. Modal loads active whatsapp_templates ordered by display_order.
//   3. Rep picks one — body renders with placeholders filled
//      ({name}, {company}, {phone}, {city}, {rep_name}, {company_name}).
//   4. Rep can edit the rendered text before sending.
//   5. Tap "Open WhatsApp" → opens wa.me/91{phone}?text={encoded}.
//      iOS Safari hands off to WhatsApp on tel-link gesture rules.
//   6. After hand-off, logs a `lead_activities` row (activity_type=
//      'whatsapp', notes=rendered_body) for audit + reporting.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, MessageSquare, Send, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { pushToast } from '../v2/Toast'
import { openExternalUrl } from '../../utils/openExternal'

function cleanPhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length === 10 ? '91' + d : d
}

function renderTemplate(body, ctx) {
  if (!body) return ''
  return body
    .replaceAll('{name}',         ctx.name         || '')
    .replaceAll('{company}',      ctx.company      || '')
    .replaceAll('{phone}',        ctx.phone        || '')
    .replaceAll('{city}',         ctx.city         || '')
    .replaceAll('{rep_name}',     ctx.rep_name     || '')
    .replaceAll('{company_name}', ctx.company_name || 'Untitled Advertising')
}

export default function WhatsAppSendModal({ open, lead, onClose, onSent }) {
  const profile = useAuthStore(s => s.profile)
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [body, setBody] = useState('')          // rendered + rep-editable
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)
  // Phase 68.2 (21 May 2026) — ref guard against rapid double-tap.
  // setSending toggles too fast for the disabled prop to catch a
  // back-to-back press; ref short-circuits the second call sync.
  const sendingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    // Phase 68.2 — reset send-guard whenever the modal re-opens.
    sendingRef.current = false
    let cancelled = false
    setLoading(true); setErr('')
    supabase
      .from('whatsapp_templates')
      .select('id, name, body, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setErr(error.message); setLoading(false); return }
        setTemplates(data || [])
        const first = (data || [])[0]
        if (first) {
          setSelectedId(first.id)
          setBody(renderTemplate(first.body, makeCtx(lead, profile)))
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, lead?.id, profile?.id])

  const ctx = useMemo(() => makeCtx(lead, profile), [lead, profile])

  function pickTemplate(t) {
    setSelectedId(t.id)
    setBody(renderTemplate(t.body, ctx))
  }

  async function handleSend() {
    if (!lead?.id || !profile?.id) return
    const phone = cleanPhone(lead.phone)
    if (!phone) {
      pushToast('No phone on this lead.', 'danger')
      return
    }
    if (!body.trim()) {
      pushToast('Message body is empty.', 'danger')
      return
    }
    // Phase 68.2 — sync ref guard. State-based `disabled` flips too
    // late for a rapid second tap; ref short-circuits immediately.
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    // Open wa.me on user gesture FIRST so iOS Safari hands off.
    // Phase 95.2 — openExternalUrl routes via Capacitor App.openUrl
    // on native + falls back to window.open on web.
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`
    openExternalUrl(url)
    // Then log audit (fire-and-forget; failure doesn't block send).
    supabase.from('lead_activities').insert([{
      lead_id:       lead.id,
      activity_type: 'whatsapp',
      outcome:       null,
      notes:         body,
      created_by:    profile.id,
    }]).then(({ error }) => {
      if (error) console.warn('[wa-send] activity log failed:', error.message)
    })
    setSending(false)
    // Leave sendingRef true until modal closes — onClose clears it
    // on next open via the useEffect below.
    onSent?.()
    onClose?.()
  }

  if (!open || !lead) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.head}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={18} style={{ color: 'var(--v2-green, #10B981)' }} />
            <div>
              <div style={styles.title}>Send WhatsApp</div>
              <div style={styles.sub}>{lead.name || '—'} · {lead.phone || 'no phone'}</div>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}><X size={18} /></button>
        </div>

        <div style={styles.body}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--v2-ink-2)' }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : err ? (
            <div style={styles.err}><AlertTriangle size={14} /> {err}</div>
          ) : templates.length === 0 ? (
            <div style={styles.empty}>
              No active templates. Admin can add them in Master → WhatsApp Templates.
            </div>
          ) : (
            <>
              <div style={styles.label}>Template</div>
              <div style={styles.templateList}>
                {templates.map(t => {
                  const on = selectedId === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pickTemplate(t)}
                      style={{
                        ...styles.templateChip,
                        background: on ? 'var(--v2-green-soft, rgba(16,185,129,.16))' : 'var(--v2-bg-2)',
                        borderColor: on ? 'var(--v2-green, #10B981)' : 'var(--v2-line)',
                        color:       on ? 'var(--v2-green, #10B981)' : 'var(--v2-ink-1)',
                      }}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>

              <div style={{ ...styles.label, marginTop: 14 }}>Message preview · edit before sending</div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                style={styles.textarea}
                rows={6}
              />
              <div style={styles.hint}>
                Tap "Open WhatsApp" → message pre-fills in WhatsApp → you tap send there. Activity logged automatically.
              </div>

              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !body.trim()}
                style={styles.sendBtn}
              >
                <Send size={14} /> {sending ? 'Opening…' : 'Open WhatsApp'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function makeCtx(lead, profile) {
  return {
    name:         lead?.name || '',
    company:      lead?.company || lead?.name || '',
    phone:        lead?.phone || '',
    city:         lead?.city || '',
    rep_name:     profile?.name || '',
    company_name: 'Untitled Advertising',
  }
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9000, padding: 16,
  },
  modal: {
    background: 'var(--v2-bg-1, var(--surface))',
    border: '1px solid var(--v2-line, var(--border))',
    borderRadius: 14, width: '100%', maxWidth: 520,
    maxHeight: '90vh', overflow: 'auto',
  },
  head: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 18px',
    borderBottom: '1px solid var(--v2-line, var(--border))',
  },
  title: { fontSize: 15, fontWeight: 700, color: 'var(--v2-ink-0)' },
  sub:   { fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 },
  closeBtn: {
    background: 'transparent', border: 'none',
    color: 'var(--v2-ink-2)', cursor: 'pointer', padding: 4,
  },
  body: { padding: 18 },
  err: {
    padding: '10px 14px',
    background: 'rgba(239,68,68,.08)',
    border: '1px solid rgba(239,68,68,.25)',
    borderRadius: 10, fontSize: 12,
    color: 'var(--v2-rose, var(--danger))',
    display: 'flex', alignItems: 'center', gap: 6,
  },
  empty: { padding: 24, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 },
  label: {
    fontSize: 11, fontWeight: 600,
    color: 'var(--v2-ink-2)',
    textTransform: 'uppercase', letterSpacing: '.10em',
    marginBottom: 8,
  },
  templateList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  templateChip: {
    padding: '6px 12px', borderRadius: 999,
    border: '1px solid', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', minHeight: 120,
    padding: '10px 12px',
    background: 'var(--v2-bg-2)',
    border: '1px solid var(--v2-line)',
    borderRadius: 10,
    color: 'var(--v2-ink-0)', fontSize: 13,
    fontFamily: 'inherit', lineHeight: 1.5,
    resize: 'vertical', outline: 'none',
  },
  hint: {
    fontSize: 11, color: 'var(--v2-ink-2)',
    marginTop: 8, marginBottom: 14,
  },
  sendBtn: {
    width: '100%',
    padding: '12px 16px',
    background: 'var(--v2-green, #10B981)',
    border: 'none', borderRadius: 10,
    color: 'white', fontSize: 14, fontWeight: 700,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontFamily: 'inherit',
  },
}
