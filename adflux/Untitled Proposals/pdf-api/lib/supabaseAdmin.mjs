// =====================================================================
// Server-side Supabase client. Uses the SERVICE ROLE key — DO NOT ship
// to the browser. Only available inside Vercel functions.
//
// We still verify the caller's session before doing any work; the
// service role is only used for FETCHES (snapshots are immutable so
// reading them by id is safe) and for inserting proposal_versions
// after a successful PDF render.
// =====================================================================

import { createClient } from '@supabase/supabase-js';

let _admin = null;
let _anon = null;

export function getAdmin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env missing');
  }
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

/** Anon-key client used to verify the caller's JWT. */
export function getAnon() {
  if (_anon) return _anon;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY env missing');
  }
  _anon = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _anon;
}

/**
 * Verify the bearer token in `Authorization: Bearer <jwt>` and return
 * { user, role }. Throws 401-equivalent on failure.
 */
export async function verifyCaller(req) {
  const auth = req.headers.get?.('authorization') ?? req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    const e = new Error('Missing Authorization: Bearer <jwt>');
    e.status = 401;
    throw e;
  }
  const token = auth.slice('Bearer '.length).trim();
  const anon = getAnon();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) {
    const e = new Error('Invalid or expired token');
    e.status = 401;
    throw e;
  }
  // Fetch role from public.users
  const admin = getAdmin();
  const { data: u, error: uErr } = await admin
    .from('users')
    .select('id, role, full_name, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (uErr || !u || !u.is_active) {
    const e = new Error('User not found or inactive');
    e.status = 403;
    throw e;
  }
  return { user: data.user, role: u.role, fullName: u.full_name };
}
