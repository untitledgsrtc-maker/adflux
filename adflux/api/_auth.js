// Phase 85.3 — shared JWT verification for Vercel API routes.
//
// Why this exists
//   /api/snap-to-roads + /api/directions proxy paid Google APIs.
//   Pre-Phase-85 both endpoints accepted any caller — anyone with
//   the URL could rack up Google bill against your card. Audit
//   24 May 2026 flagged as P1.
//
// Strategy
//   Verify the caller's Supabase JWT by calling supabase.auth.
//   getUser(token). This costs one round-trip to the auth server
//   but doesn't require us to hardcode the JWT secret (which would
//   itself become a secret-management problem).
//
// Env
//   SUPABASE_URL          — server-side, no VITE_ prefix
//   SUPABASE_ANON_KEY     — server-side, no VITE_ prefix
//   Both fall back to the VITE_* counterparts so existing Vercel
//   env config (with only VITE_* set) keeps working until owner
//   adds bare names.
//
// Usage
//   import { requireAuth } from './_auth'
//   export default async function handler(req, res) {
//     const user = await requireAuth(req, res)
//     if (!user) return  // requireAuth already sent 401
//     // ... rest of handler ...
//   }

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

/**
 * Validate the Authorization header against Supabase auth.
 * On success returns the user object.
 * On failure sends 401 + returns null.
 */
export async function requireAuth(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({ error: 'Server auth not configured' })
    return null
  }
  const authHeader = req.headers?.authorization || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    res.status(401).json({ error: 'Missing Authorization Bearer token' })
    return null
  }
  const token = match[1].trim()
  // Recreate client per-request — Vercel functions are stateless
  // and the supabase client holds the bearer token via global header.
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })
  try {
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return null
    }
    return data.user
  } catch (e) {
    res.status(401).json({ error: 'Auth check failed: ' + (e?.message || 'unknown') })
    return null
  }
}
