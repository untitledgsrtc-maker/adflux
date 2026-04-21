import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../utils/formatters'
import { calculateIncentive } from '../../utils/incentiveCalc'

/**
 * Expanded stats panel shown when a member card is clicked.
 */
export function MemberStatsCard({ member, settings }) {
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadStats() }, [member.id])

  async function loadStats() {
    setLoading(true)
    const currentMonth = new Date().toISOString().slice(0, 7)

    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, status, total_amount, subtotal, revenue_type, created_at')
      .eq('created_by', member.id)

    const quoteIds = (quotes || []).map(q => q.id)
    let payments = []
    if (quoteIds.length) {
      const { data } = await supabase
        .from('payments')
        .select('amount_received, payment_date, is_final_payment, quote_id')
        .in('quote_id', quoteIds)
        .order('payment_date', { ascending: false })
      payments = data || []
    }

    const { data: monthlyData } = await supabase
      .from('monthly_sales_data')
      .select('*')
      .eq('staff_id', member.id)
      .eq('month_year', currentMonth)
      .maybeSingle()

    const totalQuotes  = (quotes || []).length
    const wonQuotes    = (quotes || []).filter(q => q.status === 'won').length
    const totalRevenue = payments.reduce((s, p) => s + (p.amount_received || 0), 0)
    const lastPayment  = payments[0]?.payment_date || null

    const profile = member.staff_incentive_profiles?.[0] || {}
    let incentive = null
    if (settings && profile.monthly_salary) {
      const result = calculateIncentive({
        monthlySalary:    profile.monthly_salary,
        salesMultiplier:  profile.sales_multiplier || settings.default_multiplier,
        newClientRate:    profile.new_client_rate  || settings.new_client_rate,
        renewalRate:      profile.renewal_rate     || settings.renewal_rate,
        flatBonus:        profile.flat_bonus       || settings.default_flat_bonus || settings.flat_bonus,
        newClientRevenue: monthlyData?.new_client_revenue || 0,
        renewalRevenue:   monthlyData?.renewal_revenue    || 0,
      })
      incentive = result.incentive
    }

    setStats({
      totalQuotes, wonQuotes, totalRevenue, lastPayment, incentive,
      currentMonthNew:     monthlyData?.new_client_revenue || 0,
      currentMonthRenewal: monthlyData?.renewal_revenue    || 0,
    })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="member-stats-card">
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading stats…</div>
      </div>
    )
  }

  const profile = member.staff_incentive_profiles?.[0] || {}

  return (
    <div className="member-stats-card">
      <div className="member-stats-card-item">
        <div className="member-stats-card-label">Total Quotes</div>
        <div className="member-stats-card-value">{stats.totalQuotes}</div>
        <div className="member-stats-card-sub">{stats.wonQuotes} won</div>
      </div>

      <div className="member-stats-card-item">
        <div className="member-stats-card-label">Revenue Collected</div>
        <div className="member-stats-card-value success">{formatCurrency(stats.totalRevenue)}</div>
        <div className="member-stats-card-sub">All time</div>
      </div>

      <div className="member-stats-card-item">
        <div className="member-stats-card-label">This Month — New</div>
        <div className="member-stats-card-value accent">{formatCurrency(stats.currentMonthNew)}</div>
        <div className="member-stats-card-sub">{formatCurrency(stats.currentMonthRenewal)} renewal</div>
      </div>

      {stats.incentive !== null && (
        <div className="member-stats-card-item">
          <div className="member-stats-card-label">Incentive (This Month)</div>
          <div className="member-stats-card-value success">{formatCurrency(stats.incentive)}</div>
          <div className="member-stats-card-sub">
            Salary ₹{Number(profile.monthly_salary || 0).toLocaleString('en-IN')}
          </div>
        </div>
      )}

      <div className="member-stats-card-item">
        <div className="member-stats-card-label">Last Payment Received</div>
        <div className="member-stats-card-value" style={{ fontSize: 14 }}>{formatDate(stats.lastPayment)}</div>
        <div className="member-stats-card-sub">Joined {formatDate(profile.join_date)}</div>
      </div>
    </div>
  )
}
