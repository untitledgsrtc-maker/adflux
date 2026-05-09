// src/hooks/useFollowUps.js
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { todayISO } from '../utils/formatters'

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
    const { data, error: err } = await supabase
      .from('follow_ups')
      .update({ is_done: true, done_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, quotes(quote_number, client_name, client_company, status)')
      .single()

    if (!err) {
      setFollowUps(prev => prev.map(f => f.id === id ? data : f))
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
      setFollowUps(prev => prev.map(f => f.id === id ? data : f))
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
      setFollowUps(prev => [data, ...prev])
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
