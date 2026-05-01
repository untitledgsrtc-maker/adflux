// src/utils/syncClient.js
//
// Upsert a client row from a quote payload after a successful insert.
// Shared between the private CreateQuote flow (via useQuotes hook) and
// the Government wizards (CreateGovtAutoHoodV2, CreateGovtGsrtcLedV2).
//
// Dedup rule (matches DB unique index): one row per (phone, created_by).
// Each sales rep has their own view of a client; admin sees everyone's.
//
// Silently swallows errors — a client-sync failure should NEVER block a
// quote from saving. The clients table is a CRM layer on top of quotes;
// quotes are the source of truth.
//
// snapshotMode:
//   'create'  → new quote. Upsert and bump quote_count + last_quote_at.
//   'won'     → status became 'won'. Add to total_won_amount.
//   'update'  → quote edited. Refresh client snapshot from new values
//               but do NOT bump quote_count (same quote).

import { supabase } from '../lib/supabase'

export async function syncClientFromQuote(quote, snapshotMode = 'create') {
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
