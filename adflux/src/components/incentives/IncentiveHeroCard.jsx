// src/components/incentives/IncentiveHeroCard.jsx
//
// Phase 34Z.2 (13 May 2026) — owner audit:
//
//   "I want big hero card of incentive here, but you not understand
//    before. I also said it, but you not do it."
//
// IncentiveMiniPill (topbar) is fine as a global persistent badge,
// but on /work the rep wants the incentive to land as a real hero
// strip — V2Hero gradient, big number, slab progress chip — not as
// a 80 px-wide yellow capsule. This component renders the same
// calculateIncentive result via the standard V2Hero layout, so it
// inherits the brand teal gradient + pulsing yellow dot + chip
// pattern already used everywhere else.
//
// Where to mount: directly under the topbar inside /work for sales
// / agency / telecaller. Auto-hides for admin / co_owner (they see
// /incentives instead). Returns null while loading or for users
// without a `staff_incentive_profiles` row so we don't flash an
// empty card.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { calculateIncentive } from '../../utils/incentiveCalc'
import V2Hero from '../v2/V2Hero'

function monthYearISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatRupees(n) {
  if (!Number.isFinite(n) || n <= 0) return '₹0'
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2).replace(/\.00$/, '') + ' Cr'
  if (n >= 100000)   return '₹' + (n / 100000).toFixed(2).replace(/\.00$/, '') + ' L'
  if (n >= 1000)     return '₹' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return '₹' + Math.round(n)
}

export default function IncentiveHeroCard() {
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

  const pctToTarget   = Math.min(100, Math.round((calc.progressToTarget || 0) * 100))
  const isSlabReached = !!calc.slabReached
  const totalRevenue  = Number(calc.total || 0)
  const incentive     = Number(calc.incentive || 0)
  const remainingToSlab = Math.max(0, Number(calc.threshold || 0) - totalRevenue)

  // Tap whole card → /my-performance for the deep dive.
  return (
    <div onClick={() => navigate('/my-performance')} style={{ cursor: 'pointer' }}>
      <V2Hero
        eyebrow={isSlabReached ? 'Incentive · slab reached' : 'Incentive · this month'}
        value={formatRupees(incentive)}
        label={isSlabReached
          ? `${formatRupees(totalRevenue)} revenue logged`
          : `${formatRupees(remainingToSlab)} more revenue to unlock slab`}
        chip={`${pctToTarget}% to ${isSlabReached ? 'target' : 'slab'}`}
        accent={isSlabReached}
        right={{
          tone: isSlabReached ? 'up' : (pctToTarget >= 50 ? 'up' : 'down'),
          text: isSlabReached ? 'on track' : (pctToTarget >= 50 ? 'closing in' : 'push harder'),
        }}
      />
    </div>
  )
}
