// src/components/incentives/IncentiveDashboard.jsx
import { useEffect, useState } from 'react'
import { Trophy, TrendingUp, Users, IndianRupee, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { useIncentive } from '../../hooks/useIncentive'
import { useTeam } from '../../hooks/useTeam'
import { calculateIncentive, calculateStreak, isIncrementEligible } from '../../utils/incentiveCalc'
import { formatCurrency, formatMonthYear } from '../../utils/formatters'
import { StaffTable } from './StaffTable'
import { StaffModal } from './StaffModal'
import { WhatIfSimulator } from './WhatIfSimulator'
import { IncentiveSettings } from './IncentiveSettings'

// Build last 12 month options
function buildMonthOptions() {
  const opts = []
  const now  = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push(val)
  }
  return opts
}

export function IncentiveDashboard() {
  const { settings, profiles, monthlySales, fetchSettings, fetchProfiles, fetchMonthlySales } = useIncentive()
  const { members, fetchMembers } = useTeam()

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [activeTab, setActiveTab]   = useState('staff')
  const [editProfile, setEditProfile] = useState(null)
  const [loading, setLoading]       = useState(true)

  const monthOptions = buildMonthOptions()

  useEffect(() => {
    async function load() {
      setLoading(true)
      await Promise.all([fetchSettings(), fetchProfiles(), fetchMembers()])
      await fetchMonthlySales(null, 24)
      setLoading(false)
    }
    load()
  }, [])

  // Merge profiles with member info (profiles join users already from fetchProfiles)
  // Flatten: each profile has users embedded
  const salesProfiles = profiles.filter(p => p.users?.is_active)

  // Summary for selected month
  const monthData = monthlySales.filter(m => m.month_year === selectedMonth)

  let totalIncentive   = 0
  let staffAboveTarget = 0
  let incrementEligible = []

  salesProfiles.forEach(p => {
    const md = monthData.find(m => m.staff_id === p.user_id)
    const salary = p.monthly_salary || 0
    const multiplier = p.sales_multiplier || settings?.default_multiplier || 5
    const target = salary * multiplier
    const result = calculateIncentive({
      monthlySalary:    salary,
      salesMultiplier:  multiplier,
      newClientRate:    p.new_client_rate ?? settings?.new_client_rate ?? 0.05,
      renewalRate:      p.renewal_rate    ?? settings?.renewal_rate    ?? 0.02,
      flatBonus:        p.flat_bonus      ?? settings?.flat_bonus      ?? 10000,
      newClientRevenue: md?.new_client_revenue || 0,
      renewalRevenue:   md?.renewal_revenue    || 0,
    })
    totalIncentive += result.incentive
    if (result.targetExceeded) staffAboveTarget++

    const allMd = monthlySales.filter(m => m.staff_id === p.user_id)
    const streak = calculateStreak(allMd, target)
    if (isIncrementEligible(streak)) {
      incrementEligible.push({ name: p.users?.name, streak })
    }
  })

  const totalRevenue = monthData.reduce(
    (s, m) => s + (m.new_client_revenue || 0) + (m.renewal_revenue || 0), 0
  )

  return (
    <div>
      {/* Month selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Viewing:</span>
        <div className="month-picker-row">
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{formatMonthYear(m)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Increment alerts */}
      {incrementEligible.length > 0 && (
        <div className="increment-alert-banner">
          <Trophy size={20} className="increment-alert-icon" />
          <div className="increment-alert-text">
            <strong>Increment Alert:</strong>{' '}
            {incrementEligible.map(e => e.name).join(', ')} {incrementEligible.length === 1 ? 'has' : 'have'} hit 6+ consecutive months above target.
            {' '}Consider scheduling a salary review.
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="inc-summary-grid">
        <div className="inc-summary-card">
          <p className="inc-summary-label">Total Revenue</p>
          <div className="inc-summary-value">{formatCurrency(totalRevenue)}</div>
          <div className="inc-summary-sub">{formatMonthYear(selectedMonth)}</div>
        </div>
        <div className="inc-summary-card">
          <p className="inc-summary-label">Total Incentive</p>
          <div className="inc-summary-value accent">{formatCurrency(totalIncentive)}</div>
          <div className="inc-summary-sub">Liability this month</div>
        </div>
        <div className="inc-summary-card">
          <p className="inc-summary-label">Above Target</p>
          <div className="inc-summary-value success">{staffAboveTarget}</div>
          <div className="inc-summary-sub">of {salesProfiles.length} staff</div>
        </div>
        <div className="inc-summary-card">
          <p className="inc-summary-label">Increment Eligible</p>
          <div className="inc-summary-value warning">{incrementEligible.length}</div>
          <div className="inc-summary-sub">6+ month streak</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="inc-tabs">
        {[
          { key: 'staff',    label: 'Staff Profiles' },
          { key: 'simulator', label: 'What-If Simulator' },
          { key: 'settings', label: 'Settings' },
        ].map(t => (
          <button
            key={t.key}
            className={`inc-tab${activeTab === t.key ? ' active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : activeTab === 'staff' ? (
        <StaffTable
          profiles={salesProfiles}
          settings={settings}
          monthlySales={monthlySales}
          selectedMonth={selectedMonth}
          onEdit={p => {
            // Find the full member to pass to StaffModal
            const m = members.find(mem => mem.id === p.user_id) || p.users || {}
            setEditProfile({ ...p, _member: { ...m, staff_incentive_profiles: [p] } })
          }}
        />
      ) : activeTab === 'simulator' ? (
        <WhatIfSimulator profiles={salesProfiles} settings={settings} />
      ) : (
        <IncentiveSettings />
      )}

      {/* Staff edit modal */}
      {editProfile && (
        <StaffModal
          member={editProfile._member}
          settings={settings}
          onClose={() => setEditProfile(null)}
          onSaved={() => {
            fetchProfiles()
            setEditProfile(null)
          }}
        />
      )}
    </div>
  )
}
