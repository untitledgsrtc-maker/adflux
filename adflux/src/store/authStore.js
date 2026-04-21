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

  isAdmin: () => get().profile?.role === 'admin',
  isSales: () => get().profile?.role === 'sales',
}))
