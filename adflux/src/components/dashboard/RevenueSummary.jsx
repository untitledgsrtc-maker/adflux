// src/components/dashboard/RevenueSummary.jsx
//
// FIXED — the KPI row now refreshes automatically when payments or
// quotes change.
//
// BUG (before): `useEffect(() => { load() }, [])` ran once when the
// Dashboard mounted. If a sales user recorded a payment on a Quote
// Detail page, then came back to Dashboard, the cached numbers from
// the first mount were shown. That's why "sales person adds payment
// but nothing shows on dashboard".
//
// FIX (after):
//   1. Subscribe to Supabase realtime on the `payments` and `quotes`
//      tables — any insert/update/delete triggers a reload.
//   2. Reload on window focus — covers cases where realtime isn't
//      connected (e.g. poor network).
//   3. Reload on tab visibility change — covers mobile PWA cases
//      where the tab is backgrounded.

import { useEffect, useState, useCallback } from 'react'
import { TrendingUp, FileText, IndianRupee, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCompact } from '../../utils/formatters'

export function RevenueSummary() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const currentMonth = new Date().toISOString().slice(0, 7)

    const [quotesRes, paymentsRes, pipelineRes] = await Promise.all([
      supabase.from('quotes').select('id, status, total_amount, created_at'),
      supabase.from('payments').select('amount_received, payment_date, is_final_payment'),
      supabase.from('quotes').select('total_amount').in('status', ['sent', 'negotiating']),
    ])

    const quotes   = quotesRes.data   || []
    const payments = paymentsRes.data || []
    const pipeline = pipelineRes.data || []

    const thisMonthPayments = payments.filter(p =>
      p.payment_date && p.payment_date.startsWith(currentMonth)
    )
    const monthRevenue = thisMonthPayments.reduce((s, p) => s + (p.amount_received || 0), 0)

    const totalCollected = payments.reduce((s, p) => s + (p.amount_received || 0), 0)

    const activeQuotes = quotes.filter(q => !['lost'].includes(q.status)).length
    const pipelineValue = pipeline.reduce((s, q) => s + (q.total_amount || 0), 0)

    // Outstanding = won quotes total - total collected so far
    const wonTotal = quotes
      .filter(q => q.status === 'won')
      .reduce((s, q) => s + (q.total_amount || 0), 0)
    const outstanding = Math.max(0, wonTotal - totalCollected)

    setData({ monthRevenue, activeQuotes, pipelineValue, outstanding })
    setLoading(false)
  }, [])

  // Initial load + live refresh triggers
  useEffect(() => {
    load()

    // 1. Realtime subscription on payments and quotes
    const channel = supabase
      .channel('dashboard-revenue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        () => load()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quotes' },
        () => load()
      )
      .subscribe()

    // 2. Reload when the tab regains focus
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)

    // 3. Reload when the page becomes visible (mobile / PWA safe)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const cards = data ? [
    {
      label: 'Revenue This Month',
      value: formatCompact(data.monthRevenue),
      icon: IndianRupee,
      color: 'var(--success)',
      bg: 'var(--success-soft)',
    },
    {
      label: 'Active Quotes',
      value: data.activeQuotes,
      icon: FileText,
      color: 'var(--blue)',
      bg: 'var(--blue-soft)',
    },
    {
      label: 'Pipeline Value',
      value: formatCompact(data.pipelineValue),
      icon: TrendingUp,
      color: 'var(--accent-fg)',
      bg: 'var(--accent-soft)',
    },
    {
      label: 'Outstanding',
      value: formatCompact(data.outstanding),
      icon: Clock,
      color: 'var(--warning)',
      bg: 'var(--warning-soft)',
    },
  ] : []

  return (
    <div className="db-kpi-grid">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="db-kpi-card db-kpi-card--loading" />
        ))
      ) : (
        cards.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="db-kpi-card">
              <div
                className="db-kpi-icon"
                style={{ background: card.bg, color: card.color }}
              >
                <Icon size={18} />
              </div>
              <div className="db-kpi-body">
                <p className="db-kpi-label">{card.label}</p>
                <p className="db-kpi-value">{card.value}</p>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
