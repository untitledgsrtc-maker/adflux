// src/hooks/useLeads.js
//
// Phase 12 — fetches and mutates the leads pipeline.
//
// RLS does the heavy lifting: admin sees all, government_partner sees
// all GOVERNMENT segment, sales/agency see assigned_to=me, telecaller
// sees telecaller_id=me, sales_manager sees their direct reports.
// We just SELECT * and trust RLS.
//
// Joins: assigned_to → users.name as assigned_name; telecaller_id →
// users.name as telecaller_name. PostgREST embed syntax handles this
// cleanly.
//
// NOTE: We use a hook + local state, not Zustand, because the leads
// list is page-scoped (only QuotesV2 needed cross-page filter sync).
// Add a Zustand store later if filters need to persist across routes.

import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

// Phase 323 (audit H2) — REVERTED to `*`. The explicit column list named
// stage_changed_at (and handoff_sla_due_at), which exist in phase SQL FILES but
// were never run on the live DB → PostgREST 400'd the whole leads list. `*` is
// drift-proof (returns whatever columns exist, never 400s on a missing one).
// The notes/notes_legacy over-fetch is not worth risking the most-used sales
// list. Re-attempt the trim ONLY against a LIVE `information_schema.columns`
// check (SQL files ≠ live schema — the §234 foot-gun, now proven).
const SELECT_COLUMNS = `
  *,
  assigned:assigned_to (id, name, team_role, city),
  telecaller:telecaller_id (id, name, team_role)
`

export function useLeads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchLeads = useCallback(async (opts = {}) => {
    setLoading(true)
    setError(null)
    // Phase 247.2 — team viewer: load ALL reps' leads (READ-ONLY) via the gated
    // team_all_leads() RPC (her own-only RLS would return just hers). The RPC
    // returns the same shape as SELECT_COLUMNS (row + assigned/telecaller
    // nested), so every downstream memo/render is unchanged. Off unless opts.team.
    if (opts.team) {
      const { data, error: err } = await supabase.rpc('team_all_leads')
      if (err) { console.error('[useLeads] team fetch failed:', err); setError(err.message || 'Could not load team leads.'); setLeads([]) }
      else { setLeads(Array.isArray(data) ? data : []) }
      setLoading(false)
      return { data: Array.isArray(data) ? data : [], error: err }
    }
    // Phase 151 — paginate in 1000-row chunks. PostgREST caps a single
    // request at ~1000 rows, so the old single .select() silently returned
    // only the first 1000 leads: admin "All (1000)" was the CAP, not the
    // true total, and leads past 1000 couldn't be searched/filtered. Loop
    // .range until a short chunk signals the end → loads ALL leads the
    // rep's RLS allows. Reps (scoped under 1000) still do ONE round trip;
    // only admin with >1000 leads pays the extra request(s). Hard 20k cap.
    const CHUNK = 1000
    let all = []
    let offset = 0
    let lastErr = null
    for (;;) {
      const { data, error: err } = await supabase
        .from('leads')
        .select(SELECT_COLUMNS)
        .order('created_at', { ascending: false })
        .range(offset, offset + CHUNK - 1)
      if (err) { lastErr = err; break }
      all = all.concat(data || [])
      if (!data || data.length < CHUNK) break   // last (short) page
      offset += CHUNK
      if (offset >= 20000) break                // safety backstop
    }

    if (lastErr) {
      // Phase 12 — surface RLS / auth errors instead of silent empty.
      console.error('[useLeads] fetch failed:', lastErr)
      setError(lastErr.message || 'Could not load leads.')
      setLeads([])
    } else {
      setLeads(all)
    }
    setLoading(false)
    return { data: all, error: lastErr }
  }, [])

  const updateLead = useCallback(async (id, patch) => {
    const { data, error: err } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select(SELECT_COLUMNS)
      .single()

    if (err) {
      console.error('[useLeads] update failed:', err)
      return { error: err }
    }
    // Optimistic in-place replace; caller can refetch if needed.
    setLeads(prev => prev.map(l => l.id === id ? data : l))
    return { data }
  }, [])

  // Phase 100.B — RPC-backed bulk reassign. Drops the prior direct
  // UPDATE path (silently RLS-denied for non-admin even on their own
  // leads). Calls public.reassign_leads_bulk which enforces:
  //   • non-admin daily cap 5
  //   • non-admin bulk cap 20
  //   • lane-aware routing (TC vs sales column, Phase 99.C pattern)
  //   • cross-team reason gate (≥3 chars)
  //   • sales→TC stage gate (New/Working/Nurture only)
  //   • government_partner segment guard (W11)
  //   • Won/Lost block for non-admin
  // Returns {total, succeeded, failed, failures:[{lead_id,reason}]}.
  // Caller (LeadsV2) decides how to render partial-failure list.
  const reassignBulk = useCallback(async (ids, target_user_id, reason) => {
    if (!ids?.length) return { error: { message: 'No leads selected.' } }
    if (!target_user_id) return { error: { message: 'No target rep selected.' } }
    const { data, error: err } = await supabase.rpc('reassign_leads_bulk', {
      p_lead_ids:  ids,
      p_new_owner: target_user_id,
      p_reason:    reason || null,
    })
    if (err) {
      console.error('[useLeads] bulk reassign RPC failed:', err)
      return { error: err }
    }
    // Refetch so joined assignee names refresh (RPC only flips the
    // columns; PostgREST embed won't auto-update local cache).
    await fetchLeads()
    return { data }
  }, [fetchLeads])

  // Phase 31A.5 — bulk stage change. Owner sales-exec analysis (8 May 2026):
  // 'No bulk actions. Cannot select multiple leads to update stage'.
  // Same RLS path as single-row update. Skips Won/Lost guard rails
  // because admin uses this for cleanup; reps can move forward only.
  const stageBulk = useCallback(async (ids, stage, extra = {}) => {
    if (!ids?.length) return { error: { message: 'No leads selected.' } }
    const patch = { stage, ...extra }
    const { error: err } = await supabase
      .from('leads')
      .update(patch)
      .in('id', ids)
    if (err) {
      console.error('[useLeads] bulk stage change failed:', err)
      return { error: err }
    }
    await fetchLeads()
    return { data: { count: ids.length } }
  }, [fetchLeads])

  // Phase 31A.5 — bulk delete. Hard removes from DB. RLS will reject
  // anyone who isn't admin/co_owner OR doesn't own each row, so safe
  // to surface to all users — they just won't be able to nuke leads
  // they don't own.
  const deleteBulk = useCallback(async (ids) => {
    if (!ids?.length) return { error: { message: 'No leads selected.' } }
    const { error: err } = await supabase
      .from('leads')
      .delete()
      .in('id', ids)
    if (err) {
      console.error('[useLeads] bulk delete failed:', err)
      return { error: err }
    }
    await fetchLeads()
    return { data: { count: ids.length } }
  }, [fetchLeads])

  // Phase 19 — realtime change handler. Realtime payloads come without
  // joined assigned/telecaller objects, so on INSERT/UPDATE we re-fetch
  // the single row with joins. RLS still gates: a user who can't read
  // the row gets nothing back and the list isn't polluted.
  const applyRealtimeChange = useCallback(async (payload) => {
    const ev = payload?.eventType
    if (ev === 'DELETE') {
      const id = payload.old?.id
      if (id) setLeads(prev => prev.filter(l => l.id !== id))
      return
    }
    const id = payload?.new?.id
    if (!id) return
    const { data, error: err } = await supabase
      .from('leads')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (err || !data) return
    setLeads(prev => {
      const exists = prev.some(l => l.id === id)
      if (ev === 'INSERT' && !exists) return [data, ...prev]
      if (!exists) return [data, ...prev]   // UPDATE on row we hadn't seen
      return prev.map(l => l.id === id ? data : l)
    })
  }, [])

  return {
    leads,
    loading,
    error,
    fetchLeads,
    updateLead,
    reassignBulk,
    stageBulk,
    deleteBulk,
    applyRealtimeChange,
  }
}

