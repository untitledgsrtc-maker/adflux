import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useQuoteStore } from '../store/quoteStore'
import { useAuthStore } from '../store/authStore'

/* Upsert a client row for the given quote payload. Runs after a quote is
   successfully created (or, for won transitions, after updateQuoteStatus).
   Silently swallows errors — a client-sync failure should NEVER block a
   quote from saving. The clients table is a CRM layer on top of quotes;
   quotes are the source of truth.

   Dedup rule (matches DB unique index): one row per (phone, created_by).
   Each sales rep has their own view of a client; admin sees everyone's.

   snapshotMode:
     'create'  → new quote. Upsert and bump quote_count + last_quote_at.
     'won'     → status became 'won'. Add to total_won_amount.
     'update'  → quote edited. Refresh client snapshot from new values
                 but do NOT bump quote_count (same quote). */
async function syncClientFromQuote(quote, snapshotMode = 'create') {
  try {
    if (!quote?.client_phone || !quote.created_by) return
    const phone = String(quote.client_phone).trim()
    if (!phone) return

    // Look up existing client for (phone, created_by). We fetch first
    // instead of using Postgres upsert because we need to MERGE counts
    // (quote_count += 1, total_won_amount += total) which a plain upsert
    // can't express from the client side.
    const { data: existing } = await supabase
      .from('clients')
      .select('id, first_quote_at, quote_count, total_won_amount')
      .eq('phone', phone)
      .eq('created_by', quote.created_by)
      .maybeSingle()

    const now = new Date().toISOString()
    const clientSnapshot = {
      name:    (quote.client_name || '').trim() || 'Unknown',
      company: (quote.client_company || '').trim() || null,
      phone,
      email:   (quote.client_email || '').trim() || null,
      gstin:   (quote.client_gst || '').trim() || null,
      address: (quote.client_address || '').trim() || null,
      notes:   (quote.client_notes || '').trim() || null,
    }

    if (!existing) {
      // New client record.
      await supabase.from('clients').insert([{
        ...clientSnapshot,
        created_by:       quote.created_by,
        first_quote_at:   now,
        last_quote_at:    now,
        quote_count:      snapshotMode === 'update' ? 0 : 1,
        total_won_amount: snapshotMode === 'won' ? (quote.total_amount || 0) : 0,
      }])
      return
    }

    // Existing client — refresh snapshot (so the clients list reflects
    // the latest name/company/etc. the rep typed) and bump counters
    // according to snapshotMode.
    const patch = {
      ...clientSnapshot,
      last_quote_at: now,
    }
    if (snapshotMode === 'create') {
      patch.quote_count = (existing.quote_count || 0) + 1
    }
    if (snapshotMode === 'won') {
      patch.total_won_amount = (existing.total_won_amount || 0) + (quote.total_amount || 0)
    }
    await supabase.from('clients').update(patch).eq('id', existing.id)
  } catch (err) {
    // Non-fatal. Log so it's debuggable, but don't bubble.

    console.warn('[clients] sync failed:', err?.message || err)
  }
}

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
    let query = supabase
      .from('quotes')
      .select('*, quote_cities(*), payments(amount_received, approval_status)')
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
