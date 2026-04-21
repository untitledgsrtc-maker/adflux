import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useIncentiveStore } from '../store/incentiveStore'

export function useIncentive() {
  const store = useIncentiveStore()

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase.from('incentive_settings').select('*').single()
    if (data) store.setSettings(data)
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
