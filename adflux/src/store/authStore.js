import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  loading: true,

  setUser:    (user)    => set({ user }),
  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ loading }),

  fetchProfile: async (userId) => {
    // Try by ID first
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single()

    if (!error && data) {
      set({ profile: data, loading: false })
      return data
    }

    // Fallback: try matching by email from auth session
    // This handles cases where the users table email differs slightly
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser?.email) {
      const { data: byEmail } = await supabase
        .from('users')
        .select('*')
        .ilike('email', authUser.email)
        .single()

      if (byEmail) {
        // Fix the ID mismatch silently — update the users table id to match auth
        await supabase
          .from('users')
          .update({ id: userId, email: authUser.email })
          .eq('id', byEmail.id)

        const fixed = { ...byEmail, id: userId, email: authUser.email }
        set({ profile: fixed, loading: false })
        return fixed
      }
    }

    console.error('fetchProfile: no matching user found', error)
    set({ loading: false })
    return null
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null })
  },

  // Role helpers — backwards-compatible. isAdmin keeps original meaning
  // (only 'admin' role). isPrivileged is the new full-access set
  // (admin + owner + co_owner) used for sidebar gating, RLS-equivalent
  // checks on the client, and master-data page access.
  isAdmin:      () => get().profile?.role === 'admin',
  isSales:      () => get().profile?.role === 'sales',
  isOwner:      () => get().profile?.role === 'owner',
  isCoOwner:    () => get().profile?.role === 'co_owner',
  isPrivileged: () => ['admin', 'owner', 'co_owner'].includes(get().profile?.role),

  // Segment scope — drives wizard segment lock + quotes list filter.
  // Returns 'ALL' for non-sales/telecaller roles since the DB column
  // backfills them to ALL anyway.
  segmentAccess: () => get().profile?.segment_access || 'ALL',

  // True if this user can sign Government proposals (Brijesh + Vishal
  // currently). Used to populate signer dropdowns in the wizard.
  isSigner: () => !!get().profile?.signing_authority,
}))
