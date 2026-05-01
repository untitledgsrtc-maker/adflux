// =====================================================================
// Supabase client — single instance shared across the app.
// Browser-safe: we only ever ship the anon key. Every sensitive query
// is gated by RLS at the DB layer, so the worst a leaked anon key can
// do is read public reference data (master rates, station list, etc.).
// =====================================================================

import { createClient } from '@supabase/supabase-js';

const url      = import.meta.env.VITE_SUPABASE_URL;
const anonKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Don't throw — render a friendly setup screen later. Console-warn so
  // developers see why nothing works.
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing.\n' +
    'Copy .env.example to .env.local and fill them in.'
  );
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession:  true,
    autoRefreshToken:true,
    detectSessionInUrl: true,
  },
  global: {
    headers: { 'x-application': 'untitled-proposals' },
  },
});

// Convenience: throw on RPC errors so callers don't have to remember to
// check { error }. For SELECT/INSERT/UPDATE we keep the standard
// { data, error } pattern so React Query can surface failures.
export async function callRpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) {
    const wrapped = new Error(`[rpc:${fn}] ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
  return data;
}
