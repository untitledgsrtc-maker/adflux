// src/components/leads/RepLeaveHistory.jsx
//
// Phase 36.11 — rep-side leave history list.
//
// Owner reported (17 May 2026) leave requests didn't appear anywhere
// on the rep side after submission. The TA/DA claims have a "Your
// past claims" table at the bottom of TaDaRequestPanel, but leaves
// went into a black hole — rep submits and can never see status.
//
// This component reads `leaves` rows for the signed-in rep and
// renders a 5-column history table mirroring the claims-history
// pattern (date / type+half / pay status / reason / pending|approved
// |rejected chip).

import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function RepLeaveHistory({ userId, refreshKey = 0 }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true); setErr('')
    supabase.from('leaves')
      .select('id, leave_date, leave_type, reason, status, is_half_day, is_paid_request, created_at, admin_note')
      .eq('user_id', userId)
      .order('leave_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setErr(error.message || 'Could not load leaves.')
        else setRows(data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [userId, refreshKey])

  // Phase 36.11.1 — mobile-first card-list layout. Previous grid
  // (95+110+70+1fr+80) overflowed on iPhone width — STATUS column
  // got clipped. Stack each row as a small card: top row = date +
  // status pill on right, middle row = type + pay chip, bottom row
  // = reason/admin_note in muted text. No horizontal overflow.
  const styles = {
    card: {
      background: 'var(--v2-bg-1, var(--surface))',
      border: '1px solid var(--v2-line, var(--border))',
      borderRadius: 12,
      padding: 16,
      marginBottom: 14,
    },
    title: { fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 10 },
    item: {
      padding: '12px 0',
      borderBottom: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 6,
    },
    topRow: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    },
    dateTxt: { fontSize: 13, fontWeight: 600, color: 'var(--text)' },
    midRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    typeTxt: { fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' },
    reasonTxt: {
      fontSize: 11, color: 'var(--text-muted)',
      lineHeight: 1.45, wordBreak: 'break-word',
    },
    adminNote: {
      fontSize: 11, color: 'var(--danger, #EF4444)', fontStyle: 'italic',
      lineHeight: 1.45, wordBreak: 'break-word',
    },
    chip: (status) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
      flexShrink: 0,
      background:
        status === 'approved' ? 'rgba(16,185,129,.18)'
        : status === 'rejected' ? 'rgba(239,68,68,.18)'
        :                          'rgba(245,158,11,.18)',
      color:
        status === 'approved' ? 'var(--success, #10B981)'
        : status === 'rejected' ? 'var(--danger, #EF4444)'
        :                          'var(--warning, #F59E0B)',
    }),
    payChip: (paid) => ({
      display: 'inline-block', padding: '2px 7px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
      background: paid ? 'rgba(43,216,160,.14)' : 'rgba(255,111,97,.14)',
      color:      paid ? '#2BD8A0'              : '#FF6F61',
      border: `1px solid ${paid ? 'rgba(43,216,160,.35)' : 'rgba(255,111,97,.35)'}`,
    }),
  }

  return (
    <div style={styles.card}>
      <div style={styles.title}>Your past leaves</div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
        </div>
      ) : err ? (
        <div style={{ color: 'var(--danger)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={12} /> {err}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          No leave requests yet. Tap "Request leave" above to submit one.
        </div>
      ) : (
        rows.map(r => (
          <div key={r.id} style={styles.item}>
            <div style={styles.topRow}>
              <span style={styles.dateTxt}>{fmtDate(r.leave_date)}</span>
              <span style={styles.chip(r.status)}>{r.status}</span>
            </div>
            <div style={styles.midRow}>
              <span style={styles.typeTxt}>
                {r.leave_type}{r.is_half_day ? ' · ½' : ''}
              </span>
              <span style={styles.payChip(r.is_paid_request !== false)}>
                {r.is_paid_request === false ? 'Unpaid' : 'Paid'}
              </span>
            </div>
            {r.reason && (
              <div style={styles.reasonTxt}>{r.reason}</div>
            )}
            {r.admin_note && (
              <div style={styles.adminNote}>Admin: {r.admin_note}</div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
