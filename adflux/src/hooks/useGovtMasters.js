// src/hooks/useGovtMasters.js
//
// Centralised data fetch for the Government wizard's master tables:
//   - auto_districts (33 rows, share_pct)
//   - gsrtc_stations (20 rows, screens / category / rates)
//   - auto_rate_master (active DAVP rate row, ₹825 default)
//   - users with signing_authority (signer dropdown)
//
// All four are small, rarely-changing reference data — fetched once
// per wizard session and held in component state. We don't bother
// with a global zustand store for them; over-engineered for this
// scale. If a wizard re-mounts the user gets a fresh fetch which is
// the right behavior (any admin edit on the master page reflects
// immediately the next time someone opens the wizard).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAutoMasters() {
  const [districts,    setDistricts]    = useState([])
  const [rate,         setRate]         = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)

  useEffect(() => {
    let cancel = false
    const load = async () => {
      const [d, r] = await Promise.all([
        supabase.from('auto_districts')
          .select('id, serial_no, district_name_en, district_name_gu, share_pct, is_active')
          .eq('is_active', true)
          .order('serial_no'),
        supabase.from('auto_rate_master')
          .select('*')
          .is('effective_to', null)
          .order('effective_from', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (cancel) return
      if (d.error || r.error) {
        setError(d.error || r.error)
      } else {
        setDistricts(d.data || [])
        setRate(r.data || null)
      }
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [])

  return { districts, rate, loading, error }
}

export function useGsrtcStations() {
  const [stations, setStations] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    let cancel = false
    supabase.from('gsrtc_stations')
      .select('id, serial_no, station_name_en, station_name_gu, category, screens_count, monthly_spots, davp_per_slot_rate, is_active')
      .eq('is_active', true)
      .order('serial_no')
      .then(({ data, error }) => {
        if (cancel) return
        if (error) setError(error)
        else setStations(data || [])
        setLoading(false)
      })
    return () => { cancel = true }
  }, [])

  return { stations, loading, error }
}

export function useSigners() {
  const [signers, setSigners] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancel = false
    supabase.from('users')
      .select('id, name, email, role, signature_title, signature_mobile')
      .eq('signing_authority', true)
      .eq('is_active', true)
      .order('role')
      .order('name')
      .then(({ data, error }) => {
        if (cancel) return
        if (error) setError(error)
        else setSigners(data || [])
        setLoading(false)
      })
    return () => { cancel = true }
  }, [])

  return { signers, loading, error }
}
