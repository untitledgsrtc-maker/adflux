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

  // Realtime — keep the panel fresh as tasks are completed elsewhere.
  // Phase 35 PR 2.3 — channel name was hardcoded `'lead-tasks-rt'`,
  // so under React StrictMode double-mount (dev) OR any remount during
  // a session (e.g. WorkV2 re-renders because of a session-state
  // update), the second `.on()` call ran against a channel that
  // Supabase's local registry treated as already-subscribed → threw
  // "cannot add postgres_changes callbacks after subscribe()" which
  // was uncaught and killed /work on mobile. Two fixes: (a) unique
  // channel name per effect mount, (b) try/catch so a realtime
  // wire-up failure can't take the page down.
  useEffect(() => {
    const channelName = `lead-tasks-rt-${Math.random().toString(36).slice(2, 10)}`
    let ch
    try {
      ch = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'lead_tasks' },
          () => { fetchTasks() }   // cheap re-fetch; volume is small
        )
        .subscribe()
    } catch (err) {
      // Realtime failed to wire — the panel still works via initial
      // fetch + explicit refresh calls; just no live update.
      // eslint-disable-next-line no-console
      console.warn('[useLeadTasks] realtime subscribe failed:', err?.message || err)
    }
    return () => {
      if (ch) {
        try { supabase.removeChannel(ch) } catch { /* ignore */ }
      }
    }
  }, [fetchTasks])

  const generate = useCallback(async () => {
    // Phase 34Z.10 — Phase 33T renamed the RPC arg from no-arg to
    // (p_user_id uuid). Calls without it 400 in production. Pass the
    // current user's id; RLS is SECURITY DEFINER inside the function.
    if (!userId) return { error: new Error('No user id') }
    setGenerating(true)
    const { data, error: err } = await supabase.rpc('generate_lead_tasks', {
      p_user_id: userId,
    })
    setGenerating(false)
    if (err) {
      console.error('[useLeadTasks] generate failed:', err)
      return { error: err }
    }
    await fetchTasks()
    return { data }   // integer = how many new rows inserted
  }, [fetchTasks, userId])

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
