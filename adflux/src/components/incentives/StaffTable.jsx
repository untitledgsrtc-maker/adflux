// src/components/incentives/StaffTable.jsx
import { useState } from 'react'
import { Pencil, Flame, Trophy, AlertCircle, IndianRupee } from 'lucide-react'
import { calculateIncentive, calculateStreak, isIncrementEligible } from '../../utils/incentiveCalc'
import { formatCurrency, initials, formatMonthYear } from '../../utils/formatters'

function SlabBar({ pct, slabReached, targetExceeded }) {
  // Phase 21a — pct is earned/target. When target is 0 (not configured)
  // pct is NaN, which used to render as "NaN% of target". Guard so we
  // show "Not set" instead and keep the bar empty.
  const safePct = Number.isFinite(pct) ? pct : 0
  const noTarget = !Number.isFinite(pct)
  const cls = targetExceeded ? 'target' : slabReached ? 'slab' : 'below'
  return (
    <div className="slab-bar-wrap">
      <div className="slab-bar-track">
        <div
          className={`slab-bar-fill ${cls}`}
          style={{ width: `${Math.min(safePct * 100, 100)}%` }}
        />
      </div>
      <div className="slab-bar-labels">
        <span>
          {noTarget ? 'Target not set' : `${Math.round(safePct * 100)}% of target`}
        </span>
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

export function StaffTable({ profiles, settings, monthlySales, selectedMonth, proposedInputs = {}, onEdit, onPayout }) {
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

              const cfg = {
                monthlySalary:    salary,
                salesMultiplier:  multiplier,
                newClientRate:    p.new_client_rate  ?? settings?.new_client_rate  ?? 0.05,
                renewalRate:      p.renewal_rate     ?? settings?.renewal_rate     ?? 0.02,
                flatBonus:        p.flat_bonus       ?? settings?.default_flat_bonus ?? settings?.flat_bonus ?? 10000,
              }
              const result = calculateIncentive({
                ...cfg,
                newClientRevenue: md?.new_client_revenue || 0,
                renewalRevenue:   md?.renewal_revenue    || 0,
              })
              // Proposed = Earned + open pipeline + won-unsettled.
              // Lets admin see what each rep is "in for" before
              // payments clear. Shown next to the earned number when
              // there's a forecast lift; suppressed otherwise.
              const prop = proposedInputs[p.user_id] || { openNew: 0, openRen: 0, wuNew: 0, wuRen: 0 }
              const proposed = calculateIncentive({
                ...cfg,
                newClientRevenue: (md?.new_client_revenue || 0) + prop.openNew + prop.wuNew,
                renewalRevenue:   (md?.renewal_revenue    || 0) + prop.openRen + prop.wuRen,
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
                  <td style={monoCell}>{salary ? formatCurrency(salary) : <span style={{ color: 'var(--v2-ink-2)', fontFamily: 'inherit' }}>Not set</span>}</td>
                  <td style={monoCell}>{target ? formatCurrency(target) : '—'}</td>
                  <td style={monoCell}>
                    <div style={{ fontSize: 13 }}>
                      {formatCurrency(result.total)}
                    </div>
                    {md && (
                      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2, fontFamily: 'inherit' }}>
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
                  <td style={monoCell}>
                    <span style={{
                      fontFamily: 'var(--font-mono, JetBrains Mono, monospace)',
                      fontWeight: 700,
                      color: result.incentive > 0 ? 'var(--v2-green, var(--success))' : 'var(--v2-ink-2)',
                      fontSize: 14,
                    }}>
                      {result.incentive > 0 ? formatCurrency(result.incentive) : '—'}
                    </span>
                    {/* Proposed line — only when there's a forecast
                        lift (rep has open pipeline or won-unsettled).
                        Otherwise it'd just echo the earned number. */}
                    {proposed.incentive > result.incentive && (
                      <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                        Proposed: {formatCurrency(proposed.incentive)}
                      </div>
                    )}
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
                    {/* Phase 40 — mini-chip buttons matching Salary
                        tab Payout style exactly. */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => onEdit(p)}
                        title="Edit profile"
                        style={miniGhostStyle}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      {onPayout && (
                        <button
                          onClick={() => onPayout(p, result.incentive)}
                          title="Record incentive payout"
                          style={miniBtnStyle}
                        >
                          <IndianRupee size={12} /> Payout
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

// Phase 40 — mono font on currency cells (matches Salary tab tdNum).
const monoCell = { fontFamily: 'var(--font-mono, JetBrains Mono, monospace)' }

// Phase 40 — mini-chip buttons matching SalaryAdminV2 spec
// (padding 5/10, 11/700, radius 6, JetBrains Mono fallback safe).
const miniBtnStyle = {
  background: 'var(--v2-yellow, #FFE600)', border: 'none',
  color: '#0a0e1a', padding: '5px 10px', fontSize: 11, fontWeight: 700,
  borderRadius: 6, cursor: 'pointer', display: 'inline-flex',
  alignItems: 'center', gap: 4, fontFamily: 'inherit',
}
const miniGhostStyle = {
  ...miniBtnStyle,
  background: 'transparent',
  border: '1px solid var(--v2-line, #1f2a44)',
  color: 'var(--v2-ink-1, #cdd5e2)',
}
