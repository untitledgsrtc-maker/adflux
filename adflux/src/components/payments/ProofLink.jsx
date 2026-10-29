// Opens a payment's client proof (private file) via a short-lived signed link.
import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { getProofUrl } from '../../utils/paymentProof'
import { openExternalUrl } from '../../utils/openExternal'

export default function ProofLink({ payment, style }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!payment?.proof_path) return null
  const label = payment.proof_type === 'video' ? 'Testimonial video' : 'Google review'

  async function open() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      openExternalUrl(await getProofUrl(payment.proof_path))
    } catch (e) {
      setErr(e?.message || 'Could not open the proof.')
    }
    setBusy(false)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...style }}>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36,
          padding: '4px 10px', borderRadius: 'var(--radius, 10px)',
          border: '1px solid var(--border-strong, #475569)', background: 'transparent',
          color: 'var(--text, #f1f5f9)', fontSize: 12, fontWeight: 600,
          cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
        }}
      >
        <Paperclip size={14} /> {busy ? 'Opening…' : `Proof · ${label}`}
      </button>
      {err && <span style={{ fontSize: 12, color: 'var(--danger, #EF4444)' }}>{err}</span>}
    </span>
  )
}
