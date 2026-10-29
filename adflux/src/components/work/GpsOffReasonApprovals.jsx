// src/components/work/GpsOffReasonApprovals.jsx
//
// Phase 530 / 533 — admin queue for "why was GPS / internet off" reasons sent by field reps.
// Mounted on /pending-approvals. Excused / Not excused is a label only: it does
// not change score, TA or incentive. Reads gps_off_reasons, then gps_off_events
// and users by id in separate queries (no FK embeds, section 36.6).

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, XCircle, MapPinOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { toastError } from '../v2/Toast'

const LABEL = {
  phone_off: 'Phone was switched off',
  battery_dead: 'Battery died',
  saving_battery: 'Turned it off to save battery',
  no_signal: 'No network / signal where I was',
  data_finished: 'Mobile data / recharge finished',
  turned_off_by_mistake: 'Turned it off by mistake',
  other: 'Other',
}

const fmt = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  : 'still off'

export default function GpsOffReasonApprovals() {
  const profile = useAuthStore(s => s.profile)
  const [rows, setRows] = useState([])
  const [actingId, setActingId] = useState(null)

  const load = useCallback(async () => {
    const [gR, nR] = await Promise.all([
      supabase.from('gps_off_reasons')
        .select('id, event_id, user_id, reason_code, reason_note, created_at').eq('status', 'pending'),
      supabase.from('net_off_reasons')
        .select('id, event_id, user_id, reason_code, reason_note, created_at').eq('status', 'pending'),
    ])
    const reasons = [
      ...(gR.data || []).map(r => ({ ...r, kind: 'gps' })),
      ...(nR.data || []).map(r => ({ ...r, kind: 'net' })),
    ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    if (!reasons.length) { setRows([]); return }
    const gIds = reasons.filter(r => r.kind === 'gps').map(r => r.event_id)
    const nIds = reasons.filter(r => r.kind === 'net').map(r => r.event_id)
    const [gEv, nEv, us] = await Promise.all([
      gIds.length ? supabase.from('gps_off_events').select('id, toggled_off_at, toggled_on_at, duration_seconds').in('id', gIds) : { data: [] },
      nIds.length ? supabase.from('network_off_events').select('id, lost_at, regained_at, duration_seconds').in('id', nIds) : { data: [] },
      supabase.from('users').select('id, name').in('id', [...new Set(reasons.map(r => r.user_id))]),
    ])
    const evById = {
      ...Object.fromEntries((gEv.data || []).map(e => [e.id, { off: e.toggled_off_at, on: e.toggled_on_at, secs: e.duration_seconds }])),
      ...Object.fromEntries((nEv.data || []).map(e => [e.id, { off: e.lost_at, on: e.regained_at, secs: e.duration_seconds }])),
    }
    const nameById = Object.fromEntries((us.data || []).map(u => [u.id, u.name]))
    setRows(reasons.map(r => ({ ...r, ev: evById[r.event_id], name: nameById[r.user_id] || 'Rep' })))
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(row, status) {
    if (actingId) return
    setActingId(row.id)
    const { data, error } = await supabase.from(row.kind === 'net' ? 'net_off_reasons' : 'gps_off_reasons')
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
        <MapPinOff size={16} /> GPS / internet-off reasons · {rows.length}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map(r => {
          const busy = actingId === r.id
          const mins = r.ev?.secs ? Math.round(r.ev.secs / 60) : null
          return (
            <div key={r.id} className="v2d-panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {r.kind === 'net' ? 'Internet off' : 'GPS off'} {fmt(r.ev?.off)} – {fmt(r.ev?.on)}{mins ? ` · ${mins} min` : ''}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 8 }}>
                {LABEL[r.reason_code] || r.reason_code}
                {r.reason_note ? <span style={{ color: 'var(--text-muted)' }}> — "{r.reason_note}"</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="v2d-btn v2d-btn--danger"
                  onClick={() => decide(r, 'not_excused')}
                  disabled={busy}
                  style={{ flex: 1, minHeight: 40 }}
                >
                  <XCircle size={14} /> Not excused
                </button>
                <button
                  className="v2d-btn"
                  onClick={() => decide(r, 'excused')}
                  disabled={busy}
                  style={{ flex: 1, minHeight: 40 }}
                >
                  <CheckCircle2 size={14} /> Excused
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
