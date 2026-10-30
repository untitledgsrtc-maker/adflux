// Shown when a meeting is blocked because the rep is more than 100 m from the client.
// The rep is never left at a dead end: they can request admin approval with a reason,
// then tap Save again once it is approved. See src/utils/meetingLocation.js.
import { useState } from 'react'
import { MapPinOff, Loader2 } from 'lucide-react'
import { MEETING_RADIUS_M, requestLocationApproval } from '../../utils/meetingLocation'

export default function MeetingLocationBlock({ block, company, leadId, userId, pin, gps }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const status = sent ? 'pending' : block.requestStatus   // 'pending' | 'rejected' | null

  async function send() {
    if (busy) return
    if (reason.trim().length < 3) { setErr('Write a short reason first.'); return }
    setBusy(true)
    setErr('')
    const { error } = await requestLocationApproval({
      userId, leadId, company, pin, gps, distanceMeters: block.distanceM, reason,
    })
    setBusy(false)
    if (error) { setErr(error.message || 'Could not send the request.'); return }
    setSent(true)
  }

  return (
    <div
      role="alert"
      style={{
        marginBottom: 14, padding: '14px 16px', borderRadius: 'var(--radius, 10px)',
        border: '1.5px solid var(--danger, #EF4444)',
        background: 'var(--tint-danger, rgba(239,68,68,0.14))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
        <MapPinOff size={16} /> You are not at the client
      </div>
      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>
        Your location is {block.distanceM} m from {company || 'the client'}. A meeting must be logged within {MEETING_RADIUS_M} m.
        Go to the client's location and tap Save again.
      </div>

      {status === 'pending' && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>
          Your request is with admin. You will get a notification. Tap Save again once it is approved.
        </div>
      )}
      {status === 'rejected' && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>
          Admin did not approve this request. Go to the client's location, or ask admin.
        </div>
      )}
      {!status && (
        <div style={{ marginTop: 12 }}>
          <label className="lead-fld-label" style={{ display: 'block' }}>Not possible to be there? Ask admin to approve</label>
          <textarea
            className="lead-inp"
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why is your location different? (for example: the office entrance is on the other side)"
            style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
          />
          {err && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger, #EF4444)' }}>{err}</div>}
          <button
            type="button"
            className="lead-btn"
            onClick={send}
            disabled={busy}
            style={{ marginTop: 8, minHeight: 40 }}
          >
            {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</> : 'Request approval'}
          </button>
        </div>
      )}
    </div>
  )
}
