// src/components/incentives/StaffTable.jsx
import { useState } from 'react'
import { Pencil, Flame, Trophy, AlertCircle, IndianRupee } from 'lucide-react'
import { calculateIncentive, calculateStreak, isIncrementEligible } from '../../utils/incentiveCalc'
import { formatCurrency, initials, formatMonthYear } from '../../utils/formatters'

function SlabBar({ pct, slabReached, targetExceeded }) {
  const cls = targetExceeded ? 'target' : slabReached ? 'slab' : 'below'
  return (
    <div className="slab-bar-wrap">
      <div className="slab-bar-track">
        <div
          className={`slab-bar-fill ${cls}`}
          style={{ width: `${Math.min(pct * 100, 100)}%` }}
        />
      </div>
      <div className="slab-bar-labels">
        <span>{Math.round(pct * 100)}% of target</span>
      </div>
    </div>
  )
}

function StreakBadge({ streak, target }) {
  const eligible = isIncrementEligible(streak)
  if (streak === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
  return (
    <span className={`streak-badge ${eligible ? 'increment' : streak >= 3 ? 'fire' : ''}`}>
      {eligible ? <Trophy size={12} /> : <Flame size={12} />}
      {streak}m streak
      {eligible && ' 🎉'}
    </span>
  )
}

export function StaffTable({ profiles, settings, monthlySales, selectedMonth, onEdit, onPayout }) {
  const [expandedId, setExpandedId] = useState(null)

  function getMonthData(staffId) {
    return monthlySales.find(
      m => m.staff_id === staffId && m.month_year === selectedMonth
    )
  }

  function getAllMonthData(staffId) {
    return monthlySales.filter(m => m.staff_id === staffId)
  }

  if (!profiles.length) {
    return (
      <div className="inc-empty">
        <AlertCircle size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
        <p>No staff profiles found. Add team members from the Team page.</p>
      </div>
    )
  }

  return (
    <div className="staff-table-wrap">
      <div className="staff-table-header">
        <span className="staff-table-title">Staff Incentive Profiles</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {formatMonthYear(selectedMonth)}
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="staff-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Salary</th>
              <th>Target</th>
              <th>This Month</th>
              <th>Progress</th>
              <th>Incentive</th>
              <th>Streak</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => {
              const user     = p.users || {}
              const md       = getMonthData(p.user_id)
              const allMd    = getAllMonthData(p.user_id)
              const salary   = p.monthly_salary || 0
              const multiplier = p.sales_multiplier || settings?.default_multiplier || 5
              const target   = salary * multiplier

              const result = calculateIncentive({
                monthlySalary:    salary,
                salesMultiplier:  multiplier,
                newClientRate:    p.new_client_rate  ?? settings?.new_client_rate  ?? 0.05,
                renewalRate:      p.renewal_rate     ?? settings?.renewal_rate     ?? 0.02,
                flatBonus:        p.flat_bonus       ?? settings?.default_flat_bonus ?? settings?.flat_bonus ?? 10000,
                newClientRevenue: md?.new_client_revenue || 0,
                renewalRevenue:   md?.renewal_revenue    || 0,
              })

              const streak = calculateStreak(allMd, target)
              const eligible = isIncrementEligible(streak)

              return (
                <tr
                  key={p.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                >
                  <td>
                    <div className="staff-name-cell">
                      <div className="staff-avatar">{initials(user.name || '?')}</div>
                      <div>
                        <div className="staff-name">{user.name || '—'}</div>
                        <div className="staff-email">{user.email || ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>{salary ? formatCurrency(salary) : <span style={{ color: 'var(--text-muted)' }}>Not set</span>}</td>
                  <td>{target ? formatCurrency(target) : '—'}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>
                      {formatCurrency(result.total)}
                    </div>
                    {md && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        New: {formatCurrency(md.new_client_revenue)} / Ren: {formatCurrency(md.renewal_revenue)}
                      </div>
                    )}
                  </td>
                  <td>
                    <SlabBar
                      pct={result.progressToTarget}
                      slabReached={result.slabReached}
                      targetExceeded={result.targetExceeded}
                    />
                  </td>
                  <td>
                    <span style={{
                      fontWeight: 700,
                      color: result.incentive > 0 ? 'var(--success)' : 'var(--text-muted)',
                      fontSize: 14,
                    }}>
                      {result.incentive > 0 ? formatCurrency(result.incentive) : '—'}
                    </span>
                    {result.targetExceeded && (
                      <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                        +{formatCurrency(result.flatBonus)} bonus
                      </div>
                    )}
                  </td>
                  <td>
                    <StreakBadge streak={streak} />
                    {eligible && (
                      <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                        Increment eligible
                      </div>
                    )}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        onClick={() => onEdit(p)}
                        title="Edit profile"
                      >
                        <Pencil size={13} style={{ marginRight: 4 }} />
                        Edit
                      </button>
                      {onPayout && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '5px 10px', fontSize: 12 }}
                          onClick={() => onPayout(p, result.incentive)}
                          title="Record incentive payout"
                        >
                          <IndianRupee size={13} style={{ marginRight: 4 }} />
                          Payout
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
