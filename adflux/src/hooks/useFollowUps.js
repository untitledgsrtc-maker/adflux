// src/hooks/useFollowUps.js
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { todayISO } from '../utils/formatters'
// Phase 96.0 (2026-05-27) — wire each mutation to keep the on-device
// AlarmManager alarm in sync with the DB row. Cancel on done,
// reschedule on update, schedule on create. Web no-op via guard.
import { scheduleFollowUpAlarm, cancelFollowUpAlarm } from '../utils/scheduleFollowUpAlarm'
import { confirmDialog } from '../components/v2/ConfirmDialog'
import { istTodayISO } from '../utils/istDate'

export function useFollowUps(quoteId = null) {
  const [followUps, setFollowUps] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const profile = useAuthStore(s => s.profile)

  // ─── Fetch follow-ups (scoped by quote or user) ───────────────────
  const fetchFollowUps = useCallback(async () => {
    setLoading(true)
    setError(null)

    let query = supabase
      .from('follow_ups')
      .select('*, quotes(quote_number, client_name, client_company, status)')
      .order('follow_up_date', { ascending: true })

    if (quoteId) {
      query = query.eq('quote_id', quoteId)
    } else if (profile?.role === 'sales' || profile?.role === 'agency') {
      // Phase 31W — was 'sales' only; agency is sales-equivalent per
      // Phase 11g (CLAUDE.md §8). Without this, agency users hit the
      // admin path and see all follow-ups, not just their own. Now
      // matches fetchDue's rule below — single source of truth for
      // the sales-like check.
      query = query.eq('assigned_to', profile.id)
    }
    // admin / co_owner / sales_manager with no quoteId = all follow-ups

    const { data, error: err } = await query
    if (err) setError(err.message)
    else setFollowUps(data || [])

    setLoading(false)
    return { data: data || [], error: err }
  }, [quoteId, profile?.id, profile?.role])

  // ─── Due today / overdue (used for banners) ───────────────────────
  const fetchDue = useCallback(async () => {
    setLoading(true)
    const today = todayISO()

    let query = supabase
      .from('follow_ups')
      .select('*, quotes(quote_number, client_name, client_company, status)')
      .lte('follow_up_date', today)
      .eq('is_done', false)
      .order('follow_up_date', { ascending: true })

    // Phase 11g — agency role behaves like sales here too.
    if (profile?.role === 'sales' || profile?.role === 'agency') {
      query = query.eq('assigned_to', profile.id)
    }

    const { data, error: err } = await query
    setLoading(false)
    return { data: data || [], error: err }
  }, [profile?.id, profile?.role])

  // ─── Mark done ────────────────────────────────────────────────────
  const markDone = async (id) => {
    // Phase 128 — same gate as FollowUpsV2.markDone: a follow-up can only be
    // closed by hand if the rep actually called the lead today (a call attempt
    // counts — even no-answer). Blocks "clearing" a follow-up without doing the
    // work. The auto-close after a real call (PostCallOutcomeModal) is a
    // different path and stays untouched. lead_id-less rows (no lead to verify)
    // skip the gate.
    const leadId = followUps.find(f => f.id === id)?.lead_id || null
    if (leadId) {
      const { data: calls } = await supabase
        .from('call_logs')
        .select('id')
        .eq('user_id', profile?.id)
        .eq('lead_id', leadId)
        .gte('call_at', istTodayISO() + 'T00:00:00+05:30')
        .limit(1)
      if (!calls || calls.length === 0) {
        await confirmDialog({
          title: 'Call them first',
          message: 'Call this lead first — then you can mark the follow-up done.',
          confirmLabel: 'OK',
        })
        return { data: null, error: null }
      }
    }
    const { data, error: err } = await supabase
      .from('follow_ups')
      .update({ is_done: true, done_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, quotes(quote_number, client_name, client_company, status)')
      .single()

    if (!err) {
      setFollowUps(prev => prev.map(f => f.id === id ? data : f))
      // Phase 96.0 — cancel the AlarmManager schedule so the stale
      // reminder doesn't fire tomorrow morning. Fire-and-forget.
      cancelFollowUpAlarm(id).catch(() => {})
    }
    return { data, error: err }
  }

  // ─── Reschedule ───────────────────────────────────────────────────
  const reschedule = async (id, newDate, note) => {
    const { data, error: err } = await supabase
      .from('follow_ups')
      .update({
        follow_up_date: newDate,
        note: note || null,
        is_done: false,
        done_at: null,
      })
      .eq('id', id)
      .select('*, quotes(quote_number, client_name, client_company, status)')
      .single()

    if (!err) {
      // Phase 95.8 defensive unwrap — FK embed + RLS combo can return
      // wrapped array on Capacitor APK. .single() works on web but
      // the safer pattern is to read the row defensively.
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        setFollowUps(prev => prev.map(f => f.id === id ? row : f))
        // Phase 96.0 — replace the on-device alarm. scheduleFollowUpAlarm
        // is cancel-then-schedule so the old time is dropped and the
        // new time is armed in one call.
        scheduleFollowUpAlarm({
          id:             row.id,
          lead_id:        row.lead_id,
          lead_name:      row?.quotes?.client_name || 'Lead',
          follow_up_date: row.follow_up_date,
          follow_up_time: row.follow_up_time || null,
          note:           row.note,
        }).catch(() => {})
      }
    }
    return { data, error: err }
  }

  // ─── Create manual follow-up ──────────────────────────────────────
  const createFollowUp = async ({ quote_id, assigned_to, follow_up_date, note }) => {
    const { data, error: err } = await supabase
      .from('follow_ups')
      .insert([{
        quote_id,
        assigned_to: assigned_to || profile?.id,
        follow_up_date,
        note: note || null,
        is_done: false,
      }])
      .select('*, quotes(quote_number, client_name, client_company, status)')
      .single()

    if (!err) {
      const row = Array.isArray(data) ? data[0] : data
      if (row) {
        setFollowUps(prev => [row, ...prev])
        // Phase 96.0 — schedule on-device alarm. Helper handles
        // past-date skip + native-only guard internally.
        scheduleFollowUpAlarm({
          id:             row.id,
          lead_id:        row.lead_id,
          lead_name:      row?.quotes?.client_name || 'Lead',
          follow_up_date: row.follow_up_date,
          follow_up_time: row.follow_up_time || null,
          note:           row.note,
        }).catch(() => {})
      }
    }
    return { data, error: err }
  }

  // ─── Derived ──────────────────────────────────────────────────────
  const today = todayISO()
  const overdueCount = followUps.filter(
    f => !f.is_done && f.follow_up_date < today
  ).length
  const dueTodayCount = followUps.filter(
    f => !f.is_done && f.follow_up_date === today
  ).length

  return {
    followUps,
    loading,
    error,
    overdueCount,
    dueTodayCount,
    fetchFollowUps,
    fetchDue,
    markDone,
    reschedule,
    createFollowUp,
  }
}
