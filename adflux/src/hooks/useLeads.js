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

const SELECT_COLUMNS = `
  *,
  assigned:assigned_to (id, name, team_role, city),
  telecaller:telecaller_id (id, name, team_role)
`

export function useLeads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('leads')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: false })

    if (err) {
      // Phase 12 — surface RLS / auth errors instead of silent empty.
      console.error('[useLeads] fetch failed:', err)
      setError(err.message || 'Could not load leads.')
      setLeads([])
    } else {
      setLeads(data || [])
    }
    setLoading(false)
    return { data, error: err }
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

  const reassignBulk = useCallback(async (ids, assignedTo) => {
    if (!ids?.length) return { error: { message: 'No leads selected.' } }
    const { error: err } = await supabase
      .from('leads')
      .update({ assigned_to: assignedTo })
      .in('id', ids)

    if (err) {
      console.error('[useLeads] bulk reassign failed:', err)
      return { error: err }
    }
    // Cheap path: refetch to pull joined assignee names.
    await fetchLeads()
    return { data: { count: ids.length } }
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
// Phase 30A (7 May 2026) — collapsed from 10 stages to 5. Owner spec:
// "10 is too many, reps will misuse half". The dropped stages
// (Contacted, Qualified, SalesReady, MeetingScheduled, Negotiating,
// Nurture) all map into one of the 5 below by SQL migration. See
// supabase_phase30a_lead_stages_collapse.sql. Long-tail revisits live
// on the existing leads.nurture_revisit_date column on Lost rows.
export const LEAD_STAGES = [
  'New', 'Working', 'QuoteSent', 'Won', 'Lost',
]

// Phase 30A — STAGE_GROUPS used to roll 10 stages into 6 display
// buckets. With only 5 underlying stages, the buckets ARE the stages.
// Each group still maps to a single stage so existing
// `STAGE_GROUPS.find(g => g.stages.includes(stage))` consumers keep
// working without refactor.
export const STAGE_GROUPS = [
  { key: 'new',         label: 'New',         stages: ['New'] },
  { key: 'working',     label: 'Working',     stages: ['Working'] },
  { key: 'quote_sent',  label: 'Quote Sent',  stages: ['QuoteSent'] },
  { key: 'won',         label: 'Won',         stages: ['Won'] },
  { key: 'lost',        label: 'Lost',        stages: ['Lost'] },
]

export function groupForStage(stage) {
  return STAGE_GROUPS.find(g => g.stages.includes(stage))?.key || 'new'
}

export const STAGE_LABELS = {
  New:       'New',
  Working:   'Working',
  QuoteSent: 'Quote Sent',
  Won:       'Won',
  Lost:      'Lost',
}

// Maps stage → tint key from UI design system. Keep in sync with
// the chip variants in UI_DESIGN_SYSTEM.md §4.4.
export const STAGE_TINT = {
  New:       'blue',
  Working:   'amber',
  QuoteSent: 'purple',
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

export const HEAT_OPTIONS = ['hot', 'warm', 'cold']
