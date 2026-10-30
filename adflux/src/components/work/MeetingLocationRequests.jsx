// src/components/work/MeetingLocationRequests.jsx
//
// Phase 535 — admin queue for "log this meeting although I am more than 100 m from the
// client" requests. Mounted on /pending-approvals. Approve = the rep can log the meeting
// (valid 12 h for that rep + that pin); Reject = they must go to the client.
// Reads meeting_location_requests, users by id in a second query (no FK embeds, section 36.6).

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, XCircle, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError } from '../v2/Toast'

const fmt = (iso) => new Date(iso).toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})

export default function MeetingLocationRequests() {
  const profile = useAuthStore(s => s.profile)
  const [rows, setRows] = useState([])
  const [actingId, setActingId] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('meeting_location_requests')
      .select('id, user_id, company, pin_lat, pin_lng, rep_lat, rep_lng, rep_accuracy_m, distance_m, reason, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    if (error || !data?.length) { setRows([]); return }
    const { data: us } = await supabase.from('users').select('id, name')
      .in('id', [...new Set(data.map(r => r.user_id))])
    const nameById = Object.fromEntries((us || []).map(u => [u.id, u.name]))
    setRows(data.map(r => ({ ...r, name: nameById[r.user_id] || 'Rep' })))
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(row, status) {
    if (actingId) return
    setActingId(row.id)
    const { data, error } = await supabase.from('meeting_location_requests')
      .update({ status, decided_by: profile.id, decided_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('id')
    setActingId(null)
    if (error) { toastError(error, 'Could not save: ' + error.message); return }
    if (!data?.length) { toastError(null, 'Not saved - you may not have permission.'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  if (!rows.length) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
        <MapPin size={16} /> Meeting location requests · {rows.length}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map(r => {
          const busy = actingId === r.id
          const maps = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`
          return (
            <div key={r.id} className="v2d-panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{r.name} · {r.company || 'Client'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {r.distance_m} m from the client (limit 100 m){r.rep_accuracy_m ? ` · GPS ±${Math.round(r.rep_accuracy_m)} m` : ''} · {fmt(r.created_at)}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 8 }}>"{r.reason}"</div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12 }}>
                <a href={maps(r.pin_lat, r.pin_lng)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #FFE600)' }}>Client pin</a>
                <a href={maps(r.rep_lat, r.rep_lng)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, #FFE600)' }}>Rep location</a>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="v2d-btn v2d-btn--danger" onClick={() => decide(r, 'rejected')} disabled={busy} style={{ flex: 1, minHeight: 40 }}>
                  <XCircle size={14} /> Reject
                </button>
                <button className="v2d-btn" onClick={() => decide(r, 'approved')} disabled={busy} style={{ flex: 1, minHeight: 40 }}>
                  <CheckCircle2 size={14} /> Approve
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
