// src/hooks/useCheckinStatus.js
//
// Phase 60 (19 May 2026) — read today's check-in row from Supabase.
//
// What this hook does:
//   - Calls public.is_checked_in_today() RPC (server-side IST clock).
//   - Returns { loading, checkedIn, status, lateMinutes, name, isWorkday,
//     checkInAt, error, refetch }.
//   - Polls on tab focus so the gate updates after a successful
//     swipe without a full page reload.
//
// Used by:
//   - CheckInGate — to decide whether to redirect to /check-in.
//   - CheckInV2   — to render the live status chip.
//
// IMPORTANT: server clock wins. We never compute IST locally here
// because devices in dead-zones / wrong-tz can lie. The RPC uses
// timezone 'Asia/Kolkata' on the Postgres side.

import { useEffect, useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useCheckinStatus(userId) {
  const [state, setState] = useState({
    loading:      true,
    checkedIn:    false,
    status:       null,        // 'on_time' | 'late' | 'half_day' | 'absent' | null
    lateMinutes:  null,
    name:         null,
    isWorkday:    false,
    checkInAt:    null,
    error:        null,
  })

  const load = useCallback(async () => {
    if (!userId) {
      setState((s) => ({ ...s, loading: false }))
      return
    }
    try {
      const { data, error } = await supabase.rpc('is_checked_in_today')
      if (error) throw error
      setState({
        loading:     false,
        checkedIn:   data?.checked_in === true,
        status:      data?.status || null,
        lateMinutes: data?.late_minutes ?? null,
        name:        data?.name || null,
        isWorkday:   data?.is_workday === true,
        checkInAt:   data?.check_in_at || null,
        error:       null,
      })
    } catch (e) {
      // Defensive: if the RPC errors (network, RLS, missing function),
      // do NOT lock the rep out of the app. Surface error in state
      // and let the gate fall back to "render children" so they can
      // still use /work.
      setState((s) => ({
        ...s,
        loading: false,
        error:   e?.message || 'rpc failed',
      }))
    }
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  // Refresh when the tab regains focus — picks up a successful check-in
  // from another tab/session, or the morning of the next workday.
  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') load()
    })
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return { ...state, refetch: load }
}
