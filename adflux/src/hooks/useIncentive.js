import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useIncentiveStore } from '../store/incentiveStore'

export function useIncentive() {
  const store = useIncentiveStore()

  const fetchSettings = useCallback(async () => {
    // Use maybeSingle() — returns null (not error) if 0 rows.
    // If we still somehow get 0 rows, seed one so the UI doesn't
    // get stuck on "Loading settings…".
    let { data, error } = await supabase
      .from('incentive_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('fetchSettings error:', error.message)
      return null
    }

    if (!data) {
      // Self-heal: insert a default row so the admin can edit it.
      const { data: seeded, error: seedErr } = await supabase
        .from('incentive_settings')
        .insert([{
          default_multiplier: 5,
          new_client_rate: 0.05,
          renewal_rate: 0.02,
          default_flat_bonus: 10000,
        }])
        .select()
        .single()
      if (seedErr) {
        console.warn('fetchSettings seed failed:', seedErr.message)
        return null
      }
      data = seeded
    }

    store.setSettings(data)
    return data
  }, [])

  const updateSettings = async (updates) => {
    const { data, error } = await supabase
      .from('incentive_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', store.settings?.id)
      .select().single()
    if (!error) store.setSettings(data)
    return { data, error }
  }

  const fetchProfiles = useCallback(async () => {
    const { data, error } = await supabase
      .from('staff_incentive_profiles')
      .select('*, users(id, name, email, role, is_active)')
    if (!error) store.setProfiles(data || [])
    return { data, error }
  }, [])

  const fetchProfileForUser = async (userId) => {
    const { data, error } = await supabase
      .from('staff_incentive_profiles')
      .select('*')
      .eq('user_id', userId)
      .single()
    return { data, error }
  }

  const updateProfile = async (profileId, updates) => {
    const { data, error } = await supabase
      .from('staff_incentive_profiles')
      .update(updates)
      .eq('id', profileId)
      .select('*, users(id, name, email, role, is_active)')
      .single()
    if (!error) store.upsertProfile(data)
    return { data, error }
  }

  const fetchMonthlySales = useCallback(async (staffId, months = 12) => {
    let query = supabase
      .from('monthly_sales_data')
      .select('*')
      .order('month_year', { ascending: false })
      .limit(months)
    if (staffId) query = query.eq('staff_id', staffId)
    const { data, error } = await query
    if (!error) store.setMonthlySales(data || [])
    return { data, error }
  }, [])

  return { ...store, fetchSettings, updateSettings, fetchProfiles, fetchProfileForUser, updateProfile, fetchMonthlySales }
}
