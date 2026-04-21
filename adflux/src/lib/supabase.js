import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

// Primary client — the one the whole app uses for data queries.
// Keeps the admin's session in localStorage and auto-refreshes tokens.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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
