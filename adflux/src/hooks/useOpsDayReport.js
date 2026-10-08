// src/hooks/useOpsDayReport.js
//
// Data hook for the operations EVENING REPORT cards.
//   useOpsDayReport('exec') -> supabase.rpc('ops_my_day_report')    (technician)
//   useOpsDayReport('head') -> supabase.rpc('ops_head_day_report')  (head / admin)
//
// Returns { data, loading, error, denied, refetch }.
//   data     the last good report object (ok:true). KEPT while a refetch runs
//            or fails (stale-while-revalidate) so the card never flashes empty.
//   loading  true only while there is NO data yet (first load / retry after an
//            error). A background refetch never sets it.
//   error    message string when the last call failed ('' otherwise).
//   denied   the RPC answered, but without ok:true (the server returns '{}' for
//            a caller that may not see this report, fail-closed). Calm empty
//            state in the UI - not an error.
//   refetch  () => Promise, explicit re-run (Retry button).
//
// Refresh: on mount, on window focus / tab becoming visible (min 1.5s apart so
// the two events do not double-fire), and every 5 minutes while visible.
// Own timer on purpose - useAutoRefresh is a frozen sales hook (CLAUDE.md 28).
// The day boundary needs no special handling: the RPC defaults to today (IST)
// on the server, so the next poll after midnight returns the new day.
//
// READ-ONLY: this never writes anything.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const RPC_BY_KIND = { exec: 'ops_my_day_report', head: 'ops_head_day_report' }
const POLL_MS = 5 * 60 * 1000
const MIN_EVENT_GAP_MS = 1500

// Pure: turn a supabase { data, error } into one of three outcomes. Exported so
// the contract ("no ok:true => denied") is unit-testable without React.
export function interpretReportResult(res) {
  const err = res && res.error
  if (err) return { status: 'error', message: (err && err.message) || 'failed' }
  const d = res && res.data
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.ok !== true) return { status: 'denied' }
  return { status: 'ok', data: d }
}

export function useOpsDayReport(kind = 'exec') {
  const fn = RPC_BY_KIND[kind] || RPC_BY_KIND.exec
  const [state, setState] = useState({ data: null, loading: true, error: '', denied: false })
  const seqRef = useRef(0)          // latest request wins
  const aliveRef = useRef(true)
  const hasDataRef = useRef(false)
  const settledRef = useRef(false)  // true once the first answer (any kind) is in
  const lastRunRef = useRef(0)
  const ctrlRef = useRef(null)

  // manual = the Retry button. Only the first load and a manual retry show the
  // loading state; the silent focus / 5-minute refreshes never flash a skeleton
  // over a denied / error state.
  const run = useCallback(async (manual = false) => {
    lastRunRef.current = Date.now()
    const seq = ++seqRef.current
    try { if (ctrlRef.current) ctrlRef.current.abort() } catch { /* ignore */ }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    ctrlRef.current = ctrl
    if (!hasDataRef.current && (manual || !settledRef.current)) setState(s => (s.loading ? s : { ...s, loading: true }))

    let res
    try {
      let q = supabase.rpc(fn)
      if (ctrl && q && typeof q.abortSignal === 'function') q = q.abortSignal(ctrl.signal)
      res = await q
    } catch (e) {
      res = { data: null, error: { message: (e && e.message) || 'failed' } }
    }
    // Unmounted, or a newer request started (this one was aborted/superseded).
    if (!aliveRef.current || seq !== seqRef.current) return

    settledRef.current = true
    const r = interpretReportResult(res)
    if (r.status === 'ok') {
      hasDataRef.current = true
      setState({ data: r.data, loading: false, error: '', denied: false })
    } else if (r.status === 'denied') {
      hasDataRef.current = false
      setState({ data: null, loading: false, error: '', denied: true })
    } else {
      // Keep whatever we already had; just record the failure.
      setState(s => ({ ...s, loading: false, error: r.message }))
    }
  }, [fn])

  useEffect(() => {
    aliveRef.current = true
    hasDataRef.current = false
    settledRef.current = false
    run()

    const onEvent = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRunRef.current < MIN_EVENT_GAP_MS) return
      run()
    }
    document.addEventListener('visibilitychange', onEvent)
    window.addEventListener('focus', onEvent)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, POLL_MS)

    return () => {
      aliveRef.current = false
      seqRef.current += 1            // invalidate anything in flight
      try { if (ctrlRef.current) ctrlRef.current.abort() } catch { /* ignore */ }
      document.removeEventListener('visibilitychange', onEvent)
      window.removeEventListener('focus', onEvent)
      clearInterval(timer)
    }
  }, [run])

  const refetch = useCallback(() => run(true), [run])

  return { data: state.data, loading: state.loading, error: state.error, denied: state.denied, refetch }
}

export default useOpsDayReport