// Stage-related metadata. Single source of truth so UI + future
// reports stay in sync. Order matters — funnel renders in this order.
//
// Phase 30A (7 May 2026) — collapsed from 10 stages to 5.
// Phase 31N (10 May 2026) — owner restored Nurture as a 6th stage.
// Reasoning: a lead post-QuoteSent who says "revisit next quarter" is
// a real long-tail signal that Phase 30A merged into Lost or Working,
// both wrong. Nurture lives BETWEEN QuoteSent and Won/Lost — quote is
// on the table, customer hasn't decided. Requires `revisit_date` so
// it doesn't sit forever. Pipeline reports treat Nurture as
// open-but-stalled (still counts toward forecast since the rep can
// reactivate when the revisit_date passes).
export const LEAD_STAGES = [
  'New', 'Working', 'QuoteSent', 'Nurture', 'Won', 'Lost',
]

// Phase 31N — Nurture rolled into its own group. Order matters here
// (drives the funnel column order on /leads).
// Phase 31P (10 May 2026) — owner directive: rename 'Working' label to
// 'Follow-up' in the UI. DB value stays 'Working' (no migration, no
// Edge Function changes, no breaking comparisons). The label is the
// only thing reps see.
export const STAGE_GROUPS = [
  { key: 'new',         label: 'New',         stages: ['New'] },
  { key: 'working',     label: 'Follow-up',   stages: ['Working'] },
  { key: 'quote_sent',  label: 'Quote Sent',  stages: ['QuoteSent'] },
  { key: 'nurture',     label: 'Nurture',     stages: ['Nurture'] },
  { key: 'won',         label: 'Won',         stages: ['Won'] },
  { key: 'lost',        label: 'Lost',        stages: ['Lost'] },
]


// Phase 31P — 'Working' DB value displays as 'Follow-up' to reps.
export const STAGE_LABELS = {
  New:       'New',
  Working:   'Follow-up',
  QuoteSent: 'Quote Sent',
  Nurture:   'Nurture',
  Won:       'Won',
  Lost:      'Lost',
}

// Maps stage → tint key from UI design system. Keep in sync with
// the chip variants in UI_DESIGN_SYSTEM.md §4.4.
// Phase 31N — QuoteSent is amber (warning tone — "in customer's court,
// awaiting decision"), Nurture is purple (parked / long-tail). The
// .stage-nurture CSS class survived the Phase 30A purge and already
// has the right styling — no leads.css edit needed.
export const STAGE_TINT = {
  New:       'blue',
  Working:   'amber',
  QuoteSent: 'amber',
  Nurture:   'purple',
  Won:       'green',
  Lost:      'red',
}

export const LOST_REASONS = [
  'Price', 'Timing', 'Competitor', 'NoNeed',
  'NoResponse', 'WrongContact', 'Stale',
]

// Phase 31A — capture the source of every Won lead so admin can spot
// which channel / referral path actually closes deals. CHECK constraint
// in supabase_phase31a_won_reason.sql enforces these exact values.
export const WON_REASONS = [
  { value: 'Referral',       label: 'Referral' },
  { value: 'ExistingClient', label: 'Existing client' },
  { value: 'ColdOutreach',   label: 'Cold outreach' },
  { value: 'Marketing',      label: 'Marketing / inbound' },
  { value: 'WalkIn',         label: 'Walk-in' },
  { value: 'Other',          label: 'Other' },
]

