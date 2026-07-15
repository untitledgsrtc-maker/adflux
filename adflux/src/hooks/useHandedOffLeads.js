// src/hooks/useHandedOffLeads.js
//
// Phase 100.E — the leads THIS rep handed off (reassigned to someone else) +
// whether they're being worked. Reads the secured `my_handed_off_leads` RPC
// (SECURITY DEFINER, scoped to the caller's own reassign_audit rows). Lets a
// sales rep keep sight of a lead after they pass it to a telecaller — RLS
// otherwise hides it once they no longer own it.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export default function useHandedOffLeads(refreshKey = 0) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('my_handed_off_leads')
      setItems(error || !Array.isArray(data) ? [] : data)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, refreshKey])

  useEffect(() => {
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  const waiting = items.filter(i => !i.contacted_since)
  return { items, waiting, workedCount: items.length - waiting.length, loading, refresh: load }
}
