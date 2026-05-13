// src/components/leads/StageAgeChip.jsx
//
// Phase 34L — "X days in current stage" chip. Shown on every lead
// row + on lead detail header. Visual urgency:
//
//   < 3 days   → muted gray  ("4 hrs ago" or "2 d")
//   3–4 days   → amber       ("3 d in Working")
//   ≥ 5 days   → red         ("7 d in Working — push it")
//
// Leads in terminal stages (Won / Lost) show no chip — they're
// no longer moving, age doesn't matter.

import { Clock } from 'lucide-react'

const TERMINAL_STAGES = new Set(['Won', 'Lost'])

function daysBetween(thenIso, now = new Date()) {
  if (!thenIso) return null
  const then = new Date(thenIso)
  if (Number.isNaN(then.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400000))
}

function shortAge(thenIso) {
  if (!thenIso) return null
  const then = new Date(thenIso)
  if (Number.isNaN(then.getTime())) return null
  const diffMs = Date.now() - then.getTime()
  if (diffMs < 0) return 'just now'
  if (diffMs < 3600000) return Math.max(1, Math.floor(diffMs / 60000)) + ' min'
  if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + ' hr'
  return Math.floor(diffMs / 86400000) + ' d'
}

export function StageAgeChip({ stage, stageChangedAt, compact = false }) {
  if (TERMINAL_STAGES.has(stage)) return null
  const days = daysBetween(stageChangedAt)
  if (days === null) return null

  let bg = 'rgba(148, 163, 184, 0.14)'
  let fg = 'var(--text-muted, #94a3b8)'
  let bd = 'transparent'
  let urgency = ''

  if (days >= 5) {
    bg = 'rgba(239, 68, 68, 0.14)'
    fg = 'var(--danger, #EF4444)'
    bd = 'var(--danger, #EF4444)'
    urgency = ' — push it'
  } else if (days >= 3) {
    bg = 'rgba(245, 158, 11, 0.14)'
    fg = 'var(--warning, #F59E0B)'
    bd = 'var(--warning, #F59E0B)'
  }

  const label = compact
    ? shortAge(stageChangedAt) + ' in stage'
    : (days >= 1
        ? `${days} d in ${stage || 'stage'}${urgency}`
        : `${shortAge(stageChangedAt)} in ${stage || 'stage'}`)

  return (
    <span
      title={`Stage last changed ${shortAge(stageChangedAt)} ago`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 999,
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <Clock size={10} strokeWidth={1.8} />
      <span>{label}</span>
    </span>
  )
}
