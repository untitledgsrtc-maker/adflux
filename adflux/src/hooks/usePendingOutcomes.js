// src/hooks/usePendingOutcomes.js
//
// Phase 237 — "calls that need an outcome". A rep taps Call → a
// lead_activities row is inserted with activity_type='call', outcome=null
// (WorkV2:691 / TelecallerV2 quickLogCall). The PostCallOutcomeModal patches
// that row's outcome on save. If the rep DISMISSES the popup, outcome stays
// NULL → the call shows as no_answer/blank in history + no follow-up spawns.
//
// This hook surfaces those unresolved calls so the rep can clear them (open the
// SAME outcome modal) and the manager can see who skips. Accountability, not a
// hard block (owner decision 2026-07-15 — a compulsory popup just makes reps
// mash a button to escape it → wrong outcomes; see §104-adjacent discussion).
//
// Derived query only — NO new table, NO trigger, NO hot-path load (§45-safe).
// Reads existing lead_activities with a new filter. Two-query merge (activities
// then leads) instead of a PostgREST FK embed — the embed nulls under some
// FK+RLS combos (§36.6). Bounded to a SHORT window (see LOOKBACK_DAYS) so it
// never dumps a months-old backlog as fresh work (§131 foot-gun).

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { istTodayPlusDays } from '../utils/istDate'

const IN_FLIGHT_MS = 3 * 60 * 1000   // skip the call the rep is still on / resolving

// Phase 237 — ONE definition of a "pending outcome", shared by the rep list
// (this hook) AND the manager count (TeamDashboardV2), so the two never drift
// (§69/§71 — same rule in two places is the "works then breaks" disease).
// Change the rule HERE and both surfaces move together.
export const PENDING_CLOSED_STAGES = ['Won', 'Lost']

// Applies the shared pending filters to a `lead_activities` query builder:
// a call, no outcome saved, TODAY (IST), older than the in-flight buffer, tied
// to a lead. The Won/Lost exclusion needs the lead row, so the caller does it
// with PENDING_CLOSED_STAGES after joining leads.
// Phase 250 — widened from today-only to a 3-day window.
//
// Today-only meant a call lost at 7pm was gone from the list by the next
// morning, so the rep never captured the outcome and the customer was never
// followed up. The commonest loss (the app being killed mid-call) happens at the
// END of a call, i.e. late in the day, which is exactly what a midnight cutoff
// throws away. Three days covers a weekend without becoming a guilt list.
const LOOKBACK_DAYS = 3

export function applyPendingOutcomeFilters(qb) {
  return qb
    .eq('activity_type', 'call')
    .is('outcome', null)
    .gte('created_at', `${istTodayPlusDays(-LOOKBACK_DAYS)}T00:00:00+05:30`)  // IST, not UTC (§57)
    .lt('created_at', new Date(Date.now() - IN_FLIGHT_MS).toISOString())      // skip the in-flight call
    .not('lead_id', 'is', null)
}

// Phase 240-adjacent (2026-08-06) — orphan-tap exclusion.
// A single call routinely spawns MORE than one outcome=null 'call' row: a
// re-dial across a minute boundary (the first row survives the Phase 68.2
// dedupe, the second inserts fresh), the modal's fresh-insert fork when
// pendingActivityId is null, and rapid-dialing that overwrites the ONE shared
// pendingActivityId. The outcome modal patches only ONE row → the rep resolves
// the call but the duplicate tap-rows linger as "pending" forever (Dhara: 34 of
// 36 pending had a resolved sibling).
//
// FIX IS READ-SIDE ONLY — we hide, never mutate. compute_daily_score's CALL
// branch is COUNT(*) on (outcome IS NOT NULL OR ≥10s) (db/functions/
// compute_daily_score.sql), so filling a duplicate's outcome would DOUBLE-COUNT
// the call → inflate the TC score → inflate incentive. So a null-outcome row
// with a RESOLVED sibling (same lead+rep, another 'call' row WITH an outcome
// within ±45 min) is dropped from the card + manager count; the row keeps
// outcome=null and never counts. Genuinely-skipped calls (no resolved sibling)
// still show — the card working as intended.
const SIBLING_WINDOW_MS = 45 * 60 * 1000

// Query filter for the RESOLVED calls used to exclude orphans (same 3-day floor).
export function applyResolvedCallFilters(qb) {
  return qb
    .eq('activity_type', 'call')
    .not('outcome', 'is', null)
    .gte('created_at', `${istTodayPlusDays(-LOOKBACK_DAYS)}T00:00:00+05:30`)
}

// Pure — drop pending acts whose call was resolved by a sibling within ±45 min.
// Matched on lead_id + created_by so a manager view can't cross reps. Shared by
// the rep card (this hook) AND the manager count (TeamDashboardV2) → one rule (§71).
export function excludeResolvedSiblings(pendingActs, resolvedActs) {
  const byKey = {}
  for (const r of resolvedActs || []) {
    const k = `${r.lead_id}|${r.created_by}`
    ;(byKey[k] || (byKey[k] = [])).push(new Date(r.created_at).getTime())
  }
  return (pendingActs || []).filter(p => {
    const sibs = byKey[`${p.lead_id}|${p.created_by}`]
    if (!sibs) return true
    const t = new Date(p.created_at).getTime()
    return !sibs.some(rt => Math.abs(rt - t) <= SIBLING_WINDOW_MS)
  })
}

export default function usePendingOutcomes(repId, refreshKey = 0) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!repId) { setItems([]); return }
    setLoading(true)
    try {
      // Pending taps + the resolved calls that clear them — independent, fetch in parallel.
      const [{ data: acts, error }, { data: resolved }] = await Promise.all([
        applyPendingOutcomeFilters(
          supabase.from('lead_activities')
            .select('id, lead_id, created_at, created_by')
            .eq('created_by', repId)                                 // NOT user_id (§76)
        ).order('created_at', { ascending: false }).limit(40),
        applyResolvedCallFilters(
          supabase.from('lead_activities')
            .select('lead_id, created_by, created_at')
            .eq('created_by', repId)
        ).order('created_at', { ascending: false }).limit(1000),
      ])
      if (error || !acts || acts.length === 0) { setItems([]); return }

      // Drop orphan taps whose call was already resolved (read-only, §71 shared rule).
      const survivors = excludeResolvedSiblings(acts, resolved || [])
      if (survivors.length === 0) { setItems([]); return }

      const leadIds = [...new Set(survivors.map(a => a.lead_id))]
      const { data: leads } = await supabase
        .from('leads')
        .select('id, name, company, phone, stage')
        .in('id', leadIds)
      const leadMap = Object.fromEntries((leads || []).map(l => [l.id, l]))

      const list = survivors
        .map(a => ({ activityId: a.id, created_at: a.created_at, lead: leadMap[a.lead_id] }))
        .filter(x => x.lead && !PENDING_CLOSED_STAGES.includes(x.lead.stage))
      setItems(list)
    } catch {
      setItems([])   // best-effort — an accountability nudge never breaks the page
    } finally {
      setLoading(false)
    }
  }, [repId])

  useEffect(() => { load() }, [load, refreshKey])

  // Refetch when the rep returns to the tab (they may have resolved a call
  // elsewhere). Cheap; no polling.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  return { items, count: items.length, loading, refresh: load }
}
