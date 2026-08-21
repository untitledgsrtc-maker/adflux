import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useQuoteStore } from '../store/quoteStore'
import { useAuthStore } from '../store/authStore'
import { syncClientFromQuote } from '../utils/syncClient'
import { toastError } from '../components/v2/Toast'

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

  const fetchQuotes = useCallback(async (opts = {}) => {
    // Phase 247.3 — team viewer: load ALL reps' quotes (READ-ONLY) via the gated
    // team_all_quotes() RPC (her own-only RLS would return just hers). Same shape
    // as the normal SELECT (quote row + quote_cities/payments/follow_ups nested),
    // so downstream rendering is unchanged. Off unless opts.team.
    if (opts.team) {
      const { data, error } = await supabase.rpc('team_all_quotes')
      if (!error) store.setQuotes(Array.isArray(data) ? data : [])
      return { data: Array.isArray(data) ? data : [], error }
    }
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
    const { filters } = store
    // Phase 152 — build a fresh filtered query per page so we can paginate.
    // PostgREST caps a single .select() at ~1000 rows; without this an org
    // (or a rep) with >1000 quotes would silently load only the first 1000
    // — the same trap just fixed for leads (Phase 151). Quotes are ~300
    // today, so this is ONE request now; it just future-proofs the list.
    // Phase 311 — the Won tab attributes deals by the WON date (won_at), not the
    // sent date (created_at): a quote sent in July but marked Won in August shows
    // under August. Every other tab keeps dating by created_at (byte-unchanged).
    // `dateColOverride` lets the caller force created_at as a fallback (below).
    const buildQuery = (dateColOverride) => {
      let q = supabase
        .from('quotes')
        // cap-ok — paginated by runPaged() below (§66/§152), not a bare unbounded select
        .select('*, quote_cities(*), payments(amount_received, approval_status), follow_ups(follow_up_date, is_done)')
        .order('created_at', { ascending: false })
      // Phase 11g — agency behaves like sales: own quotes only; admin sees all.
      if (profile?.role === 'sales' || profile?.role === 'agency') {
        q = q.eq('created_by', profile.id)
      }
      if (filters.status) q = q.eq('status', filters.status)
      if (filters.search) {
        q = q.or(
          `client_name.ilike.%${filters.search}%,client_company.ilike.%${filters.search}%,quote_number.ilike.%${filters.search}%`
        )
      }
      const dateCol = dateColOverride || (filters.status === 'won' ? 'won_at' : 'created_at')
      if (filters.dateFrom) q = q.gte(dateCol, filters.dateFrom)
      if (filters.dateTo)   q = q.lte(dateCol, filters.dateTo + 'T23:59:59')
      return q
    }

    // Phase 152 — paginate in 1000-row chunks (PostgREST caps a bare .select()
    // at ~1000). Returns { data, error }; a page error short-circuits the loop.
    const runPaged = async (dateColOverride) => {
      const PAGE = 1000
      let all = []
      let from = 0
      for (;;) {
        const { data, error } = await buildQuery(dateColOverride).range(from, from + PAGE - 1)
        if (error) return { data: all, error }
        all = all.concat(data || [])
        if (!data || data.length < PAGE) break
        from += PAGE
        if (from >= 20000) break
      }
      return { data: all, error: null }
    }

    let res = await runPaged()
    // Phase 311 resilience — the Won tab filters on won_at (Phase 311 SQL). If
    // that column isn't there yet (migration not run / mid-deploy), the fetch
    // 400s. Do NOT leave the Won list empty: retry dating by created_at (the
    // pre-311 behaviour) so the filter still works. Once supabase_phase311_final.sql
    // is run, won_at exists and this fallback never fires.
    if (res.error && filters.status === 'won' && (filters.dateFrom || filters.dateTo)) {
      console.warn('[useQuotes] won_at filter failed — falling back to created_at. Run supabase_phase311_final.sql.', res.error?.message || res.error)
      res = await runPaged('created_at')
    }
    if (!res.error) store.setQuotes(res.data)
    return { data: res.data, error: res.error }
  }, [profile?.id, store.filters])

  const fetchQuoteById = async (id) => {
    if (!id) return { data: null, error: { message: 'No quote id' } }
    // Phase 21b — accept either a UUID or a quote_number ref. UUIDs
    // are 36 chars with hyphens at fixed positions and only hex; ref
    // numbers like "UA-2026-0042" or "UA/AUTO/2026-27/0029" don't
    // match. Detect by shape and look up on the right column so a
    // user pasting a ref-number URL doesn't 404.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const lookupCol = UUID_RE.test(id) ? 'id' : 'quote_number'
    const { data, error } = await supabase
      .from('quotes')
      .select('*, quote_cities(*)')
      .eq(lookupCol, id)
      .maybeSingle()
    if (!error && data) store.setCurrentQuote(data)
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
    // Phase 34a — surface failures via toast so the rep knows the
    // Clients table is out of sync with this quote. Quote itself is
    // already saved, so this is informational rather than blocking.
    Promise.resolve(syncClientFromQuote(quote, 'create')).then(
      (res) => {
        if (res && res.error) {
          toastError(res.error, 'Quote saved, but Client sync failed.')
        }
      },
      (err) => {
        toastError(err, 'Quote saved, but Client sync failed.')
      },
    )

    // Phase 14 — Lead → Quote linkage. If this quote was opened via
    // /leads/:id "Convert to Quote", quoteData carries lead_id (saved
    // on quotes.lead_id above). Advance the originating lead's stage
    // to QuoteSent + pin its quote_id so the lead funnel stays accurate.
    //
    // Phase 34a — previously fire-and-forget (silent on RLS / network
    // failure), so a quote could ship while the lead stayed in its old
    // stage. Now surface failures via toast — quote is already saved,
    // but the rep needs to know the lead funnel did not advance.
    if (quote.lead_id) {
      supabase
        .from('leads')
        .update({ stage: 'QuoteSent', quote_id: quote.id })
        .eq('id', quote.lead_id)
        .then(({ error: leadErr }) => {
          if (leadErr) {
            toastError(leadErr, 'Quote saved, but lead stage did not advance to QuoteSent.')
          }
        }, (err) => {
          toastError(err, 'Quote saved, but lead stage did not advance to QuoteSent.')
        })
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
    // Phase 11 — client-side guard mirrors the DB trigger
    // (quotes_block_delete in supabase_phase11b_immutability.sql).
    // The DB will reject any delete on non-draft quotes, but checking
    // here gives us a clean error message without a round-trip and
    // protects against showing a Delete button for a sent/won row.
    const target = store.quotes?.find(q => q.id === id)
    if (target && target.status !== 'draft') {
      return {
        error: {
          message:
            `Quote ${target.quote_number || id} is in status "${target.status}". ` +
            'Only DRAFT quotes can be deleted. To remove from active pipeline, ' +
            'mark it Lost instead.',
        },
      }
    }
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
