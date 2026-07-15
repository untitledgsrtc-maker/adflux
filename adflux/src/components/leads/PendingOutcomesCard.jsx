// src/components/leads/PendingOutcomesCard.jsx
//
// Phase 237 — "N calls need an outcome" nudge for the rep. Lists today's calls
// where the rep tapped Call but never saved the outcome popup (lead_activities
// outcome=null). Each row opens the SAME PostCallOutcomeModal (via onResolve →
// the parent's existing modal state) so there is ONE outcome path — no
// duplicate logic (§71). Exception-rendered: nothing shows when the list is
// empty. Non-blocking accountability, not a hard gate (owner decision).
//
// Self-contained data via usePendingOutcomes(repId, refreshKey). The parent
// bumps refreshKey after a save so a resolved call drops off the list.

import { ClipboardList, PhoneOutgoing } from 'lucide-react'
import usePendingOutcomes from '../../hooks/usePendingOutcomes'

const MAX_SHOWN = 12

function callTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return '' }
}

export default function PendingOutcomesCard({ repId, refreshKey = 0, onResolve }) {
  const { items, count } = usePendingOutcomes(repId, refreshKey)
  if (count === 0) return null

  const shown = items.slice(0, MAX_SHOWN)
  const extra = count - shown.length

  return (
    <div className="lead-card" style={{ marginBottom: 16, borderColor: 'var(--v2-amber, #F59E0B)' }}>
      <div className="lead-card-head" style={{ borderBottom: '1px solid var(--v2-line, #1f2b47)', paddingBottom: 10, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            display: 'inline-flex', width: 30, height: 30, borderRadius: 10,
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--v2-amber-soft, rgba(245,158,11,0.14))', color: 'var(--v2-amber, #F59E0B)',
          }}>
            <ClipboardList size={16} strokeWidth={1.7} />
          </span>
          <div>
            <div className="lead-card-title">{count} call{count > 1 ? 's' : ''} need an outcome</div>
            <div className="lead-card-sub">Set what happened — keeps your call history + follow-ups right</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {shown.map((it) => (
          <div key={it.activityId} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
            borderBottom: '1px solid var(--v2-line, #1f2b47)',
          }}>
            <span style={{ color: 'var(--v2-ink-2, #6a7590)', display: 'inline-flex' }}>
              <PhoneOutgoing size={15} strokeWidth={1.7} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--v2-ink-0, #f5f7fb)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.lead?.name || it.lead?.company || 'Lead'}
              </div>
              <div style={{ color: 'var(--v2-ink-2, #6a7590)', fontSize: 12 }}>
                {it.lead?.company && it.lead?.name ? it.lead.company + ' · ' : ''}{callTime(it.created_at)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onResolve && onResolve(it)}
              style={{
                background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0b1220)',
                border: 'none', borderRadius: 10, height: 34, padding: '0 14px',
                fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              Set outcome
            </button>
          </div>
        ))}
      </div>

      {extra > 0 && (
        <div style={{ color: 'var(--v2-ink-2, #6a7590)', fontSize: 12, paddingTop: 10 }}>
          + {extra} more
        </div>
      )}
    </div>
  )
}
