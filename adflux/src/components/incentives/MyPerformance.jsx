// src/components/incentives/MyPerformance.jsx
import { useEffect, useState } from 'react'
import { Flame, Trophy, TrendingUp, ChevronDown, CalendarDays } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useIncentive } from '../../hooks/useIncentive'
import { useAuthStore } from '../../store/authStore'
import { calculateIncentive, calculateStreak, isIncrementEligible } from '../../utils/incentiveCalc'
import { formatCurrency, formatMonthYear, initials } from '../../utils/formatters'

function buildMonthOptions(count = 12) {
  const opts = []
  const now  = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opts.push(val)
  }
  return opts
}

export function MyPerformance() {
  const profile = useAuthStore(s => s.profile)
  const {
    settings,
    monthlySales,
    fetchSettings,
    fetchProfileForUser,
    fetchMonthlySales,
  } = useIncentive()

  const [myProfile,  setMyProfile]  = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [activeCampaigns, setActiveCampaigns] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const monthOptions = buildMonthOptions()

  useEffect(() => {
    async function load() {
      setLoading(true)
      await fetchSettings()
      if (profile?.id) {
        const { data } = await fetchProfileForUser(profile.id)
        setMyProfile(data)
        await fetchMonthlySales(profile.id, 24)

        const today = new Date().toISOString().slice(0, 10)
        const { data: camps } = await supabase
          .from('quotes')
          .select('id, quote_number, client_name, total_amount, campaign_start_date, campaign_end_date')
          .eq('created_by', profile.id)
          .eq('status', 'won')
          .gte('campaign_end_date', today)
          .order('campaign_end_date', { ascending: true })
        setActiveCampaigns(camps || [])
      }
      setLoading(false)
    }
    load()
  }, [profile?.id])

  if (loading) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 32 }}>
        Loading your performance data…
      </div>
    )
  }

  if (!myProfile) {
    return (
      <div className="perf-page">
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 32,
          color: 'var(--text-muted)',
          fontSize: 13,
          textAlign: 'center',
        }}>
          Your incentive profile hasn't been set up yet. Ask your admin to configure it from the Team page.
        </div>
      </div>
    )
  }

  const salary     = myProfile.monthly_salary || 0
  const multiplier = myProfile.sales_multiplier || settings?.default_multiplier || 5
  const target     = salary * multiplier
  const threshold  = salary * 2

  // Selected month data
  const md = monthlySales.find(m => m.month_year === selectedMonth)

  const result = calculateIncentive({
    monthlySalary:    salary,
    salesMultiplier:  multiplier,
    newClientRate:    myProfile.new_client_rate ?? settings?.new_client_rate ?? 0.05,
    renewalRate:      myProfile.renewal_rate    ?? settings?.renewal_rate    ?? 0.02,
    flatBonus:        myProfile.flat_bonus      ?? settings?.flat_bonus      ?? 10000,
    newClientRevenue: md?.new_client_revenue || 0,
    renewalRevenue:   md?.renewal_revenue    || 0,
  })

  const streak   = calculateStreak(monthlySales, target)
  const eligible = isIncrementEligible(streak)

  // Progress fill class
  const fillClass = result.targetExceeded ? 'target' : result.slabReached ? 'between' : 'below'

  return (
    <div className="perf-page">
      {/* Hero */}
      <div className="perf-hero">
        <div className="perf-hero-avatar">{initials(profile?.name || '?')}</div>
        <div>
          <p className="perf-hero-name">{profile?.name}</p>
          <p className="perf-hero-sub">
            Salary: {formatCurrency(salary)} &nbsp;·&nbsp;
            Target: {formatCurrency(target)} &nbsp;·&nbsp;
            Threshold: {formatCurrency(threshold)}
          </p>
        </div>
      </div>

      {/* Streak banner */}
      {streak > 0 && (
        <div className={`perf-streak-banner${eligible ? ' increment' : ''}`}>
          {eligible ? <Trophy size={18} color="var(--success)" /> : <Flame size={18} color="var(--warning)" />}
          <span>
            {eligible
              ? <>You've hit your target for <strong>{streak} consecutive months</strong> — you're eligible for an increment review! 🎉</>
              : <>You're on a <strong>{streak}-month streak</strong> above target. Keep it up!</>
            }
          </span>
        </div>
      )}

      {/* Current month card */}
      <div className="perf-month-card">
        <div className="perf-month-header">
          <span className="perf-month-title">Monthly Performance</span>
          <select
            className="perf-month-select"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            {monthOptions.map(m => (
              <option key={m} value={m}>{formatMonthYear(m)}</option>
            ))}
          </select>
        </div>

        {/* Progress to threshold */}
        <div className="perf-progress-section">
          <div className="perf-progress-label">
            <span>Progress to threshold ({formatCurrency(threshold)})</span>
            <span>{Math.round(result.progressToThreshold * 100)}%</span>
          </div>
          <div className="perf-progress-track">
            <div
              className={`perf-progress-fill ${fillClass}`}
              style={{ width: `${result.progressToThreshold * 100}%` }}
            />
          </div>
        </div>

        {/* Progress to target */}
        <div className="perf-progress-section">
          <div className="perf-progress-label">
            <span>Progress to target ({formatCurrency(target)})</span>
            <span>{Math.round(result.progressToTarget * 100)}%</span>
          </div>
          <div className="perf-progress-track">
            <div
              className={`perf-progress-fill ${fillClass}`}
              style={{ width: `${result.progressToTarget * 100}%` }}
            />
          </div>
        </div>

        {/* Breakdown */}
        <div className="perf-breakdown-grid">
          <div className="perf-breakdown-item">
            <div className="perf-breakdown-label">New Clients</div>
            <div className="perf-breakdown-value">{formatCurrency(md?.new_client_revenue || 0)}</div>
          </div>
          <div className="perf-breakdown-item">
            <div className="perf-breakdown-label">Renewals</div>
            <div className="perf-breakdown-value">{formatCurrency(md?.renewal_revenue || 0)}</div>
          </div>
          <div className="perf-breakdown-item">
            <div className="perf-breakdown-label">Total Revenue</div>
            <div className="perf-breakdown-value">{formatCurrency(result.total)}</div>
          </div>
          <div className="perf-breakdown-item" style={{ border: '1px solid var(--accent)' }}>
            <div className="perf-breakdown-label">Incentive Earned</div>
            <div className={`perf-breakdown-value${result.incentive > 0 ? ' accent' : ''}`}>
              {result.incentive > 0 ? formatCurrency(result.incentive) : '—'}
            </div>
            {!result.slabReached && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Need {formatCurrency(threshold - result.total)} more to unlock
              </div>
            )}
            {result.targetExceeded && (
              <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                Includes ₹{Number(result.flatBonus || 0).toLocaleString('en-IN')} bonus!
              </div>
            )}
          </div>
        </div>

        {/* Slab status */}
        {!result.slabReached && result.total > 0 && (
          <div style={{
            marginTop: 14,
            padding: '10px 14px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
          }}>
            You need <strong style={{ color: 'var(--text)' }}>{formatCurrency(threshold - result.total)}</strong> more in revenue to reach the incentive threshold this month.
          </div>
        )}
        {result.slabReached && !result.targetExceeded && (
          <div style={{
            marginTop: 14,
            padding: '10px 14px',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
          }}>
            You're earning incentive! Add <strong style={{ color: 'var(--text)' }}>{formatCurrency(target - result.total)}</strong> more to hit your target and unlock the <strong style={{ color: 'var(--accent)' }}>{formatCurrency(myProfile.flat_bonus ?? settings?.flat_bonus ?? 10000)}</strong> flat bonus.
          </div>
        )}
      </div>

      {/* Active campaigns */}
      <div className="perf-history-card">
        <div className="perf-history-header">
          <CalendarDays size={16} color="var(--accent)" />
          My Active Campaigns
          {activeCampaigns.length > 0 && (
            <span style={{
              marginLeft: 8, background: 'rgba(255,230,0,.15)', color: 'var(--accent)',
              borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 700,
            }}>{activeCampaigns.length}</span>
          )}
        </div>
        {activeCampaigns.length === 0 ? (
          <div style={{ padding: '16px 8px', color: 'var(--text-muted)', fontSize: 13 }}>
            No active campaigns right now. Won quotes with campaign dates show up here.
          </div>
        ) : (
          <table className="perf-history-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Quote #</th>
                <th>Start</th>
                <th>End</th>
                <th>Days Left</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {activeCampaigns.map(c => {
                const today = new Date()
                const end   = new Date(c.campaign_end_date)
                const days  = Math.max(0, Math.round((end - today) / 86400000))
                const color = days <= 3 ? 'var(--danger, #ef5350)' : days <= 7 ? 'var(--warning, #ffb74d)' : days <= 30 ? 'var(--accent)' : 'var(--success, #81c784)'
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.client_name}</td>
                    <td>{c.quote_number}</td>
                    <td>{c.campaign_start_date || '—'}</td>
                    <td>{c.campaign_end_date || '—'}</td>
                    <td style={{ color, fontWeight: 700 }}>{days}</td>
                    <td>{formatCurrency(c.total_amount || 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* History table */}
      <div className="perf-history-card">
        <div className="perf-history-header">
          <TrendingUp size={16} color="var(--accent)" />
          Performance History (Last 12 Months)
        </div>
        <table className="perf-history-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>New Clients</th>
              <th>Renewals</th>
              <th>Total</th>
              <th>Incentive</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {monthlySales.slice(0, 12).map(row => {
              const r = calculateIncentive({
                monthlySalary:    salary,
                salesMultiplier:  multiplier,
                newClientRate:    myProfile.new_client_rate ?? settings?.new_client_rate ?? 0.05,
                renewalRate:      myProfile.renewal_rate    ?? settings?.renewal_rate    ?? 0.02,
                flatBonus:        myProfile.flat_bonus      ?? settings?.flat_bonus      ?? 10000,
                newClientRevenue: row.new_client_revenue || 0,
                renewalRevenue:   row.renewal_revenue    || 0,
              })
              return (
                <tr key={row.id}>
                  <td style={{ fontWeight: 600 }}>{formatMonthYear(row.month_year)}</td>
                  <td>{formatCurrency(row.new_client_revenue || 0)}</td>
                  <td>{formatCurrency(row.renewal_revenue    || 0)}</td>
                  <td>{formatCurrency(r.total)}</td>
                  <td style={{ color: r.incentive > 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: r.incentive > 0 ? 700 : 400 }}>
                    {r.incentive > 0 ? formatCurrency(r.incentive) : '—'}
                  </td>
                  <td>
                    {r.targetExceeded
                      ? <span style={{ color: 'var(--success)', fontSize: 12 }}>🏆 Target hit</span>
                      : r.slabReached
                      ? <span style={{ color: 'var(--warning)', fontSize: 12 }}>✓ Threshold</span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Below threshold</span>
                    }
                  </td>
                </tr>
              )
            })}
            {monthlySales.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                  No payment data yet. Incentives are credited when a final payment is recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
