// Required client proof on a new Private payment: the rep sends the client the
// Google review link, then attaches a screenshot of the review or a short
// testimonial video. Controlled: value = { type, file }.
import { useEffect, useRef, useState } from 'react'
import { Copy, MessageCircle, Star } from 'lucide-react'
import { PROOF_TYPES, MAX_PROOF_BYTES, fetchReviewUrl } from '../../utils/paymentProof'
import { openWhatsApp } from '../../utils/whatsapp'

export default function PaymentProofField({ value, onChange, clientPhone, error }) {
  const [reviewUrl, setReviewUrl] = useState(null)   // null = loading, '' = not set
  const [loadErr, setLoadErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [sizeErr, setSizeErr] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetchReviewUrl()
      .then(u => { if (alive) setReviewUrl(u) })
      .catch(e => { if (alive) { setReviewUrl(''); setLoadErr(e?.message || 'Could not load the review link.') } })
    return () => { alive = false }
  }, [])

  const type = PROOF_TYPES.find(t => t.value === value.type) || PROOF_TYPES[0]

  async function copyLink() {
    try { await navigator.clipboard.writeText(reviewUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  return (
    <div
      style={{
        marginTop: 14, padding: '14px 16px',
        borderRadius: 'var(--radius, 10px)',
        border: `1.5px solid ${error ? 'var(--danger, #EF4444)' : 'var(--tint-warning-bd, rgba(245,158,11,0.40))'}`,
        background: 'var(--tint-warning, rgba(245,158,11,0.14))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
        <Star size={16} /> Client proof — required
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginTop: 4, lineHeight: 1.5 }}>
        Ask the client to leave a Google review or record a short testimonial video, then attach it here. Admin sees it when approving.
      </div>

      {reviewUrl === '' ? (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger, #EF4444)' }}>
          {loadErr || 'Google review link is not set. Ask admin to set it in Master.'}
        </div>
      ) : reviewUrl ? (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <code style={{ fontSize: 12, color: 'var(--text)', wordBreak: 'break-all', flex: '1 1 200px' }}>{reviewUrl}</code>
          <button type="button" className="btn btn-ghost" onClick={copyLink} style={{ minHeight: 36 }}>
            <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
          </button>
          {clientPhone && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ minHeight: 36 }}
              onClick={() => openWhatsApp(clientPhone, `Thank you for choosing us. It would mean a lot if you could leave us a quick Google review: ${reviewUrl}`)}
            >
              <MessageCircle size={14} /> Send on WhatsApp
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>Loading review link…</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {PROOF_TYPES.map(t => {
          const on = value.type === t.value
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ type: t.value, file: null })}
              style={{
                flex: 1, minHeight: 40, borderRadius: 'var(--radius, 10px)', cursor: 'pointer',
                border: `1.5px solid ${on ? 'var(--accent, #FFE600)' : 'var(--border-strong, #475569)'}`,
                background: on ? 'var(--accent-soft, rgba(255,230,0,0.14))' : 'transparent',
                color: 'var(--text)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={type.accept}
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          if (f.size > MAX_PROOF_BYTES) { setSizeErr('That file is over 100 MB. Record a shorter video or send a screenshot instead.'); return }
          setSizeErr('')
          onChange({ type: type.value, file: f })
        }}
      />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => fileRef.current?.click()}
        style={{ width: '100%', marginTop: 10, minHeight: 44 }}
      >
        {value.file ? `Attached: ${value.file.name}` : `Attach ${type.label.toLowerCase()} — ${type.hint}`}
      </button>

      {(sizeErr || error) && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger, #EF4444)' }}>{sizeErr || error}</div>}
    </div>
  )
}
