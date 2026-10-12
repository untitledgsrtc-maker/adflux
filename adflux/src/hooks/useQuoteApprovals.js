// src/hooks/useQuoteApprovals.js
//
// Phase 360 — the price-approval rows of ONE quote (newest first), kept fresh
// by a realtime channel + a refetch when the app comes back to the foreground.
// Reads are scoped by RLS (qpa_owner_read / qpa_sales_head_read / qpa_admin_all).
// The rule itself lives in utils/quotePriceGate.js (mirror of the SQL).
//
// Callers must NOT treat "no rows yet" as "no approvals": `loading` is true
// until the rows for THIS quote id have been read once (so the first render
// after the quote loads is never mistaken for "nothing approved"), and `error`
// is set when the read failed (the screen shows a retry, it does not guess).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const COLS = 'id, quote_id, requested_by, min_rate, floor_rate, line_rates, status, decided_by, decided_at, decision_note, created_at'

export function useQuoteApprovals(quoteId) {
  const [approvals, setApprovals] = useState([])
  const [loadedId, setLoadedId] = useState(null)   // the quote id the rows belong to
  const [error, setError] = useState(null)
  const idRef = useRef(quoteId)
  idRef.current = quoteId

  const reload = useCallback(async () => {
    const id = quoteId
    if (!id) { setApprovals([]); setError(null); return [] }
    const { data, error: err } = await supabase
      .from('quote_price_approvals')
      .select(COLS)
      .eq('quote_id', id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (idRef.current !== id) return []        // the page moved to another quote meanwhile
    if (err) {
      setError(err)
      setLoadedId(id)
      return []
    }
    setError(null)
    setApprovals(data || [])
    setLoadedId(id)
    return data || []
  }, [quoteId])

  useEffect(() => {
    let cancelled = false
    if (!quoteId) { setApprovals([]); setError(null); return undefined }
    setApprovals([])                            // never show another quote's rows
    reload().catch(() => {})

    const onVisible = () => { if (!cancelled && document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)

    let channel = null
    try {
      channel = supabase
        .channel(`qpa-${quoteId}-${Math.random().toString(36).slice(2, 7)}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'quote_price_approvals', filter: `quote_id=eq.${quoteId}` },
          () => { if (!cancelled) reload() })
        .subscribe()
    } catch { /* realtime unavailable - the visibility refetch still works */ }

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) { try { supabase.removeChannel(channel) } catch { /* ignore */ } }
    }
  }, [quoteId, reload])

  const loading = quoteId ? loadedId !== quoteId : false
  return { approvals, loading, error, reload }
}
