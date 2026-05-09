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
// Phase 31R (10 May 2026) — owner audit caught a load-bearing bug:
// this file had its own duplicate STAGE_LABELS / STAGE_GROUPS /
// LEAD_STAGES that shadowed the canonical exports in useLeads.js.
// Phase 31N (Nurture) and 31P (Working → Follow-up label) silently
// did nothing on every page that imported StageChip / stageLabel /
// STAGE_GROUPS / LEAD_STAGES from here, because those consumers got
// the OLD 5-stage map. Re-export from useLeads so there is exactly
// one source of truth across the codebase.
import {
  STAGE_LABELS,
  STAGE_GROUPS as USE_LEADS_STAGE_GROUPS,
  LEAD_STAGES as USE_LEADS_LEAD_STAGES,
} from '../../hooks/useLeads'

/* ─── Stage chip ────────────────────────────────────────────────────
   Phase 31R — pulls labels from the single source of truth in
   useLeads.js. Working leads with a missed handoff_sla_due_at get
   the pulse dot. Pulse animation in leads.css @keyframes leadpulse. */

export function StageChip({ stage, sm = false, slaBreached = false }) {
  if (!stage) return null
  const cls = `stage-chip stage-${String(stage).toLowerCase()}`
  const style = sm ? { fontSize: 10, padding: '2px 7px' } : undefined
  return (
    <span className={cls} style={style}>
      {stage === 'Working' && slaBreached && <span className="pulse-dot" />}
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
   tabs / charts can colour-code consistently.
   Phase 31R — Nurture rail uses 's-sr' (purple, same as old SalesReady)
   so we don't need a new CSS class. QuoteSent moves to 's-qual' (amber)
   to match its STAGE_TINT (Phase 31N). */
export function stageRailClass(stage) {
  const s = String(stage).toLowerCase()
  if (s === 'new')       return 's-new'
  if (s === 'working')   return 's-qual'   // amber rail
  if (s === 'quotesent') return 's-qual'   // amber rail (Phase 31N)
  if (s === 'nurture')   return 's-sr'     // purple rail (Phase 31N)
  if (s === 'won')       return 's-won'
  if (s === 'lost')      return 's-lost'
  return ''
}

/* ─── Convenience export: human-readable stage label ──────────────
   So pages can render "Sales Ready" not "SalesReady" without
   duplicating the map. */
export function stageLabel(stage) {
  return STAGE_LABELS[stage] || stage || ''
}

/* ─── Stage groups + LEAD_STAGES re-exports ─────────────────────────
   Phase 31R — these used to be defined locally and silently disagreed
   with useLeads.js. Now we re-export the canonical lists with one
   addition: an 'all' filter group at the top (filter UIs need it; the
   useLeads version omits it because LEAD_STAGES is also used as a DB
   value list where 'all' would be invalid). */
export const STAGE_GROUPS = [
  { key: 'all', label: 'All', stages: null /* no filter */ },
  ...USE_LEADS_STAGE_GROUPS,
]

export const LEAD_STAGES = USE_LEADS_LEAD_STAGES

/* All exports declared via `export function` / `export const` above. */
