// src/components/v2/SendEmailModal.jsx
//
// Phase 235 — reusable "send an email from the app" modal (§99). Used for
// client quote emails (kind='quote' → from quotes@untitledad.in) and HR offer
// emails (kind='offer' → from hr@untitledad.in). The rep confirms the
// recipient + subject + message; the PDF rides as an attachment and the branded
// link is added to the body. A copy is CC'd to the sender (owner decision).
//
// Self-contained: the caller passes the prepared defaults + pdfUrl. Sending is
// gated (one-to-one only) server-side; this just validates a single email.

import { useState, useEffect } from 'react'
import { X, Mail, Loader2, Paperclip } from 'lucide-react'
import { pushToast, toastError, toastSuccess } from './Toast'
import { sendAppEmail, buildEmailHtml } from '../../utils/sendEmail'

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export default function SendEmailModal({
  open, onClose, kind = 'quote', title,
  defaultTo = '', defaultSubject = '', defaultBody = '',
  pdfUrl = '', pdfName = 'document.pdf', relatedId = null,
  onSent,
}) {
  const [to, setTo] = useState(defaultTo)
  const [subject, setSubject] = useState(defaultSubject)
  const [bodyText, setBodyText] = useState(defaultBody)
  const [sending, setSending] = useState(false)

  // re-seed the fields each time the modal opens
  useEffect(() => {
    if (open) { setTo(defaultTo); setSubject(defaultSubject); setBodyText(defaultBody) }
    // eslint-disable-next-line
  }, [open])

  if (!open) return null

  async function send() {
    const clean = to.trim()
    if (!EMAIL_RE.test(clean)) { pushToast('Enter one valid email address.', 'danger'); return }
    if (!subject.trim()) { pushToast('Add a subject.', 'danger'); return }
    setSending(true)
    try {
      await sendAppEmail({
        kind,
        to: clean,
        subject: subject.trim(),
        html: buildEmailHtml(bodyText, pdfUrl),
        pdfUrl: pdfUrl || undefined,
        pdfName,
        relatedId,
      })
      toastSuccess('Email sent — a copy is in your inbox.')
      onSent && onSent()
      onClose && onClose()
    } catch (e) {
      toastError(e, 'Could not send the email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={overlay} onClick={() => !sending && onClose && onClose()}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontFamily: 'var(--v2-display)', fontWeight: 600, color: 'var(--v2-ink-0)', fontSize: 15 }}>
            <Mail size={17} strokeWidth={1.7} /> {title || 'Send email'}
          </span>
          <button type="button" onClick={() => !sending && onClose && onClose()} style={xBtn}><X size={18} strokeWidth={1.6} /></button>
        </div>

        <div style={{ padding: 18 }}>
          <label style={lbl}>To</label>
          <input style={inp} value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@email.com" type="email" autoComplete="off" />

          <label style={{ ...lbl, marginTop: 12 }}>Subject</label>
          <input style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />

          <label style={{ ...lbl, marginTop: 12 }}>Message</label>
          <textarea style={{ ...inp, height: 120, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />

          <div style={note}>
            {pdfUrl && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Paperclip size={13} strokeWidth={1.7} /> PDF attached + link in the email</span>}
            <span>A copy is CC&rsquo;d to you.</span>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button type="button" style={{ ...btnY, opacity: sending ? 0.6 : 1 }} onClick={send} disabled={sending}>
              {sending ? <Loader2 size={15} strokeWidth={1.7} className="spin" /> : <Mail size={15} strokeWidth={1.7} />} Send email
            </button>
            <button type="button" style={btnG} onClick={() => onClose && onClose()} disabled={sending}>Cancel</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .spin{animation:spin 1s linear infinite}`}</style>
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto' }
const modalBox = { width: '100%', maxWidth: 520, background: 'var(--v2-bg-1, #0f1525)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }
const head = { padding: '14px 18px', borderBottom: '1px solid var(--v2-line, #1f2b47)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const xBtn = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--v2-ink-2)', display: 'flex' }
const lbl = { fontSize: 11, color: 'var(--v2-ink-2, #6a7590)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, marginBottom: 6, display: 'block' }
const inp = { width: '100%', height: 38, padding: '0 12px', background: 'var(--v2-bg-2, #1a2742)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 14, outline: 'none', fontFamily: 'inherit' }
const note = { marginTop: 12, fontSize: 11.5, color: 'var(--v2-ink-2)', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }
const btnY = { background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)', border: 'none', borderRadius: 10, height: 40, padding: '0 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }
const btnG = { background: 'transparent', color: 'var(--v2-ink-1, #a9b3c7)', border: '1px solid var(--v2-line, #1f2b47)', borderRadius: 10, height: 40, padding: '0 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }
