// src/components/leads/ReassignSuggestModal.jsx
//
// Phase 285 — post-call nudge: "you've called this lead N times, hand it off?"
//
// Presentational only. Fires after a rep saves a call outcome on a lead they
// have called more than 5 times (see reassignNudge.js). "Hand off" opens the
// existing ReassignModal (the canonical reassign UI + reassign_lead RPC);
// "Keep working it" dismisses + remembers for 24h so it doesn't nag every call.
//
// Uses the same .lead-modal-* chrome as ReassignModal so the two read as one
// flow. Calm copy per CLAUDE.md §20 — no salesy framing.

import { UserPlus, X } from 'lucide-react'

export default function ReassignSuggestModal({ open, lead, count, onReassign, onKeep }) {
  if (!open || !lead) return null

  const name = lead.name || 'this lead'

  return (
    <div
      className="lead-modal-back"
      onClick={(e) => { if (e.target === e.currentTarget) onKeep?.() }}
    >
      <div className="lead-modal" style={{ maxWidth: 400 }}>
        <div className="lead-modal-head">
          <div>
            <div className="lead-modal-title">
              <UserPlus size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Hand this lead off?
            </div>
            <div className="lead-card-sub">
              {name}{lead.company ? ` · ${lead.company}` : ''}
            </div>
          </div>
          <button className="lead-btn lead-btn-sm" onClick={onKeep} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="lead-modal-body">
          <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--v2-ink-1, #a9b3c7)' }}>
            You've followed up on {name} <strong style={{ color: 'var(--v2-ink-0, #f5f7fb)' }}>{count} times</strong> with no
            close yet. A teammate with fresh eyes may land it. Reassign, or keep working it?
          </div>
        </div>

        <div className="lead-modal-foot">
          <button className="lead-btn" onClick={onKeep}>Keep working it</button>
          <button className="lead-btn lead-btn-primary" onClick={onReassign}>
            <UserPlus size={14} />
            <span>Hand off</span>
          </button>
        </div>
      </div>
    </div>
  )
}
