// src/components/incentives/WhatIfSimulator.jsx
import { useState, useMemo } from 'react'
import { Sliders } from 'lucide-react'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { formatCurrency, formatPercent } from '../../utils/formatters'

export function WhatIfSimulator({ profiles, settings }) {
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [newRevenue,    setNewRevenue]    = useState(0)
  const [renewalRevenue, setRenewalRevenue] = useState(0)

  const profile = profiles.find(p => p.id === selectedProfileId) || profiles[0] || null
  const salary  = profile?.monthly_salary || 30000
  const multiplier = profile?.sales_multiplier || settings?.default_multiplier || 5
  const target  = salary * multiplier
  const maxSlider = Math.ceil(target * 1.5 / 10000) * 10000

  const result = useMemo(() => {
    if (!profile) return null
    return calculateIncentive({
      monthlySalary:    salary,
      salesMultiplier:  multiplier,
      newClientRate:    profile.new_client_rate ?? settings?.new_client_rate ?? 0.05,
      renewalRate:      profile.renewal_rate    ?? settings?.renewal_rate    ?? 0.02,
      flatBonus:        profile.flat_bonus      ?? settings?.flat_bonus      ?? 10000,
      newClientRevenue: newRevenue,
      renewalRevenue:   renewalRevenue,
    })
  }, [profile, newRevenue, renewalRevenue, settings])

  const threshold = salary * 2

  return (
    <div className="whatif-card">
      <div className="whatif-header">
        <Sliders size={18} color="var(--accent)" />
        <h3>What-If Simulator</h3>
      </div>

      {/* Profile picker */}
      {profiles.length > 0 && (
        <div className="staff-field" style={{ marginBottom: 20, maxWidth: 280 }}>
          <label className="staff-label">Select Staff Member</label>
          <select
            className="staff-input"
            value={selectedProfileId || profile?.id || ''}
            onChange={e => setSelectedProfileId(e.target.value)}
          >
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.users?.name || p.user_id}
              </option>
            ))}
          </select>
        </div>
      )}

      {!profile && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No staff profiles available yet.
        </div>
      )}

      {profile && result && (
        <>
          <div className="whatif-controls">
            {/* New client revenue slider */}
            <div className="staff-field">
              <label className="staff-label">
                New Client Revenue — {formatCurrency(newRevenue)}
              </label>
              <input
                type="range"
                min={0}
                max={maxSlider}
                step={10000}
                value={newRevenue}
                onChange={e => setNewRevenue(Number(e.target.value))}
                style={{ accentColor: 'var(--accent)', width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>₹0</span>
                <span>{formatCurrency(maxSlider)}</span>
              </div>
            </div>

            {/* Renewal revenue slider */}
            <div className="staff-field">
              <label className="staff-label">
                Renewal Revenue — {formatCurrency(renewalRevenue)}
              </label>
              <input
                type="range"
                min={0}
                max={maxSlider}
                step={10000}
                value={renewalRevenue}
                onChange={e => setRenewalRevenue(Number(e.target.value))}
                style={{ accentColor: 'var(--blue)', width: '100%' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                <span>₹0</span>
                <span>{formatCurrency(maxSlider)}</span>
              </div>
            </div>
          </div>

          {/* Result cards */}
          <div className="whatif-result-grid">
            <div className="whatif-result-card">
              <div className="whatif-result-label">Total Revenue</div>
              <div className="whatif-result-value">{formatCurrency(result.total)}</div>
            </div>
            <div className="whatif-result-card">
              <div className="whatif-result-label">Threshold</div>
              <div className="whatif-result-value">{formatCurrency(threshold)}</div>
              <div style={{ fontSize: 11, color: result.slabReached ? 'var(--success)' : 'var(--danger)', marginTop: 4 }}>
                {result.slabReached ? '✓ Reached' : '✗ Not reached'}
              </div>
            </div>
            <div className="whatif-result-card">
              <div className="whatif-result-label">Target</div>
              <div className="whatif-result-value">{formatCurrency(target)}</div>
              <div style={{ fontSize: 11, color: result.targetExceeded ? 'var(--success)' : 'var(--text-muted)', marginTop: 4 }}>
                {result.targetExceeded ? '✓ Exceeded' : `${Math.round(result.progressToTarget * 100)}% done`}
              </div>
            </div>
            <div className="whatif-result-card" style={{ border: '1px solid var(--accent)', background: 'rgba(255,230,0,0.05)' }}>
              <div className="whatif-result-label">Incentive Earned</div>
              <div className="whatif-result-value accent">{formatCurrency(result.incentive)}</div>
              {result.targetExceeded && (
                <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                  Includes ₹{Number(result.flatBonus).toLocaleString('en-IN')} bonus
                </div>
              )}
            </div>
          </div>

          {/* Visual breakdown bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              <span>₹0</span>
              <span>Threshold {formatCurrency(threshold)}</span>
              <span>Target {formatCurrency(target)}</span>
            </div>
            <div style={{ position: 'relative', height: 10, background: 'var(--border)', borderRadius: 99, overflow: 'visible' }}>
              {/* threshold marker */}
              <div style={{
                position: 'absolute',
                left: `${Math.min((threshold / maxSlider) * 100, 100)}%`,
                top: -4, bottom: -4,
                width: 2,
                background: 'var(--warning)',
                borderRadius: 2,
                zIndex: 2,
              }} />
              {/* fill */}
              <div style={{
                position: 'absolute',
                left: 0,
                width: `${Math.min((result.total / maxSlider) * 100, 100)}%`,
                height: '100%',
                borderRadius: 99,
                background: result.targetExceeded
                  ? 'var(--success)'
                  : result.slabReached
                  ? 'var(--warning)'
                  : 'var(--danger)',
                transition: 'width 0.2s',
              }} />
            </div>
          </div>

          {/* Breakdown detail */}
          {result.slabReached && (
            <div style={{
              marginTop: 16,
              fontSize: 12,
              color: 'var(--text-muted)',
              background: 'var(--surface2)',
              borderRadius: 8,
              padding: '10px 14px',
              lineHeight: 1.7,
            }}>
              Base incentive = {formatCurrency(newRevenue)} × {formatPercent(profile.new_client_rate ?? settings?.new_client_rate ?? 0.05)} + {formatCurrency(renewalRevenue)} × {formatPercent(profile.renewal_rate ?? settings?.renewal_rate ?? 0.02)} = <strong style={{ color: 'var(--text)' }}>{formatCurrency(result.baseIncentive)}</strong>
              {result.targetExceeded && (
                <> &nbsp;+&nbsp; flat bonus = <strong style={{ color: 'var(--accent)' }}>{formatCurrency(result.incentive)}</strong></>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
