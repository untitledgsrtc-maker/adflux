// src/hooks/usePayments.js
//
// Phase 3C additions:
//   • addPayment now branches on role — admin inserts land as
//     approval_status='approved' (admin is the one approving); sales
//     inserts land as 'pending' and wait for an admin decision.
//   • New admin-only actions: approvePayment, rejectPayment.
//   • New sales action: dismissRejectionNotification (clears the red
//     banner after sales acknowledges the rejection reason).
//   • New queries: fetchPendingApprovals (admin inbox),
//     fetchMyRejectedPayments (sales banner feed),
//     fetchPendingCount (sidebar pill).
//   • hasFinalPayment now only counts APPROVED finals, so a sales
//     user who punched a pending "final" can't block themselves out
//     of recording more payments until admin approves.

import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// ─── Helper: settle a quote when warranted ────────────────────────
// Call this after ANY approved payment lands (admin insert or admin
// approval). Two responsibilities, one pass:
//
//   1. Flip the quote to 'won' when:
//      • is_final_payment was just set true on this payment, OR
//      • cumulative approved payments now cover the quote total.
//
//   2. Auto-flag is_final_payment = true on the LATEST approved
//      payment (the one that crossed the threshold) when sum has
//      reached total but no payment is currently flagged final.
//      This is what triggers monthly_sales_data via the existing
//      DB triggers (handle_payment_update / rebuild_monthly_sales),
//      so the rep's incentive bucket lands in the month the FINAL
//      payment cleared — not when the quote was won.
//
// Without (2) a partial-payment-only flow never settles for incentive
// purposes — the quote silently flips to won but the rep's earned
// number stays at zero.
//
// Safe to call multiple times: short-circuits when nothing to do.
async function maybeFlipQuoteWon(quoteId, isFinalPayment) {
  if (!quoteId) return
  // Always pull the latest state so we can make the right call.
  const [{ data: approvedRows }, { data: quoteRow }] = await Promise.all([
    supabase
      .from('payments')
      .select('id, amount_received, payment_date, created_at, is_final_payment')
      .eq('quote_id', quoteId)
      .eq('approval_status', 'approved')
      .order('payment_date', { ascending: true }),
    supabase
      .from('quotes')
      .select('total_amount, status')
      .eq('id', quoteId)
      .single(),
  ])
  if (!quoteRow) return
  const total = Number(quoteRow.total_amount) || 0
  const rows  = approvedRows || []
  const sumApproved = rows.reduce((s, r) => s + Number(r.amount_received || 0), 0)
  const hasFinalFlag = rows.some(r => r.is_final_payment === true)

  // Status flip — independent of the final-flag pass below.
  if (quoteRow.status !== 'won') {
    if (isFinalPayment || (total > 0 && sumApproved >= total)) {
      await supabase.from('quotes').update({ status: 'won' }).eq('id', quoteId)
    }
  }

  // Auto-settle the latest payment as final if the math checks out
  // and nobody has flagged one explicitly. We pick the latest by
  // payment_date (created_at as tiebreaker) — that's the payment
  // that *actually* cleared the balance, so its month is the right
  // bucket for incentive.
  if (!hasFinalFlag && total > 0 && sumApproved >= total && rows.length) {
    const sortedDesc = [...rows].sort((a, b) => {
      const da = a.payment_date || a.created_at || ''
      const db = b.payment_date || b.created_at || ''
      return db.localeCompare(da)
    })
    const last = sortedDesc[0]
    if (last && last.id) {
      await supabase
        .from('payments')
        .update({ is_final_payment: true })
        .eq('id', last.id)
      // The DB trigger handle_payment_update will fire next and run
      // rebuild_monthly_sales(staff, month) — no app-level recalc needed.
    }
  }
}

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
      .select('*, users:received_by(name), approver:approved_by(name)')
      .eq('quote_id', quoteId)
      .order('payment_date', { ascending: false })

    if (err) setError(err.message)
    else setPayments(data || [])

    setLoading(false)
    return { data, error: err }
  }, [quoteId])

  // ─── Record a new payment ─────────────────────────────────────────
  //   Admin: lands approved immediately.
  //   Sales: lands pending, waits for admin approval.
  const addPayment = async (paymentData) => {
    if (!quoteId || !profile?.id) return { error: { message: 'Not authenticated' } }

    setLoading(true)
    setError(null)

    const isAdmin = profile?.role === 'admin'
    const row = {
      ...paymentData,
      quote_id:    quoteId,
      received_by: profile.id,
      approval_status: isAdmin ? 'approved' : 'pending',
      approved_by:     isAdmin ? profile.id : null,
      decided_at:      isAdmin ? new Date().toISOString() : null,
    }

    const { data, error: insertErr } = await supabase
      .from('payments')
      .insert([row])
      .select('*, users:received_by(name), approver:approved_by(name)')
      .single()

    if (insertErr) {
      setError(insertErr.message)
      setLoading(false)
      return { error: insertErr }
    }

    // Only an admin recording an APPROVED payment can flip the quote
    // to "won" from this insert path. When sales punches a pending
    // payment, the quote stays in its current status until approval
    // (approvePayment handles the flip + safety net).
    if (isAdmin) {
      await maybeFlipQuoteWon(quoteId, paymentData.is_final_payment)
    }

    // Prepend to local state (newest first)
    setPayments(prev => [data, ...prev])
    setLoading(false)
    return { data }
  }

  // ─── Update a payment (edit amount/date/notes on pending rows) ────
  const updatePayment = async (paymentId, updates) => {
    if (!profile?.id) return { error: { message: 'Not authenticated' } }

    setLoading(true)
    setError(null)

    const { data, error: updateErr } = await supabase
      .from('payments')
      .update(updates)
      .eq('id', paymentId)
      .select('*, users:received_by(name), approver:approved_by(name)')
      .single()

    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return { error: updateErr }
    }

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

    setPayments(prev => prev.filter(p => p.id !== paymentId))
    setLoading(false)
    return {}
  }

  // ─── Admin: approve a pending payment ─────────────────────────────
  const approvePayment = async (paymentId) => {
    if (profile?.role !== 'admin') return { error: { message: 'Admin only' } }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('payments')
      .update({
        approval_status:  'approved',
        approved_by:      profile.id,
        decided_at:       new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', paymentId)
      .select('*, users:received_by(name), approver:approved_by(name)')
      .single()

    if (err) { setLoading(false); return { error: err } }

    // Flip the quote to "won" if this is an explicit final, OR if
    // cumulative approved payments now cover the quote total. The
    // DB trigger still handles monthly_sales_data — no double count.
    await maybeFlipQuoteWon(data.quote_id, data.is_final_payment)

    setPayments(prev => prev.map(p => p.id === paymentId ? data : p))
    setLoading(false)
    return { data }
  }

  // ─── Admin: reject a pending payment with a reason ────────────────
  const rejectPayment = async (paymentId, reason) => {
    if (profile?.role !== 'admin') return { error: { message: 'Admin only' } }
    if (!reason || !reason.trim()) {
      return { error: { message: 'A rejection reason is required' } }
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('payments')
      .update({
        approval_status:   'rejected',
        approved_by:       profile.id,
        decided_at:        new Date().toISOString(),
        rejection_reason:  reason.trim(),
        sales_notified_at: null, // resets banner
      })
      .eq('id', paymentId)
      .select('*, users:received_by(name), approver:approved_by(name)')
      .single()

    setLoading(false)
    if (err) return { error: err }
    setPayments(prev => prev.map(p => p.id === paymentId ? data : p))
    return { data }
  }

  // ─── Sales: dismiss a rejection banner (marks notified) ───────────
  const dismissRejectionNotification = async (paymentId) => {
    const { error: err } = await supabase.rpc('dismiss_payment_notification', {
      p_payment_id: paymentId,
    })
    if (err) return { error: err }
    setPayments(prev => prev.map(p =>
      p.id === paymentId ? { ...p, sales_notified_at: new Date().toISOString() } : p
    ))
    return {}
  }

  // ─── Derived values ───────────────────────────────────────────────
  // "totalPaid" is from the sales user's perspective — pending/rejected
  // should not reduce the outstanding balance they're chasing.
  const totalPaid = payments
    .filter(p => p.approval_status === 'approved')
    .reduce((sum, p) => sum + (p.amount_received || 0), 0)

  // Only an APPROVED final payment locks the quote. A pending final
  // shouldn't block the sales user from adding more payments if the
  // admin ends up rejecting it.
  const hasFinalPayment = payments.some(
    p => p.is_final_payment && p.approval_status === 'approved'
  )

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
    approvePayment,
    rejectPayment,
    dismissRejectionNotification,
  }
}

// =====================================================
// Admin-wide helpers — not tied to a specific quote
// =====================================================

// Admin inbox: every pending payment with quote + submitter context.
// `segment` and `media_type` are needed so PendingApprovalsV2 can route
// the "open quote" link to /proposal/:id (govt) vs /quotes/:id (private)
// — without them, govt approvals 404 when admin clicks through.
export async function fetchPendingApprovals() {
  return supabase
    .from('payments')
    .select(`
      *,
      users:received_by(name),
      quotes(id, quote_number, ref_number, client_name, client_company, total_amount, created_by, sales_person_name, segment, media_type)
    `)
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: false })
}

// Sales: their own pending payments (powers the "awaiting approval"
// banner on the sales dashboard). Shows what they've punched that
// admin hasn't approved or rejected yet.
export async function fetchMyPendingPayments(userId) {
  return supabase
    .from('payments')
    .select(`
      *,
      quotes!inner(id, quote_number, client_name, created_by)
    `)
    .eq('approval_status', 'pending')
    .eq('received_by', userId)
    .order('created_at', { ascending: false })
}

// Sales: rejections they haven't dismissed yet (powers the banner)
export async function fetchMyRejectedPayments(userId) {
  return supabase
    .from('payments')
    .select(`
      *,
      quotes!inner(id, quote_number, client_name, created_by),
      approver:approved_by(name)
    `)
    .eq('approval_status', 'rejected')
    .is('sales_notified_at', null)
    .eq('quotes.created_by', userId)
    .order('decided_at', { ascending: false })
}

// Sidebar pill: live count of pending approvals (admin only)
export async function fetchPendingCount() {
  const { count, error } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('approval_status', 'pending')
  return { count: count || 0, error }
}
