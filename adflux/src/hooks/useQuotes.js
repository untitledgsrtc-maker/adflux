import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useQuoteStore } from '../store/quoteStore'
import { useAuthStore } from '../store/authStore'

// Generate a fresh quote number. Uses timestamp + random suffix to
// minimise collision risk; the DB has a UNIQUE constraint on
// quote_number so if we still collide we retry inside createQuote().
function generateQuoteNumber() {
  const year = new Date().getFullYear()
  const timestamp = Date.now().toString().slice(-6)
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `UA-${year}-${timestamp}${rand}`
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
    // Retry up to 4 times on duplicate quote_number collisions.
    // Postgres raises SQLSTATE 23505 for unique violation, which
    // PostgREST surfaces as { code: '23505' }.
    let quote = null
    let lastError = null

    for (let attempt = 0; attempt < 4; attempt++) {
      const payload = {
        ...quoteData,
        quote_number:      generateQuoteNumber(),
        created_by:        profile?.id,
        sales_person_name: profile?.name,
      }

      const { data, error } = await supabase
        .from('quotes')
        .insert([payload])
        .select()
        .single()

      if (!error) { quote = data; break }

      lastError = error
      // Only retry on unique-violation; bail on any other error.
      if (error.code !== '23505') return { error }
    }

    if (!quote) return { error: lastError }

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
