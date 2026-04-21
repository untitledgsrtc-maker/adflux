import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useQuoteStore } from '../store/quoteStore'
import { useAuthStore } from '../store/authStore'

// Generate quote number client-side as fallback
async function generateQuoteNumber() {
  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('quotes')
    .select('*', { count: 'exact', head: true })
  const seq = String((count || 0) + 1).padStart(4, '0')
  return `UA-${year}-${seq}`
}

export function useQuotes() {
  const store   = useQuoteStore()
  const profile = useAuthStore(s => s.profile)

  const fetchQuotes = useCallback(async () => {
    let query = supabase
      .from('quotes')
      .select('*, quote_cities(*)')
      .order('created_at', { ascending: false })

    if (profile?.role === 'sales') {
      query = query.eq('created_by', profile.id)
    }

    const { filters } = store
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.search) {
      query = query.or(
        `client_name.ilike.%${filters.search}%,client_company.ilike.%${filters.search}%,quote_number.ilike.%${filters.search}%`
      )
    }
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
    if (filters.dateTo)   query = query.lte('created_at', filters.dateTo + 'T23:59:59')

    const { data, error } = await query
    if (!error) store.setQuotes(data || [])
    return { data, error }
  }, [profile?.id, store.filters])

  const fetchQuoteById = async (id) => {
    const { data, error } = await supabase
      .from('quotes')
      .select('*, quote_cities(*)')
      .eq('id', id)
      .single()
    if (!error) store.setCurrentQuote(data)
    return { data, error }
  }

  const createQuote = async (quoteData, cities) => {
    // Generate a unique quote number to avoid duplicate key errors
    const year = new Date().getFullYear()
    const timestamp = Date.now().toString().slice(-6)
    const quoteNumber = `UA-${year}-${timestamp}`

    const payload = {
      ...quoteData,
      quote_number:      quoteNumber,
      created_by:        profile?.id,
      sales_person_name: profile?.name,
    }

    const { data: quote, error } = await supabase
      .from('quotes')
      .insert([payload])
      .select()
      .single()

    if (error) return { error }

    if (cities?.length) {
      const cityRows = cities.map(c => ({ ...c, quote_id: quote.id }))
      const { error: citiesError } = await supabase.from('quote_cities').insert(cityRows)
      if (citiesError) return { error: citiesError }
    }

    store.upsertQuote(quote)
    return { data: quote }
  }

  const updateQuote = async (id, updates) => {
    const { data, error } = await supabase
      .from('quotes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (!error) store.upsertQuote(data)
    return { data, error }
  }

  const updateQuoteStatus = async (id, status, additionalUpdates = {}) => {
    const { data, error } = await supabase
      .from('quotes')
      .update({ status, ...additionalUpdates })
      .eq('id', id)
      .select()
      .single()
    if (!error) store.upsertQuote(data)
    return { data, error }
  }

  const deleteQuote = async (id) => {
    const { error } = await supabase.from('quotes').delete().eq('id', id)
    if (!error) store.removeQuote(id)
    return { error }
  }

  return {
    ...store,
    fetchQuotes,
    fetchQuoteById,
    createQuote,
    updateQuote,
    updateQuoteStatus,
    deleteQuote,
  }
}
