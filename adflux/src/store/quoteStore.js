import { create } from 'zustand'

export const useQuoteStore = create((set) => ({
  quotes: [],
  currentQuote: null,
  filters: {
    status: '',
    search: '',
    dateFrom: '',
    dateTo: '',
  },

  setQuotes: (quotes) => set({ quotes }),
  setCurrentQuote: (quote) => set({ currentQuote: quote }),
  setFilters: (filters) => set((s) => ({ filters: { ...s.filters, ...filters } })),
  resetFilters: () => set({ filters: { status: '', search: '', dateFrom: '', dateTo: '' } }),

  // Add or update a quote in the list
  upsertQuote: (quote) => set((s) => {
    const idx = s.quotes.findIndex(q => q.id === quote.id)
    if (idx >= 0) {
      const updated = [...s.quotes]
      updated[idx] = quote
      return { quotes: updated }
    }
    return { quotes: [quote, ...s.quotes] }
  }),

  removeQuote: (id) => set((s) => ({
    quotes: s.quotes.filter(q => q.id !== id),
  })),
}))
