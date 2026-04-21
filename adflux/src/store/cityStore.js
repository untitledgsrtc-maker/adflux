import { create } from 'zustand'

export const useCityStore = create((set) => ({
  cities: [],
  setCities: (cities) => set({ cities }),

  upsertCity: (city) => set((s) => {
    const idx = s.cities.findIndex(c => c.id === city.id)
    if (idx >= 0) {
      const updated = [...s.cities]
      updated[idx] = city
      return { cities: updated }
    }
    return { cities: [city, ...s.cities] }
  }),

  removeCity: (id) => set((s) => ({
    cities: s.cities.filter(c => c.id !== id),
  })),

  activeOnly: (state) => state.cities.filter(c => c.is_active),
}))
