// src/components/incentives/PerformanceScoreCard.jsx
//
// Phase 33E (11 May 2026) — live performance score + variable salary
// projection.
//
// Reads monthly_score RPC (this month so far) for the current user.
// Shows: average score %, working days counted, base + variable +
// total payable. Rep sees their own. Admin can pass userId prop to
// view any rep.

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

function fmtINR(n) {
  return '₹' + new Intl.NumberFormat('en-IN').format(Math.round(Number(n) || 0))
}

function monthStart(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export default function PerformanceScoreCard({ userId: propUserId, hideHeader }) {
  const { profile } = useAuth()
  const userId = propUserId || profile?.id
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      const { data: rows, error: err } = await supabase
        .rpc('monthly_score', { p_user_id: userId, p_month_start: monthStart() })
      if (cancelled) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setData(Array.isArray(rows) && rows.length > 0 ? rows[0] : null)
    })()
    return () => { cancelled = true }
  }, [userId])

  if (loading) {
    return (
      <div className="lead-card lead-card-pad" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading score…
      </div>
    )
  }
  if (error) {
    return (
      <div className="lead-card lead-card-pad" style={{ color: 'var(--danger)' }}>
        Score unavailable: {error}
      </div>
    )
  }
  if (!data) return null

  const pct = Number(data.avg_score_pct || 0)
  const isLow = pct < 50
  const isGreat = pct >= 90
  const days = data.working_days || 0
  const ringColor = isLow ? 'var(--danger)' : isGreat ? 'var(--success)' : 'var(--accent)'

  return (
    <div className="lead-card" style={{
      padding: 16, marginBottom: 14,
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      {!hideHeader && (
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
          color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12,
        }}>
          This month — performance score
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {/* Score ring */}
        <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
          <svg viewBox="0 0 100 100" width="96" height="96">
            <circle cx="50" cy="50" r="42" fill="none"
              stroke="var(--surface-2)" strokeWidth="9" />
            <circle cx="50" cy="50" r="42" fill="none"
              stroke={ringColor} strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 264} 264`}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dasharray .4s' }} />
            <text x="50" y="55" textAnchor="middle"
              fontFamily="Space Grotesk, system-ui" fontWeight="700" fontSize="22"
              fill="var(--text)">
              {pct.toFixed(0)}%
            </text>
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            {days} working day{days !== 1 ? 's' : ''} counted · Sundays / holidays / leaves excluded
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Base (70%)</span>
            <span className="mono" style={{ color: 'var(--text)' }}>{fmtINR(data.base_amount)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Variable (30%)</span>
            <span className="mono" style={{ color: isLow ? 'var(--danger)' : 'var(--text)' }}>
              {fmtINR(data.variable_earned)} / {fmtINR(data.variable_cap)}
            </span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Projected total</span>
            <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 16 }}>
              {fmtINR(data.total_payable)}
            </span>
          </div>
        </div>
      </div>

      {/* Status line */}
      <div style={{
        marginTop: 12, padding: '8px 12px', borderRadius: 8,
        background: isLow ? 'rgba(239,68,68,.08)'
          : isGreat ? 'rgba(16,185,129,.08)'
          : 'rgba(245,158,11,.08)',
        border: `1px solid ${isLow ? 'var(--danger)' : isGreat ? 'var(--success)' : 'var(--warning)'}`,
        fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {isLow
          ? <><AlertTriangle size={13} color="var(--danger)" /> Below 50% — variable salary is zero this month. Hit your meeting target to unlock.</>
          : isGreat
            ? <><TrendingUp size={13} color="var(--success)" /> On track for full variable payout.</>
            : <><TrendingDown size={13} color="var(--warning)" /> Variable scales with your score — hit 100% to maximise.</>}
      </div>
    </div>
  )
}
