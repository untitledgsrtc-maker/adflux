// src/components/dashboard/IncentiveLiability.jsx
import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatCompact } from '../../utils/formatters'
import { calculateIncentive } from '../../utils/incentiveCalc'

export function IncentiveLiability() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    const currentMonth = new Date().toISOString().slice(0, 7)

    const [settingsRes, profilesRes, salesRes] = await Promise.all([
      supabase.from('incentive_settings').select('*').single(),
      supabase.from('staff_incentive_profiles').select('*, users(name)').eq('is_active', true),
      supabase.from('monthly_sales_data').select('*').eq('month_year', currentMonth),
    ])

    const settings = settingsRes.data || {}
    const profiles = profilesRes.data || []
    const sales    = salesRes.data    || []

    let totalLiability = 0
    let aboveTarget    = 0
    const breakdown    = []

    for (const p of profiles) {
      const md     = sales.find(s => s.staff_id === p.user_id) || {}
      const result = calculateIncentive({
        monthlySalary:    p.monthly_salary,
        salesMultiplier:  p.sales_multiplier ?? settings.default_multiplier ?? 5,
        newClientRate:    p.new_client_rate  ?? settings.new_client_rate    ?? 0.05,
        renewalRate:      p.renewal_rate     ?? settings.renewal_rate       ?? 0.02,
        flatBonus:        p.flat_bonus       ?? settings.flat_bonus         ?? 10000,
        newClientRevenue: md.new_client_revenue || 0,
        renewalRevenue:   md.renewal_revenue    || 0,
      })
      totalLiability += result.incentive
      if (result.targetExceeded) aboveTarget++
      if (result.incentive > 0) {
        breakdown.push({ name: p.users?.name || '?', incentive: result.incentive })
      }
    }

    setData({ totalLiability, aboveTarget, total: profiles.length, breakdown })
    setLoading(false)
  }

  return (
    <div className="db-card">
      <h3 className="db-card-title">Incentive Liability <span style={{ fontSize: 13 }}>— This Month</span></h3>

      {loading ? (
        <div className="db-loading">Loading…</div>
      ) : !data ? null : (
        <div className="db-liability">
          <div className="db-liability-hero">
            <Wallet size={22} style={{ color: 'var(--accent)' }} />
            <div>
              <div className="db-liability-amount">{formatCompact(data.totalLiability)}</div>
              <div className="db-liability-sub">
                {data.aboveTarget} of {data.total} above target
              </div>
            </div>
          </div>

          {data.breakdown.length > 0 && (
            <div className="db-liability-rows">
              {data.breakdown
                .sort((a, b) => b.incentive - a.incentive)
                .map(r => (
                  <div key={r.name} className="db-liability-row">
                    <span className="db-liability-name">{r.name}</span>
                    <span className="db-liability-val">{formatCurrency(r.incentive)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
