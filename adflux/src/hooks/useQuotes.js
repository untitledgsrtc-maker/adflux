import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useQuoteStore } from '../store/quoteStore'
import { useAuthStore } from '../store/authStore'
import { syncClientFromQuote } from '../utils/syncClient'

// Generate a fresh quote number. Uses full millisecond timestamp + a
// 5-digit random suffix so two near-simultaneous submits (including
// accidental double-clicks on "Send to Client") cannot produce the
// same number. The DB has a UNIQUE constraint on quote_number and
// createQuote() retries up to 4 times on a 23505 violation — with
// this much entropy the retry is effectively never needed.
//
// Suffix layout: UA-YYYY-<8 digits of Date.now()><5-digit random>
//   → ~10^13 distinct values per year
function generateQuoteNumber() {
  const year = new Date().getFullYear()
  const timestamp = Date.now().toString().slice(-8)
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `UA-${year}-${timestamp}${rand}`
}

export function useQuotes() {
  const store   = useQuoteStore()
  const profile = useAuthStore(s => s.profile)

  const fetchQuotes = useCallback(async () => {
    // `payments(...)` pulls approved payments alongside each quote so the
    // Quotes list can render an Outstanding column without a second round-trip.
    // The filter on approval_status lives in the caller (QuoteTable), not here,
    // because PostgREST nested filters would drop quotes with zero payments.
    // follow_ups(...) embeds every follow-up row for the quote so the
    // list can compute the next-pending date inline. The denormalized
    // quotes.follow_up_date column was never being populated (no sync
    // trigger), so the Follow Up column always rendered "—". Reading
    // from the source-of-truth follow_ups table instead is correct AND
    // keeps the UI accurate when a follow-up is marked done / added.
    let query = supabase
      .from('quotes')
      .select('*, quote_cities(*), payments(amount_received, approval_status), follow_ups(follow_up_date, is_done)')
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

    // Fire-and-forget client sync. Doesn't block the return; a clients
    // table failure must never cascade into "your quote didn't save".
    syncClientFromQuote(quote, 'create')

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
    if (!error) {
      store.upsertQuote(data)
      // Refresh the client snapshot if the quote edit changed any
      // client_* field. Doesn't rewrite history — past quotes keep their
      // own denormalized copy. This just keeps the CRM view in sync
      // with the latest values the rep entered.
      const touchedClient = ['client_name','client_company','client_phone','client_email','client_gst','client_address','client_notes']
        .some(k => k in updates)
      if (touchedClient) syncClientFromQuote(data, 'update')
    }
    return { data, error }
  }

  const updateQuoteStatus = async (id, status, additionalUpdates = {}) => {
    // Snapshot the prior status so we can detect the non-won → won
    // transition. Only that specific transition should add to the
    // client's total_won_amount; status churn (won → won via edit,
    // or won → lost → won) is rare but would double-count otherwise.
    const { data: before } = await supabase
      .from('quotes')
      .select('status')
      .eq('id', id)
      .single()

    const { data, error } = await supabase
      .from('quotes')
      .update({ status, ...additionalUpdates })
      .eq('id', id)
      .select()
      .single()
    if (!error) {
      store.upsertQuote(data)
      if (status === 'won' && before?.status !== 'won') {
        syncClientFromQuote(data, 'won')
      }
    }
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
