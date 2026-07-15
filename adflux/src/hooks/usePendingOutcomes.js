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
const CLOSED_STAGES = ['Won', 'Lost']

export default function usePendingOutcomes(repId, refreshKey = 0) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!repId) { setItems([]); return }
    setLoading(true)
    try {
      const dayStart = `${istTodayISO()}T00:00:00+05:30`           // IST midnight (not UTC — §57)
      const beforeNow = new Date(Date.now() - IN_FLIGHT_MS).toISOString()
      const { data: acts, error } = await supabase
        .from('lead_activities')
        .select('id, lead_id, created_at')
        .eq('created_by', repId)                                   // NOT user_id (§76)
        .eq('activity_type', 'call')
        .is('outcome', null)
        .gte('created_at', dayStart)
        .lt('created_at', beforeNow)
        .not('lead_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(40)
      if (error || !acts || acts.length === 0) { setItems([]); return }

      const leadIds = [...new Set(acts.map(a => a.lead_id))]
      const { data: leads } = await supabase
        .from('leads')
        .select('id, name, company, phone, stage')
        .in('id', leadIds)
      const leadMap = Object.fromEntries((leads || []).map(l => [l.id, l]))

      const list = acts
        .map(a => ({ activityId: a.id, created_at: a.created_at, lead: leadMap[a.lead_id] }))
        .filter(x => x.lead && !CLOSED_STAGES.includes(x.lead.stage))
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
