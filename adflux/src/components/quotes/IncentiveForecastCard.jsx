// src/components/quotes/IncentiveForecastCard.jsx
//
// Phase 34D — "If you close this quote, you earn X" forecaster.
//
// Audit finding (item 8 of the May 13 sales-module review): the math
// to compute a rep's incentive already lives in src/utils/incentiveCalc.js
// + a profile per rep in `staff_incentive_profiles`. The /my-performance
// page uses it. But on the quote detail page — where the rep is
// looking at a number that DECIDES their incentive — there's no
// "close this and you earn ₹X" line. So no daily motivation tied
// to a specific deal.
//
// This card fixes that. Mounted on QuoteDetail (Private LED + Other
// Media). Shows:
//   - Quote subtotal
//   - Rep's current month new + renewal revenue (so we can math
//     "if this lands ON TOP of what's already in")
//   - Incremental incentive earned by closing this quote
//   - Whether closing crosses the slab threshold (50% of monthly
//     salary × multiplier) — colored chip
//
// Visible only to sales / agency / telecaller roles — admin already
// sees liability views on /incentives.

import { useEffect, useState } from 'react'
import { TrendingUp, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { formatCurrency } from '../../utils/formatters'

function monthYearISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function IncentiveForecastCard({ quote }) {
  const profile = useAuthStore((s) => s.profile)
  const [incentiveProfile, setIncentiveProfile] = useState(null)
  const [monthly, setMonthly] = useState(null)
  const [loading, setLoading] = useState(true)

  // Only sales/agency/telecaller see the forecaster. Admin / co-owner
  // already see broader liability dashboards elsewhere.
  const role = profile?.role || profile?.team_role
  const isRep = role === 'sales' || role === 'agency' || role === 'telecaller'

  useEffect(() => {
    if (!isRep || !profile?.id) {
      setLoading(false)
      return
    }
    let cancelled = false

    Promise.all([
      supabase
        .from('staff_incentive_profiles')
        .select('*')
        .eq('user_id', profile.id)
        .maybeSingle(),
      supabase
        .from('monthly_sales_data')
        .select('new_client_revenue, renewal_revenue')
        .eq('user_id', profile.id)
        .eq('month_year', monthYearISO())
        .maybeSingle(),
    ]).then(([profRes, monthRes]) => {
      if (cancelled) return
      if (profRes.data) setIncentiveProfile(profRes.data)
      if (monthRes.data) setMonthly(monthRes.data)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [isRep, profile?.id])

  // Hide the card entirely for admins, or if no profile, or while loading
  // (we don't want a flicker of "loading…" cluttering the quote page).
  if (!isRep || loading || !incentiveProfile) return null

  // Skip for already-Won quotes — incentive math already applies. The
  // card is a forecast; once Won, it becomes history.
  if (quote.status === 'won' || quote.status === 'lost') return null

  const baseNew     = monthly?.new_client_revenue || 0
  const baseRenewal = monthly?.renewal_revenue    || 0
  const quoteAmount = Number(quote.subtotal || quote.total_amount || 0)
  const isRenewal   = quote.revenue_type === 'renewal'

  const before = calculateIncentive({
    monthlySalary:    Number(incentiveProfile.monthly_salary || 0),
    salesMultiplier:  Number(incentiveProfile.sales_multiplier || 5),
    newClientRate:    Number(incentiveProfile.new_client_rate || 0.05),
    renewalRate:      Number(incentiveProfile.renewal_rate || 0.02),
    flatBonus:        Number(incentiveProfile.flat_bonus || 10000),
    newClientRevenue: baseNew,
    renewalRevenue:   baseRenewal,
  })

  const after = calculateIncentive({
    monthlySalary:    Number(incentiveProfile.monthly_salary || 0),
    salesMultiplier:  Number(incentiveProfile.sales_multiplier || 5),
    newClientRate:    Number(incentiveProfile.new_client_rate || 0.05),
    renewalRate:      Number(incentiveProfile.renewal_rate || 0.02),
    flatBonus:        Number(incentiveProfile.flat_bonus || 10000),
    newClientRevenue: baseNew + (isRenewal ? 0 : quoteAmount),
    renewalRevenue:   baseRenewal + (isRenewal ? quoteAmount : 0),
  })

  const delta       = Math.max(0, after.incentive - before.incentive)
  const crossesSlab = !before.slabReached && after.slabReached
  const crossesTarget = !before.targetExceeded && after.targetExceeded

  return (
    <div style={{
      background: 'var(--surface, #1e293b)',
      border: '1px solid var(--border, #334155)',
      borderRadius: 12,
      padding: '14px 16px',
      marginTop: 16,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
        color: 'var(--text-muted, #94a3b8)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        <Sparkles size={12} color="var(--accent, #FFE600)" />
        <span>If you close this this month</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          fontSize: 26,
          fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)',
          fontWeight: 700,
          color: delta > 0 ? 'var(--success, #10B981)' : 'var(--text, #f1f5f9)',
          lineHeight: 1,
        }}>
          {delta > 0 ? '+ ' : ''}{formatCurrency(delta)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
          incentive to your monthly
        </div>
      </div>

      <div style={{
        marginTop: 10,
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
      }}>
        {!after.slabReached && (
          <span style={{
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid var(--warning, #F59E0B)',
            color: 'var(--warning, #F59E0B)',
            fontSize: 11,
            fontWeight: 600,
          }}>
            Won't cross slab yet ({formatCurrency(after.threshold - after.total)} short)
          </span>
        )}
        {crossesSlab && (
          <span style={{
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid var(--success, #10B981)',
            color: 'var(--success, #10B981)',
            fontSize: 11,
            fontWeight: 600,
          }}>
            UNLOCKS slab — first incentive ₹ this month
          </span>
        )}
        {crossesTarget && (
          <span style={{
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(255,230,0,0.18)',
            border: '1px solid var(--accent, #FFE600)',
            color: 'var(--accent, #FFE600)',
            fontSize: 11,
            fontWeight: 700,
          }}>
            + ₹{Number(incentiveProfile.flat_bonus || 10000).toLocaleString('en-IN')} bonus (crosses target)
          </span>
        )}
        <span style={{
          padding: '3px 8px',
          borderRadius: 999,
          background: 'var(--surface-2, #334155)',
          color: 'var(--text-muted, #94a3b8)',
          fontSize: 11,
        }}>
          <TrendingUp size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Month so far: {formatCurrency(before.total)}
        </span>
      </div>
    </div>
  )
}
