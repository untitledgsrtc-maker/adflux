// src/components/leads/LeadCallHistory.jsx
//
// Phase 56n — per-lead call history card mounted on LeadDetailV2.
//
// Owner directive (19 May 2026): "per lead log and per representative
// log". Cronberry-style table: phone / duration / date+time / type /
// called-by / recording (recording column is decorative for now —
// Android plugin doesn't capture audio).
//
// Data sources:
//   • call_logs — outgoing tel-tap audits + Phase 56l-scanned inbound /
//     missed rows. Has direction, duration_seconds, outcome.
//   • lead_activities — rep-claimed call activities. Has notes,
//     outcome, duration_seconds.
//
// We merge both by (timestamp within 60 sec) since a single call
// usually has one row in each table. UI shows the merged view; the
// dedupe key prefers the call_logs row (it has direction).

import { useEffect, useState } from 'react'
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function LeadCallHistory({ leadId }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!leadId) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      try {
        const [cl, la] = await Promise.all([
          supabase
            .from('call_logs')
            .select('id, call_at, direction, duration_seconds, outcome, client_phone, user_id, notes')
            .eq('lead_id', leadId)
            .order('call_at', { ascending: false })
            .limit(100),
          supabase
            .from('lead_activities')
            .select('id, created_at, outcome, duration_seconds, notes, created_by, user:created_by(id, name)')
            .eq('lead_id', leadId)
            .eq('activity_type', 'call')
            .order('created_at', { ascending: false })
            .limit(100),
        ])
        if (cancelled) return
        if (cl.error) throw cl.error
        if (la.error) throw la.error
        // Fetch user names for call_logs rows (no PostgREST FK embed
        // since join is via user_id directly).
        const userIds = Array.from(new Set([
          ...(cl.data || []).map(r => r.user_id),
          ...(la.data || []).map(r => r.created_by),
        ].filter(Boolean)))
        let userMap = {}
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, name')
            .in('id', userIds)
          userMap = Object.fromEntries((users || []).map(u => [u.id, u.name]))
        }
        if (cancelled) return
        setRows(mergeRows(cl.data || [], la.data || [], userMap))
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load call history')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [leadId])

  if (loading) {
    return (
      <div className="lead-card lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
        Loading call history…
      </div>
    )
  }

  if (error) {
    return (
      <div className="lead-card lead-card-pad" style={{ color: 'var(--danger)', fontSize: 12 }}>
        Couldn't load call history: {error}
      </div>
    )
  }

  // Counts for header strip.
  const counts = rows.reduce((acc, r) => {
    acc[r.direction || 'outgoing'] = (acc[r.direction || 'outgoing'] || 0) + 1
    return acc
  }, {})

  return (
    <div className="lead-card">
      <div className="lead-card-head">
        <div className="lead-card-title">Call history</div>
        <div className="lead-card-sub" style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
          <PhoneOutgoing size={11} strokeWidth={1.6} style={{ verticalAlign: 'middle' }} /> {counts.outgoing || 0}
          {'  '}
          <PhoneIncoming size={11} strokeWidth={1.6} style={{ verticalAlign: 'middle' }} /> {counts.incoming || 0}
          {'  '}
          <PhoneMissed   size={11} strokeWidth={1.6} style={{ verticalAlign: 'middle', color: 'var(--danger)' }} /> {counts.missed || 0}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          No call history yet — outbound calls log automatically via the Call button.
          Inbound + missed calls appear once the Android app scans your phone log.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Duration</Th>
                <Th>Outcome</Th>
                <Th>Called by</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <Td>{formatDate(r.timestamp)}</Td>
                  <Td><DirectionPill direction={r.direction} /></Td>
                  <Td>{formatDuration(r.duration_seconds)}</Td>
                  <Td><OutcomeChipLite outcome={r.outcome} /></Td>
                  <Td>{r.user_name || '—'}</Td>
                  <Td style={{ color: 'var(--text-muted)', maxWidth: 280 }}>
                    {r.notes || '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─── Merge logic ─────────────────────────────────────────────── */

// Phase 102.B (2026-05-29) — display-side dedupe for the per-minute
// dup race documented in callHistoryIngest.js. When two scans race
// past the dedupe SELECT (or an old-schema audit row carries NULL
// phone), the DB ends up with two near-identical rows for the same
// call. Pick the best per (user_id, client_phone, minute) bucket.
// Priority: direction set > duration > notes. Rows with no phone or
// no call_at can't be deduped → kept as-is.
function dedupeCallLogs(rows) {
  const score = (x) => (
    (x.direction ? 4 : 0)
    + (Number(x.duration_seconds || 0) > 0 ? 2 : 0)
    + (x.notes ? 1 : 0)
  )
  const groups = new Map()
  for (const r of rows) {
    if (!r.client_phone || !r.call_at) {
      groups.set(`solo-${r.id}`, r)
      continue
    }
    const minute = Math.floor(new Date(r.call_at).getTime() / 60_000)
    const key = `${r.user_id}|${r.client_phone}|${minute}`
    const prev = groups.get(key)
    if (!prev || score(r) > score(prev)) groups.set(key, r)
  }
  return Array.from(groups.values())
}

function mergeRows(callLogsRaw, activities, userMap) {
  // Merge by (timestamp within 60s). Prefer call_logs (has direction).
  const callLogs = dedupeCallLogs(callLogsRaw)
  const merged = []
  const used   = new Set()

  for (const cl of callLogs) {
    const ts = new Date(cl.call_at).getTime()
    // Find a matching lead_activity within 60s.
    let matchedAct = null
    for (const a of activities) {
      if (used.has(a.id)) continue
      const ats = new Date(a.created_at).getTime()
      if (Math.abs(ats - ts) < 60_000) {
        matchedAct = a
        break
      }
    }
    if (matchedAct) used.add(matchedAct.id)
    merged.push({
      key:              `cl-${cl.id}`,
      timestamp:        ts,
      direction:        cl.direction || 'outgoing',
      duration_seconds: cl.duration_seconds ?? matchedAct?.duration_seconds ?? null,
      outcome:          matchedAct?.outcome || cl.outcome,
      notes:            matchedAct?.notes || cl.notes || '',
      user_name:        userMap[cl.user_id] || userMap[matchedAct?.created_by] || '',
      phone:            cl.client_phone,
    })
  }

  // Pick up any activity rows with no matching call_logs entry
  // (e.g. legacy data before Phase 56l, OR manually-logged calls
  // where the rep didn't actually tap Call).
  for (const a of activities) {
    if (used.has(a.id)) continue
    merged.push({
      key:              `la-${a.id}`,
      timestamp:        new Date(a.created_at).getTime(),
      direction:        'outgoing',                // best guess
      duration_seconds: a.duration_seconds ?? null,
      outcome:          a.outcome,
      notes:            a.notes || '',
      user_name:        a.user?.name || userMap[a.created_by] || '',
      phone:            null,
    })
  }

  // Sort newest first.
  merged.sort((a, b) => b.timestamp - a.timestamp)
  return merged
}

/* ─── Small render helpers ───────────────────────────────────── */
function DirectionPill({ direction }) {
  if (direction === 'incoming') {
    return (
      <span style={pillBase('var(--success)')}>
        <PhoneIncoming size={11} strokeWidth={1.6} /> Incoming
      </span>
    )
  }
  if (direction === 'missed') {
    return (
      <span style={pillBase('var(--danger)')}>
        <PhoneMissed size={11} strokeWidth={1.6} /> Missed
      </span>
    )
  }
  return (
    <span style={pillBase('var(--accent)')}>
      <PhoneOutgoing size={11} strokeWidth={1.6} /> Outgoing
    </span>
  )
}

function OutcomeChipLite({ outcome }) {
  if (!outcome) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const color = outcome === 'positive' || outcome === 'connected' ? 'var(--success)'
              : outcome === 'negative' || outcome === 'no_answer' ? 'var(--danger)'
              : outcome === 'callback' || outcome === 'callback_requested' ? 'var(--warning)'
              : 'var(--text-muted)'
  return <span style={{ color, fontSize: 11, fontWeight: 600 }}>{outcome}</span>
}

function pillBase(color) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color,
    border: `1px solid ${color}`,
    background: 'transparent',
  }
}

function Th({ children }) {
  return (
    <th style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '.10em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      padding: '8px 10px',
      textAlign: 'left',
      borderBottom: '1px solid var(--border)',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}
function Td({ children, style }) {
  return (
    <td style={{
      fontSize: 12,
      padding: '8px 10px',
      borderBottom: '1px solid var(--border)',
      color: 'var(--text)',
      verticalAlign: 'middle',
      ...style,
    }}>{children}</td>
  )
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-sans)',
}

function formatDate(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
function formatDuration(sec) {
  // Phase 102.B (2026-05-29) — zero / null both render as em-dash so
  // missed / no_answer rows don't look like real connected calls.
  // safeDuration in callHistoryIngest.js + the outcome filter in
  // callLogReader.js write 0 here when the call never connected.
  if (sec == null) return '—'
  const s = Number(sec)
  if (!Number.isFinite(s) || s <= 0) return '—'
  if (s < 60) return `${s} sec`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m} min` : `${m} min ${r} sec`
}
