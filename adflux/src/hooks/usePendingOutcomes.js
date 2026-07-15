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
// FK+RLS combos (§36.6). Bounded to TODAY (IST) so day 1 doesn't dump a
// months-old backlog (§131 foot-gun).

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { istTodayISO } from '../utils/istDate'

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
export function applyPendingOutcomeFilters(qb) {
  return qb
    .eq('activity_type', 'call')
    .is('outcome', null)
    .gte('created_at', `${istTodayISO()}T00:00:00+05:30`)                 // IST midnight, not UTC (§57)
    .lt('created_at', new Date(Date.now() - IN_FLIGHT_MS).toISOString())  // skip the in-flight call
    .not('lead_id', 'is', null)
}

export default function usePendingOutcomes(repId, refreshKey = 0) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!repId) { setItems([]); return }
    setLoading(true)
    try {
      const { data: acts, error } = await applyPendingOutcomeFilters(
        supabase.from('lead_activities')
          .select('id, lead_id, created_at')
          .eq('created_by', repId)                                   // NOT user_id (§76)
      ).order('created_at', { ascending: false }).limit(40)
      if (error || !acts || acts.length === 0) { setItems([]); return }

      const leadIds = [...new Set(acts.map(a => a.lead_id))]
      const { data: leads } = await supabase
        .from('leads')
        .select('id, name, company, phone, stage')
        .in('id', leadIds)
      const leadMap = Object.fromEntries((leads || []).map(l => [l.id, l]))

      const list = acts
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
