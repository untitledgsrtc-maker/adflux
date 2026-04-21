// src/hooks/usePayments.js
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

export function usePayments(quoteId) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const profile = useAuthStore(s => s.profile)

  // ─── Fetch all payments for this quote ───────────────────────────
  const fetchPayments = useCallback(async () => {
    if (!quoteId) return
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('payments')
      .select('*, users(name)')
      .eq('quote_id', quoteId)
      .order('payment_date', { ascending: false })

    if (err) setError(err.message)
    else setPayments(data || [])

    setLoading(false)
    return { data, error: err }
  }, [quoteId])

  // ─── Record a new payment ─────────────────────────────────────────
  const addPayment = async (paymentData) => {
    if (!quoteId || !profile?.id) return { error: { message: 'Not authenticated' } }

    setLoading(true)
    setError(null)

    // Insert the payment row
    const { data, error: insertErr } = await supabase
      .from('payments')
      .insert([{
        ...paymentData,
        quote_id: quoteId,
        received_by: profile.id,
      }])
      .select('*, users(name)')
      .single()

    if (insertErr) {
      setError(insertErr.message)
      setLoading(false)
      return { error: insertErr }
    }

    // If final payment — auto-set quote status to Won.
    // NOTE: monthly_sales_data is credited entirely by the Supabase
    // trigger `handle_final_payment` (see supabase_schema.sql).
    // Previously we ALSO wrote client-side, which double-counted
    // revenue. That write has been removed.
    if (paymentData.is_final_payment) {
      await supabase
        .from('quotes')
        .update({ status: 'won' })
        .eq('id', quoteId)
    }

    // Prepend to local state (newest first)
    setPayments(prev => [data, ...prev])
    setLoading(false)
    return { data }
  }

  // ─── Update a payment ─────────────────────────────────────────────
  const updatePayment = async (paymentId, updates) => {
    if (!profile?.id) return { error: { message: 'Not authenticated' } }

    setLoading(true)
    setError(null)

    const { data, error: updateErr } = await supabase
      .from('payments')
      .update(updates)
      .eq('id', paymentId)
      .select('*, users(name)')
      .single()

    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return { error: updateErr }
    }

    // Update local state
    setPayments(prev => prev.map(p => p.id === paymentId ? data : p))
    setLoading(false)
    return { data }
  }

  // ─── Delete a payment ─────────────────────────────────────────────
  const deletePayment = async (paymentId) => {
    if (!profile?.id) return { error: { message: 'Not authenticated' } }

    setLoading(true)
    setError(null)

    const { error: delErr } = await supabase
      .from('payments')
      .delete()
      .eq('id', paymentId)

    if (delErr) {
      setError(delErr.message)
      setLoading(false)
      return { error: delErr }
    }

    // Update local state
    setPayments(prev => prev.filter(p => p.id !== paymentId))
    setLoading(false)
    return {}
  }

  // ─── Derived values ───────────────────────────────────────────────
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount_received || 0), 0)
  const hasFinalPayment = payments.some(p => p.is_final_payment)

  return {
    payments,
    loading,
    error,
    totalPaid,
    hasFinalPayment,
    fetchPayments,
    addPayment,
    updatePayment,
    deletePayment,
  }
}
