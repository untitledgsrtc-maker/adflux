// src/components/incentives/IncentiveMiniPill.jsx
//
// Phase 34M — top-bar incentive mini-pill.
//
// Audit decision (13 May): make rep's incentive permanently visible
// so every screen reminds them what they're playing for. Pulls the
// rep's incentive profile + this-month revenue, runs the existing
// calculateIncentive, and renders a single yellow pill with the
// projected incentive + % to target.
//
// Tap → /my-performance.
//
// Hidden for admin / co-owner — they see broader liability views
// on /incentives. Visible for sales / agency / telecaller.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, IndianRupee } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { calculateIncentive } from '../../utils/incentiveCalc'

function monthYearISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatShort(n) {
  if (!Number.isFinite(n)) return '0'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L'
  if (n >= 1000)   return '₹' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return '₹' + Math.round(n)
}

export default function IncentiveMiniPill() {
  const navigate = useNavigate()
  const profile  = useAuthStore((s) => s.profile)
  const [calc,    setCalc]    = useState(null)
  const [loading, setLoading] = useState(true)

  const role = profile?.role || profile?.team_role
  const isRep = role === 'sales' || role === 'agency' || role === 'telecaller'

  useEffect(() => {
    if (!isRep || !profile?.id) { setLoading(false); return }
    let cancelled = false
    Promise.all([
      supabase.from('staff_incentive_profiles')
        .select('*').eq('user_id', profile.id).maybeSingle(),
      supabase.from('monthly_sales_data')
        .select('new_client_revenue, renewal_revenue')
        .eq('user_id', profile.id).eq('month_year', monthYearISO())
        .maybeSingle(),
    ]).then(([profRes, monthRes]) => {
      if (cancelled) return
      if (!profRes.data) { setLoading(false); return }
      const c = calculateIncentive({
        monthlySalary:    Number(profRes.data.monthly_salary || 0),
        salesMultiplier:  Number(profRes.data.sales_multiplier || 5),
        newClientRate:    Number(profRes.data.new_client_rate || 0.05),
        renewalRate:      Number(profRes.data.renewal_rate || 0.02),
        flatBonus:        Number(profRes.data.flat_bonus || 10000),
        newClientRevenue: Number(monthRes.data?.new_client_revenue || 0),
        renewalRevenue:   Number(monthRes.data?.renewal_revenue || 0),
      })
      setCalc(c)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [isRep, profile?.id])

  if (!isRep || loading || !calc) return null

  const pctToTarget = Math.min(100, Math.round((calc.progressToTarget || 0) * 100))
  const isSlabReached = !!calc.slabReached
  const accent = isSlabReached
    ? 'var(--success, #10B981)'
    : 'var(--accent, #FFE600)'

  return (
    <button
      type="button"
      onClick={() => navigate('/my-performance')}
      title={isSlabReached
        ? `Incentive earned this month: ${formatShort(calc.incentive)}. ${pctToTarget}% to target.`
        : `Slab not reached. ${formatShort(Math.max(0, calc.threshold - calc.total))} more revenue to unlock incentive. ${pctToTarget}% to target.`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${accent}`,
        color: 'var(--v2-ink-0, #f5f7fb)',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <IndianRupee size={12} color={accent} strokeWidth={2} />
      <span style={{ color: accent }}>{formatShort(calc.incentive)}</span>
      <span style={{ color: 'var(--v2-ink-2, #6a7590)', fontSize: 11, fontWeight: 500 }}>
        · {pctToTarget}%
      </span>
      <TrendingUp size={11} color="var(--v2-ink-2, #6a7590)" strokeWidth={1.6} />
    </button>
  )
}
