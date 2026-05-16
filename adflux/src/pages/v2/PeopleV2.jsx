// src/pages/v2/PeopleV2.jsx
//
// Phase 38 — People module.
//
// Owner directive (17 May 2026): "can we merge this 4 module in 1 becas
// all same data repeting?" + "i want incentive page ui its looking so
// perfect" + "make sure all function shuld not be chnaged".
//
// Consolidates 4 separate admin pages into a single People module with
// sub-tabs. Mounts the existing pages as-is — zero functional change,
// every RPC + modal + column preserved. Just chrome.
//
// Tabs (in order):
//   1. Team        → TeamV2
//   2. Incentives  → IncentivesV2
//   3. Salary      → SalaryAdminV2
//   4. Leaves      → LeavesAdminV2
//
// State lives in the URL (`?tab=team|incentives|salary|leaves`) so
// deep-links work and back/forward navigation feels right. Default
// tab = 'team'.
//
// Role gate: admin / co_owner only. Reps land here only via direct URL
// and bounce to /dashboard.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Users, Wallet, Clock as ClockIcon, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

import TeamV2            from './TeamV2'
import SalaryAdminV2     from './SalaryAdminV2'
import LeavesAdminV2     from './LeavesAdminV2'
// Phase 39 — TA Claims tab. Incentive tab dropped; incentive slabs +
// what-if simulator + staff profile editor still reachable via the
// /incentives deep-link (kept in App.jsx, no sidebar entry).
import TaPayoutsAdminV2  from './TaPayoutsAdminV2'

// Phase 38.2 — IST month label for the Salary tab badge.
function currentMonthLabel() {
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000)
  return ist.toLocaleString('en-IN', { month: 'short', year: 'numeric' })
}

// Phase 39 — 4 tabs: Team · Salary · Leaves · TA Claims. Incentives
// tab dropped (was its own payout flow — owner reported confusion
// from accounts paying both incentive and salary separately). All
// money now flows through Salary NET — single payout per rep/month.
const TABS = [
  { key: 'team',     label: 'Team',      icon: Users,     Comp: TeamV2 },
  { key: 'salary',   label: 'Salary',    icon: Wallet,    Comp: SalaryAdminV2 },
  { key: 'leaves',   label: 'Leaves',    icon: ClockIcon, Comp: LeavesAdminV2 },
  { key: 'ta',       label: 'TA Claims', icon: MapPin,    Comp: TaPayoutsAdminV2 },
]

export default function PeopleV2() {
  const navigate = useNavigate()
  const profile  = useAuthStore(s => s.profile)
  const isAdmin  = ['admin', 'co_owner'].includes(profile?.role)

  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') || 'team'
  const active = useMemo(
    () => TABS.find(t => t.key === requested) || TABS[0],
    [requested]
  )

  // Phase 38.2 — live counts for tab badges. Two cheap COUNT queries
  // + one constant string. Loaded once on mount; non-blocking.
  const [counts, setCounts] = useState({ team: null, leaves: null, ta: null, salary: currentMonthLabel() })
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    async function loadCounts() {
      const [teamRes, leavesRes, taRes] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true })
          .in('role', ['sales', 'agency', 'telecaller', 'admin', 'co_owner'])
          .eq('is_active', true),
        supabase.from('leaves').select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
        // Phase 39 — TA Claims pending count for the TA tab badge.
        supabase.from('ta_da_requests').select('id', { count: 'exact', head: true })
          .eq('status', 'pending'),
      ])
      if (cancelled) return
      setCounts(c => ({
        ...c,
        team:   teamRes.count   ?? null,
        leaves: leavesRes.count ?? null,
        ta:     taRes.count     ?? null,
      }))
    }
    loadCounts()
    return () => { cancelled = true }
  }, [isAdmin])

  useEffect(() => {
    if (profile && !isAdmin) navigate('/dashboard', { replace: true })
  }, [profile, isAdmin, navigate])

  if (!isAdmin) return null

  const ActiveComp = active.Comp

  return (
    <div className="v2d-people" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Module head — shared. Each tab still shows its own page-head
          underneath as a section sub-head, which keeps it clear which
          surface you're in. */}
      <div className="v2d-page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="v2d-page-kicker">HR · Payroll · Compensation</div>
          <h1 className="v2d-page-title">People</h1>
          <div className="v2d-page-sub">
            One place for everything that touches your team — profile, monthly
            score, salary breakdown, payout history, leave roster.
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--v2-line, #1f2a44)',
          marginBottom: 22,
          overflowX: 'auto',
        }}
      >
        {TABS.map(t => {
          const Icon = t.icon
          const on = t.key === active.key
          // Phase 38.2 — badge content per tab.
          let badge = null
          if (t.key === 'team'   && counts.team   != null) badge = String(counts.team)
          if (t.key === 'salary')                          badge = counts.salary
          if (t.key === 'leaves' && counts.leaves != null) badge = counts.leaves > 0 ? `${counts.leaves} pending` : null
          if (t.key === 'ta'     && counts.ta     != null) badge = counts.ta     > 0 ? `${counts.ta} pending`     : null
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('tab', t.key)
                setParams(next, { replace: false })
              }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '11px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2, #8b95ad)',
                cursor: 'pointer',
                borderBottom: on
                  ? '2px solid var(--v2-yellow, #FFE600)'
                  : '2px solid transparent',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'color 120ms ease',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.color = 'var(--v2-ink-1, #cdd5e2)' }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.color = 'var(--v2-ink-2, #8b95ad)' }}
            >
              <Icon size={14} strokeWidth={1.6} />
              {t.label}
              {badge && (
                <span style={{
                  fontFamily: 'var(--font-mono, JetBrains Mono, monospace)',
                  fontSize: 10,
                  background: on ? 'var(--v2-yellow-soft, rgba(255,230,0,.14))' : 'var(--v2-bg-2, #141b2d)',
                  border: '1px solid',
                  borderColor: on ? 'transparent' : 'var(--v2-line, #1f2a44)',
                  color: on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2, #8b95ad)',
                  padding: '2px 6px',
                  borderRadius: 999,
                  whiteSpace: 'nowrap',
                }}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Active tab content — render the existing page in `embedded`
          mode so it suppresses its own page-head (the "People" head
          above is the only one). Mount via key so switching tabs
          unmounts the previous one (frees in-flight Supabase requests
          + resets local state). */}
      <div key={active.key}>
        <ActiveComp embedded />
      </div>
    </div>
  )
}
