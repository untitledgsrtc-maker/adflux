// src/hooks/useLeadTasks.js
//
// Phase 19 — Smart Task Engine. Reads today's open tasks for the
// signed-in user (RLS gates), and exposes generator/complete/snooze
// helpers. The /work page mounts a panel built on top of this.
//
// `today` defaults to the user's local IST date. We could compute
// server-side but client-side is fine for the panel — the SQL
// function defaults to Asia/Kolkata so generator and reader stay
// aligned.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SELECT_COLUMNS = `
  *,
  lead:lead_id (
    id, name, company, phone, stage, segment, heat,
    expected_value, last_contact_at, city
  )
`

function todayIST() {
  // YYYY-MM-DD in IST. Sunday → "2026-05-06" style.
  const d = new Date()
  const ist = new Date(d.getTime() + (5.5 * 60 * 60 * 1000))
  return ist.toISOString().slice(0, 10)
}

export function useLeadTasks({ userId } = {}) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [generating, setGenerating] = useState(false)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('lead_tasks')
      .select(SELECT_COLUMNS)
      .eq('status', 'open')
      .eq('generated_for', todayIST())
      .order('priority', { ascending: true })
      .order('due_at',   { ascending: true, nullsFirst: false })

    if (userId) q = q.eq('assigned_to', userId)

    const { data, error: err } = await q
    if (err) {
      console.error('[useLeadTasks] fetch failed:', err)
      setError(err.message || 'Could not load tasks.')
      setTasks([])
    } else {
      setTasks(data || [])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Realtime — keep the panel fresh as tasks are completed elsewhere
  useEffect(() => {
    const ch = supabase
      .channel('lead-tasks-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_tasks' },
        () => { fetchTasks() }   // cheap re-fetch; volume is small
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchTasks])

  const generate = useCallback(async () => {
    setGenerating(true)
    const { data, error: err } = await supabase.rpc('generate_lead_tasks')
    setGenerating(false)
    if (err) {
      console.error('[useLeadTasks] generate failed:', err)
      return { error: err }
    }
    await fetchTasks()
    return { data }   // integer = how many new rows inserted
  }, [fetchTasks])

  const complete = useCallback(async (taskId) => {
    const { error: err } = await supabase.rpc('complete_lead_task', {
      p_task_id: taskId,
    })
    if (err) {
      console.error('[useLeadTasks] complete failed:', err)
      return { error: err }
    }
    setTasks(prev => prev.filter(t => t.id !== taskId))
    return { ok: true }
  }, [])

  const snooze = useCallback(async (taskId) => {
    const tomorrow = (() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return d.toISOString().slice(0, 10)
    })()
    const { error: err } = await supabase
      .from('lead_tasks')
      .update({ status: 'snoozed', snoozed_until: tomorrow })
      .eq('id', taskId)
    if (err) {
      console.error('[useLeadTasks] snooze failed:', err)
      return { error: err }
    }
    setTasks(prev => prev.filter(t => t.id !== taskId))
    return { ok: true }
  }, [])

  const skip = useCallback(async (taskId) => {
    const { error: err } = await supabase
      .from('lead_tasks')
      .update({ status: 'skipped' })
      .eq('id', taskId)
    if (err) {
      console.error('[useLeadTasks] skip failed:', err)
      return { error: err }
    }
    setTasks(prev => prev.filter(t => t.id !== taskId))
    return { ok: true }
  }, [])

  return {
    tasks,
    loading,
    error,
    generating,
    fetchTasks,
    generate,
    complete,
    snooze,
    skip,
  }
}

export const TASK_KIND_LABEL = {
  sla_breach:         'SLA breach',
  follow_up_due:      'Follow-up due',
  hot_idle:           'Hot · idle',
  qualified_no_quote: 'Qualified · no quote',
  nurture_revisit:    'Nurture revisit',
  new_untouched:      'New · no contact',
}

export const TASK_KIND_TONE = {
  sla_breach:         'danger',
  follow_up_due:      'warn',
  hot_idle:           'warn',
  qualified_no_quote: 'warn',
  nurture_revisit:    'info',
  new_untouched:      'info',
}
