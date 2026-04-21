import { create } from 'zustand'

export const useIncentiveStore = create((set) => ({
  settings: null,
  profiles: [],
  monthlySales: [],

  setSettings: (settings) => set({ settings }),
  setProfiles: (profiles) => set({ profiles }),
  setMonthlySales: (monthlySales) => set({ monthlySales }),

  upsertProfile: (profile) => set((s) => {
    const idx = s.profiles.findIndex(p => p.id === profile.id)
    if (idx >= 0) {
      const updated = [...s.profiles]
      updated[idx] = profile
      return { profiles: updated }
    }
    return { profiles: [...s.profiles, profile] }
  }),
}))
