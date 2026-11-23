// Phase 650 - a lead name must hold a real word: 2+ letters/digits in a row
// (English, Gujarati or Hindi). Same rule as the DB trigger trg_leads_clean_name.
export const hasRealWord = (s) => /[A-Za-z0-9઀-૿ऀ-ॿ]{2,}/.test(s || '')

// self-check
if (import.meta.env?.DEV) {
  console.assert(!hasRealWord('.') && !hasRealWord('🥰') && !hasRealWord('N') && hasRealWord('Raj') && hasRealWord('રાજ'), 'hasRealWord')
}
