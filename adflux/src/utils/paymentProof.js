// Client proof (Google review screenshot / testimonial video) for a payment.
// Files live in the existing PRIVATE `quote-attachments` bucket under the
// quote's folder, so that bucket's RLS (quote creator + admin/co_owner) applies
// unchanged. See supabase_phase529_payment_proof.sql.

import { supabase } from '../lib/supabase'

const BUCKET = 'quote-attachments'

export const PROOF_TYPES = [
  { value: 'google_review', label: 'Google review', accept: 'image/*', hint: 'Screenshot of the review the client posted' },
  { value: 'video',         label: 'Testimonial video', accept: 'video/*', hint: 'Short video from the client' },
]

export const MAX_PROOF_BYTES = 100 * 1024 * 1024   // bucket limit

// A rejected payment's proof does not count as proof on file.
export const quoteHasProof = (payments = []) =>
  payments.some(p => p?.proof_path && p.approval_status !== 'rejected')

// Needed only for a NEW payment on a PRIVATE quote that has no proof on file yet.
// Admin entries are exempt (back-filled / office entries can't produce a client proof).
export function paymentNeedsProof({ quote, existingPayments = [], isEdit = false, isAdmin = false }) {
  if (isEdit || isAdmin) return false
  if (quote?.segment === 'GOVERNMENT') return false
  return !quoteHasProof(existingPayments)
}

// Review-request link from the PRIVATE company row (never hardcoded, CLAUDE.md §4).
let REVIEW_URL_CACHE = null
export async function fetchReviewUrl() {
  if (REVIEW_URL_CACHE) return REVIEW_URL_CACHE
  const { data, error } = await supabase
    .from('companies')
    .select('google_review_url')
    .eq('segment', 'PRIVATE')
    .maybeSingle()
  if (error) throw error
  REVIEW_URL_CACHE = data?.google_review_url || ''
  return REVIEW_URL_CACHE
}

export async function uploadPaymentProof(quoteId, file) {
  const safe = String(file.name || 'proof').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
  const path = `${quoteId}/payment-proof-${Date.now()}-${safe}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (error) {
    if (/row-level security|policy/i.test(error.message || '')) {
      throw new Error('only the person who created this quote (or admin) can attach the proof')
    }
    throw error
  }
  return path
}

// Best effort: drop an uploaded proof when the payment itself failed to save.
export async function removePaymentProof(path) {
  try { await supabase.storage.from(BUCKET).remove([path]) } catch { /* orphan is harmless */ }
}

export async function getProofUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}
