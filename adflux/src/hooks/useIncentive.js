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

  // Phase 328 — optional 3rd argument; every existing 2-argument call
  // (StaffModal is the only caller today) behaves exactly as before.
  //   opts.expectedSalary: when given AND `updates` contains monthly_salary,
  //   the write only lands if the stored salary still equals that value. This
  //   stops a stale open window from overwriting a salary that was changed
  //   somewhere else (People tab, another admin) after the window loaded.
  const updateProfile = async (profileId, updates, opts = {}) => {
    const guardSalary =
      opts.expectedSalary !== undefined &&
      Object.prototype.hasOwnProperty.call(updates, 'monthly_salary')

    let query = supabase
      .from('staff_incentive_profiles')
      .update(updates)
      .eq('id', profileId)
    if (guardSalary) {
      query = opts.expectedSalary === null
        ? query.is('monthly_salary', null)
        : query.eq('monthly_salary', opts.expectedSalary)
    }
    const { data, error } = await query
      .select('*, users(id, name, email, role, is_active)')
      .single()

    // 0 rows matched the guard (PGRST116) = the salary moved, or the write
    // was not permitted. Say so in plain words; nothing was changed.
    if (guardSalary && error && error.code === 'PGRST116') {
      return {
        data: null,
        error: new Error('Nothing was saved: this salary was changed somewhere else after you opened the window (or you are not allowed to edit it). Close this window, reopen it and check the current salary.'),
      }
    }
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
