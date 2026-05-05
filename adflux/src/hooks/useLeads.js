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

  return {
    leads,
    loading,
    error,
    fetchLeads,
    updateLead,
    reassignBulk,
  }
}

// Stage-related metadata. Single source of truth so UI + future
// reports stay in sync. Order matters — funnel renders in this order.
export const LEAD_STAGES = [
  'New', 'Contacted', 'Qualified', 'SalesReady', 'MeetingScheduled',
  'QuoteSent', 'Negotiating', 'Won', 'Lost', 'Nurture',
]

// Phase 12 (rev2) — owner feedback: 11 tabs is too many. Group stages
// into 6 logical buckets for the UI tab row. Underlying schema keeps
// all 10 stages — this is purely a display roll-up. The actual stage
// transition modal still exposes every individual stage.
export const STAGE_GROUPS = [
  {
    key:    'open',
    label:  'Open',
    stages: ['New', 'Contacted', 'Nurture'],
  },
  {
    key:    'qualified',
    label:  'Qualified',
    stages: ['Qualified', 'SalesReady', 'MeetingScheduled'],
  },
  {
    key:    'in_progress',
    label:  'In Progress',
    stages: ['QuoteSent', 'Negotiating'],
  },
  {
    key:    'won',
    label:  'Won',
    stages: ['Won'],
  },
  {
    key:    'lost',
    label:  'Lost',
    stages: ['Lost'],
  },
]

export function groupForStage(stage) {
  return STAGE_GROUPS.find(g => g.stages.includes(stage))?.key || 'open'
}

export const STAGE_LABELS = {
  New:              'New',
  Contacted:        'Contacted',
  Qualified:        'Qualified',
  SalesReady:       'Sales Ready',
  MeetingScheduled: 'Meeting',
  QuoteSent:        'Quote Sent',
  Negotiating:      'Negotiating',
  Won:              'Won',
  Lost:             'Lost',
  Nurture:          'Nurture',
}

// Maps stage → tint key from UI design system. Keep in sync with
// the chip variants in UI_DESIGN_SYSTEM.md §4.4.
export const STAGE_TINT = {
  New:              'blue',
  Contacted:        'blue',
  Qualified:        'amber',
  SalesReady:       'purple',
  MeetingScheduled: 'amber',
  QuoteSent:        'amber',
  Negotiating:      'amber',
  Won:              'green',
  Lost:             'red',
  Nurture:          'blue',
}

export const LOST_REASONS = [
  'Price', 'Timing', 'Competitor', 'NoNeed',
  'NoResponse', 'WrongContact', 'Stale',
]

export const HEAT_OPTIONS = ['hot', 'warm', 'cold']
