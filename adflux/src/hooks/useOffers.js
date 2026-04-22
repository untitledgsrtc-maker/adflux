// src/hooks/useOffers.js
//
// Thin data hook around the hr_offers table + hr_offer_templates.
// Admin-side only — candidate access goes through the
// fetch_offer_by_token / submit_offer_acceptance RPCs (see
// supabase_hr_module.sql) which are called directly from the public
// /offer/:token page.

import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const OFFER_COLS = `
  id, invite_token, status,
  candidate_name, candidate_email, position, territory,
  joining_date, fixed_salary_monthly, incentive_text,
  incentive_sales_multiplier, incentive_new_client_rate,
  incentive_renewal_rate, incentive_flat_bonus,
  place,
  template_id,
  full_legal_name, fathers_name, dob, mobile, personal_email,
  address_line1, address_line2, city, district, state, pincode,
  pan_number, aadhaar_number, qualification,
  bank_account_number, bank_name, bank_ifsc,
  emergency_contact_name, emergency_contact_phone, emergency_contact_rel,
  accepted_terms_at, offer_pdf_url,
  converted_user_id, converted_at,
  created_by, created_at, updated_at
`

export function useOffers() {
  const [offers, setOffers]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const fetchOffers = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('hr_offers')
      .select(OFFER_COLS)
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
      setOffers([])
    } else {
      setError(null)
      setOffers(data || [])
    }
    setLoading(false)
  }, [])

  const fetchOfferById = useCallback(async (id) => {
    const { data, error } = await supabase
      .from('hr_offers')
      .select(OFFER_COLS)
      .eq('id', id)
      .single()
    if (error) return { error }
    return { data }
  }, [])

  // Fetch the single offer linked to the currently-signed-in user
  // (used on the sales-side "My Offer" view). Relies on RLS
  // hr_offers_sales_own — sales can SELECT only their own converted
  // offer row.
  const fetchMyOffer = useCallback(async () => {
    const { data, error } = await supabase
      .from('hr_offers')
      .select(OFFER_COLS)
      .limit(1)
      .maybeSingle()
    if (error) return { error }
    return { data }
  }, [])

  const fetchDefaultTemplate = useCallback(async () => {
    const { data, error } = await supabase
      .from('hr_offer_templates')
      .select('*')
      .eq('is_default', true)
      .limit(1)
      .maybeSingle()
    if (error) return { error }
    return { data }
  }, [])

  // Admin creates a new offer. invite_token is assigned by the DB
  // default (uuid_generate_v4), so we don't pass it from the client.
  const createOffer = useCallback(async (payload) => {
    const { data: auth } = await supabase.auth.getUser()
    const createdBy = auth?.user?.id || null

    const { data, error } = await supabase
      .from('hr_offers')
      .insert([{
        ...payload,
        created_by: createdBy,
        status: 'draft',
      }])
      .select(OFFER_COLS)
      .single()

    if (error) return { error }
    return { data }
  }, [])

  const updateOffer = useCallback(async (id, patch) => {
    const { data, error } = await supabase
      .from('hr_offers')
      .update(patch)
      .eq('id', id)
      .select(OFFER_COLS)
      .single()
    if (error) return { error }
    return { data }
  }, [])

  // Called right after the admin copies the link for the first time —
  // moves status from 'draft' → 'sent' so the list view shows the
  // offer as outstanding. No-op if already past 'sent'.
  const markSent = useCallback(async (id) => {
    return await supabase
      .from('hr_offers')
      .update({ status: 'sent' })
      .eq('id', id)
      .in('status', ['draft'])
  }, [])

  const cancelOffer = useCallback(async (id) => {
    return await supabase
      .from('hr_offers')
      .update({ status: 'cancelled' })
      .eq('id', id)
  }, [])

  return {
    offers, loading, error,
    fetchOffers, fetchOfferById, fetchMyOffer,
    fetchDefaultTemplate,
    createOffer, updateOffer, markSent, cancelOffer,
  }
}

// Status → display label + CSS color token. Kept out of the hook so
// list components can import without instantiating state.
export const STATUS_META = {
  draft:              { label: 'Draft',        color: 'var(--gray)'   },
  sent:               { label: 'Invite Sent',  color: 'var(--accent)' },
  filled:             { label: 'Filled',       color: 'var(--warn)'   },
  accepted:           { label: 'Accepted',     color: 'var(--green)'  },
  converted_to_user:  { label: 'Converted',    color: 'var(--green)'  },
  cancelled:          { label: 'Cancelled',    color: 'var(--red)'    },
}

// Public URL the candidate opens. Uses window.location.origin so it
// works across preview deploys and production without any env wiring.
export function buildOfferUrl(invite_token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/offer/${invite_token}`
}
