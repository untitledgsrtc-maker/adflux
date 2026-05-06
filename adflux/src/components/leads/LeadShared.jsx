// src/components/leads/LeadShared.jsx
//
// Phase 1+ — shared building blocks for the lead module redesign
// (ported from _design_reference/Leads/lead-shared.jsx, owner approved
// 6 May 2026). Three principles:
//
//   1. NO inline SVG icons. The reference uses a custom <LIcon /> with
//      hand-rolled SVG paths; per UI_DESIGN_SYSTEM.md and CLAUDE.md the
//      app uses lucide-react only. Pages import the icons they need at
//      use site (e.g. `import { Phone } from 'lucide-react'`).
//
//   2. NO mock data here. The reference's `LEADS` array is for design
//      preview only; the live components in v2 pages fetch from
//      Supabase. Keeping this file data-free means it can be reused on
//      list, detail, modals, mobile, and telecaller screens without
//      circular import risk.
//
//   3. Style classes come from `src/styles/leads.css` (imported via
//      globals.css). All chip/dot/avatar palettes match the spec —
//      brand yellow #FFE600, SalesReady pulses, heat hot is danger
//      with glow, etc.
//
// To activate the lead-module typography helpers (Space Grotesk on
// `.display`/`h1-h3`, JetBrains Mono on `.mono`/`.num`), wrap the page
// content in <div className="lead-root">.

import { initials as initialsHelper } from '../../utils/formatters'

/* ─── Stage chip ────────────────────────────────────────────────────
   10 stages (per Phase 12 schema). SalesReady gets a pulsing dot —
   it's the SLA-critical waiting state, the 24h hand-off clock is
   running. The pulse animation lives in leads.css under @keyframes
   leadpulse. */
const STAGE_LABELS = {
  New:               'New',
  Contacted:         'Contacted',
  Qualified:         'Qualified',
  SalesReady:        'Sales Ready',
  MeetingScheduled:  'Meeting',
  QuoteSent:         'Quote Sent',
  Negotiating:       'Negotiating',
  Won:               'Won',
  Lost:              'Lost',
  Nurture:           'Nurture',
}

export function StageChip({ stage, sm = false }) {
  if (!stage) return null
  const cls = `stage-chip stage-${String(stage).toLowerCase()}`
  const style = sm ? { fontSize: 10, padding: '2px 7px' } : undefined
  return (
    <span className={cls} style={style}>
      {stage === 'SalesReady' && <span className="pulse-dot" />}
      {STAGE_LABELS[stage] || stage}
    </span>
  )
}

/* ─── Heat dot ──────────────────────────────────────────────────────
   8×8 round dot for hot/warm/cold. Hot has a soft red glow (per
   spec) so it pops out of dense rows. */
export function HeatDot({ heat }) {
  const h = heat || 'cold'
  return <span className={`heat-dot heat-${h}`} title={h} />
}

/* ─── Segment chip ──────────────────────────────────────────────────
   Govt → yellow tint (brand), Private → blue tint. Stays in sync
   with the two-company architecture (Untitled Advertising vs
   Untitled Adflux Pvt Ltd). Accepts either 'GOVERNMENT' / 'PRIVATE'
   from the DB or 'Government' / 'Private' from design code. */
export function SegChip({ segment }) {
  if (!segment) return null
  const isGovt = String(segment).toLowerCase().startsWith('gov')
  return (
    <span className={`seg-chip ${isGovt ? 'seg-govt' : 'seg-priv'}`}>
      {isGovt ? 'Govt' : 'Private'}
    </span>
  )
}

/* ─── Avatar (initials, 6-color rotation) ──────────────────────────
   Per UI_DESIGN_SYSTEM.md §4.8 — 28×28 circle, Space Grotesk 600.
   Color scheme indexed by `userId.charCodeAt(0) % 6 + 1`, or
   passed in explicitly via `colorIndex` for cases where the design
   pre-assigned a slot. */
export function LeadAvatar({ name, userId, colorIndex }) {
  const idx = colorIndex
    ? colorIndex
    : userId
      ? (String(userId).charCodeAt(0) % 6) + 1
      : (String(name || '').charCodeAt(0) % 6) + 1
  const safeName = name || '?'
  return (
    <span className={`lead-avatar av-${idx}`}>
      {initialsHelper(safeName)}
    </span>
  )
}

/* ─── Outcome chip (timeline) ──────────────────────────────────────
   For lead_activities.outcome ∈ {positive, neutral, negative, null}.
   Returns null on null so the timeline renders without an empty pill. */
export function OutcomeChip({ outcome }) {
  if (!outcome) return null
  const map = { positive: 'pos', neutral: 'neu', negative: 'neg' }
  const slug = map[String(outcome).toLowerCase()] || 'neu'
  const label = outcome[0].toUpperCase() + outcome.slice(1).toLowerCase()
  return <span className={`outcome outcome-${slug}`}>{label}</span>
}

/* ─── Pill helper (success / warn / danger / blue / default) ───────
   Used for SLA badges, "✓ auto-mapped" CSV import flags, "live"
   indicators, etc. Tone defaults to neutral surface-2. */
export function Pill({ tone, children, style }) {
  const cls = tone ? `pill pill-${tone}` : 'pill'
  return <span className={cls} style={style}>{children}</span>
}

/* ─── Stage palette helper for dashboards ──────────────────────────
   Maps a stage to the kanban-rail accent class used on
   <div className="lead-stage-col s-{...}">. Centralised so future
   tabs / charts can colour-code consistently. */
export function stageRailClass(stage) {
  const s = String(stage).toLowerCase()
  if (s === 'new')        return 's-new'
  if (s === 'contacted')  return 's-cont'
  if (s === 'qualified' || s === 'meetingscheduled' || s === 'quotesent' || s === 'negotiating') return 's-qual'
  if (s === 'salesready') return 's-sr'
  if (s === 'won')        return 's-won'
  if (s === 'lost')       return 's-lost'
  return ''
}

/* ─── Convenience export: human-readable stage label ──────────────
   So pages can render "Sales Ready" not "SalesReady" without
   duplicating the map. */
export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || ''
}

/* ─── Convenience export: stage groups (matches /leads filter row).
   Mirrors LEAD_STAGE_GROUPS in useLeads.js — kept here so list +
   detail pages can share the same 6-tab arrangement. */
export const STAGE_GROUPS = [
  { key: 'all',         label: 'All',         stages: null /* no filter */ },
  { key: 'open',        label: 'Open',        stages: ['New', 'Contacted', 'Nurture'] },
  { key: 'qualified',   label: 'Qualified',   stages: ['Qualified', 'SalesReady', 'MeetingScheduled'] },
  { key: 'in_progress', label: 'In Progress', stages: ['QuoteSent', 'Negotiating'] },
  { key: 'won',         label: 'Won',         stages: ['Won'] },
  { key: 'lost',        label: 'Lost',        stages: ['Lost'] },
]

export const LEAD_STAGES = [
  'New', 'Contacted', 'Qualified', 'SalesReady', 'MeetingScheduled',
  'QuoteSent', 'Negotiating', 'Won', 'Lost', 'Nurture',
]

/* All exports declared via `export function` / `export const` above. */
