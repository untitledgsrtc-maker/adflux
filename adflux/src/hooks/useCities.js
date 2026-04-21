import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useCityStore } from '../store/cityStore'

export function useCities() {
  const store = useCityStore()

  const fetchCities = useCallback(async (includeInactive = false) => {
    let query = supabase
      .from('cities')
      .select('*')
      .order('name', { ascending: true })

    if (!includeInactive) query = query.eq('is_active', true)

    const { data, error } = await query
    if (!error) store.setCities(data || [])
    return { data, error }
  }, [])

  const createCity = async (cityData) => {
    const { data, error } = await supabase
      .from('cities')
      .insert([cityData])
      .select()
      .single()
    if (!error) store.upsertCity(data)
    return { data, error }
  }

  const updateCity = async (id, updates) => {
    const { data, error } = await supabase
      .from('cities')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error) store.upsertCity(data)
    return { data, error }
  }

  const deleteCity = async (id) => {
    // Soft delete
    const { data, error } = await supabase
      .from('cities')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single()
    if (!error) store.upsertCity(data)
    return { data, error }
  }

  const bulkUpdateRates = async (ids, rateField, value) => {
    const { data, error } = await supabase
      .from('cities')
      .update({ [rateField]: value })
      .in('id', ids)
      .select()
    if (!error) data.forEach(c => store.upsertCity(c))
    return { data, error }
  }

  return {
    ...store,
    activeCities: store.cities.filter(c => c.is_active),
    fetchCities,
    createCity,
    updateCity,
    deleteCity,
    bulkUpdateRates,
  }
}
