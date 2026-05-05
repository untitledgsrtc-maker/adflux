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
    if (!quote?.created_by) return
    const phone   = String(quote.client_phone || '').trim()
    const company = String(quote.client_company || '').trim()
    const name    = String(quote.client_name || '').trim()

    // Phase 11l — govt proposals frequently have no phone (the
    // "client" is a government body, contacted by physical letter).
    // Previous behaviour was to early-return when phone was missing,
    // so a sales rep with 6 won govt quotes had 0 client rows. Now
    // we accept phone-less clients and dedup on (phone, created_by)
    // when phone exists, else (lower(name), created_by). The DB unique
    // index on (phone, created_by) treats NULL ≠ NULL, so multiple
    // phone-less rows for the same rep don't collide there.
    if (!phone && !company && !name) return  // nothing to identify

    // Look up existing client. Two paths:
    //   • phone present → match (phone, created_by) — same as before.
    //   • phone absent  → fall back to matching by (lower(company OR name), created_by).
    let existing = null
    if (phone) {
      const r = await supabase
        .from('clients')
        .select('id, first_quote_at, quote_count, total_won_amount')
        .eq('phone', phone)
        .eq('created_by', quote.created_by)
        .maybeSingle()
      existing = r.data || null
    } else {
      const lookupName = (company || name || '').toLowerCase()
      if (lookupName) {
        const r = await supabase
          .from('clients')
          .select('id, first_quote_at, quote_count, total_won_amount, name, company')
          .eq('created_by', quote.created_by)
          .is('phone', null)
        // Client-side fuzzy match on lowercased name/company. Avoids a
        // SQL function index on lower(name) which would need a
        // migration; the rep's phone-less client list is small enough.
        existing = (r.data || []).find(c =>
          (c.company || '').toLowerCase() === lookupName ||
          (c.name    || '').toLowerCase() === lookupName
        ) || null
      }
    }

    const now = new Date().toISOString()
    const clientSnapshot = {
      name:    name || 'Unknown',
      company: company || null,
      // Phase 11l — null phone allowed (govt bodies). DB column is
      // nullable already; only the unique index treats NULLs as
      // distinct so multiple phone-less rows per rep is fine.
      phone:   phone || null,
      email:   (quote.client_email || '').trim() || null,
      gstin:   (quote.client_gst || '').trim() || null,
      address: (quote.client_address || '').trim() || null,
      notes:   (quote.client_notes || '').trim() || null,
    }

    if (!existing) {
      const { error: insErr } = await supabase.from('clients').insert([{
        ...clientSnapshot,
        created_by:       quote.created_by,
        first_quote_at:   now,
        last_quote_at:    now,
        quote_count:      snapshotMode === 'update' ? 0 : 1,
        total_won_amount: snapshotMode === 'won' ? (quote.total_amount || 0) : 0,
      }])
      // Phase 11i — RLS rejection is the most common failure mode here
      // (agency or other non-sales role with no clients_*_own policy).
      // Surface it to the console with full detail so the user/dev can
      // see why the clients tab stays empty even after creating quotes.
      if (insErr) {
        console.error(
          '[clients] insert failed — likely RLS. role/auth.uid mismatch?',
          {
            phone,
            created_by: quote.created_by,
            error:      insErr,
          },
        )
      }
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
    const { error: updErr } = await supabase
      .from('clients')
      .update(patch)
      .eq('id', existing.id)
    if (updErr) {
      console.error(
        '[clients] update failed — likely RLS:',
        { client_id: existing.id, error: updErr },
      )
    }
  } catch (err) {
    // Non-fatal. Log so it's debuggable, but don't bubble.
    console.warn('[clients] sync failed:', err?.message || err)
  }
}
