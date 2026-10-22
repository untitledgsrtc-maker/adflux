import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

// Primary client — the one the whole app uses for data queries.
//
// Phase 30C — owner spec (7 May 2026): "login should be saved until
// manual logout". Three settings drive that:
//   1. persistSession: true — the session lives in localStorage
//      across tab reloads + browser restarts.
//   2. autoRefreshToken: true — when the access token (default 1h)
//      is about to expire, the SDK silently swaps it for a new one
//      using the refresh token.
//   3. flowType: 'pkce' — Proof Key for Code Exchange. Hardens the
//      token exchange against interception when the user is on a
//      shared / public Wi-Fi.
//
// The fourth knob lives in the Supabase dashboard, NOT here:
// Auth → JWT settings → Refresh token expiry. Default is 604800
// seconds (7 days). Set to 31536000 (1 year) so reps don't get
// kicked out after a quiet weekend.
// Phase 465: "JWT expired" self-repair. The SDK decides whether the token is still good from THIS computer's clock. A PC whose clock is
// a few minutes behind (or a window that was asleep / throttled) keeps sending an expired token, and every page shows "JWT expired"
// until a manual Retry (Diya, repeatedly). If the server answers 401 "JWT expired" we refresh the session once and re-send the request.
let refreshing = null
const refreshOnce = () => {
  if (!refreshing) refreshing = supabase.auth.refreshSession().then((r) => r?.data?.session?.access_token || null, () => null).finally(() => { setTimeout(() => { refreshing = null }, 2000) })
  return refreshing
}
const fetchWithRepair = async (input, init) => {
  const res = await fetch(input, init)
  try {
    const url = typeof input === 'string' ? input : input?.url || ''
    if (res.status !== 401 || url.includes('/auth/v1/') || !url.includes('/rest/v1/') && !url.includes('/storage/v1/') && !url.includes('/functions/v1/')) return res
    const body = await res.clone().text()
    if (!/JWT expired/i.test(body)) return res
    const token = await refreshOnce()
    if (!token) return res
    const headers = new Headers(init?.headers || (typeof input !== 'string' ? input?.headers : undefined) || {})
    headers.set('Authorization', `Bearer ${token}`)
    return await fetch(input, { ...(init || {}), headers })
  } catch { return res }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithRepair },
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true,
    flowType:          'pkce',
  },
})

// Isolated client for admin-initiated signUp flows.
// With persistSession=false the auth state is kept in memory only on
// THIS client instance, so calling signUp here does NOT overwrite the
// admin's session on the primary `supabase` client. This prevents the
// "admin gets auto-logged-out when creating a team member" bug.
//
// NOTE: this still uses the public anon key — it cannot bypass RLS.
// For real admin user-management (delete users, skip email confirm, etc.)
// a service-role key on a server-side edge function is the correct path,
// but for our in-app "admin types password → member is created" flow
// this is sufficient and stays safe on the client.
export const supabaseSignup = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'adflux-signup-isolated',
  },
})
