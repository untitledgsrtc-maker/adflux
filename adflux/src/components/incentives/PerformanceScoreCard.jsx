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
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// Phase 33L (F5 fix) — inline 6-month sparkline. Pulls from
// score_history RPC. Renders bars instead of a chart library to
// stay zero-dependency. Tap a bar → tooltip.
function ScoreSparkline({ userId }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc('score_history', {
        p_user_id: userId, p_months_back: 6,
      })
      if (!cancelled) {
        setHistory(data || [])
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  if (loading || history.length === 0) return null

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.12em',
        color: 'var(--text-muted)', textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        Last 6 months
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 56 }}>
        {history.map((m, i) => {
          const pct = Number(m.avg_score_pct) || 0
          const barColor = pct < 50 ? 'var(--danger)'
                         : pct >= 90 ? 'var(--success)'
                         : 'var(--accent, #FFE600)'
          const isCurrent = i === history.length - 1
          return (
            <div
              key={m.month_start}
              title={`${m.month_label}: ${pct.toFixed(0)}% · ₹${new Intl.NumberFormat('en-IN').format(Math.round(m.total_payable || 0))}`}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4,
              }}
            >
              <div style={{
                width: '100%',
                height: `${Math.max(2, pct * 0.4)}px`,
                background: barColor,
                borderRadius: '3px 3px 0 0',
                opacity: isCurrent ? 1 : 0.7,
              }} />
              <div style={{
                fontSize: 10, color: isCurrent ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: isCurrent ? 700 : 500,
              }}>
                {m.month_label}
              </div>
              <div style={{
                fontSize: 9, fontFamily: 'monospace',
                color: 'var(--text-muted)',
              }}>
                {pct.toFixed(0)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
  // Phase 33G.2 (item 84) — proper empty state.
  // Phase 33J (B1 fix) — agency role gets different copy. Agencies
  // only create govt quotes; they don't do meetings or own leads.
  // The "log a meeting" prompt was confusing.
  const isAgency = profile?.role === 'agency'
  // Phase 34Z.36 — 0-working-day guard. monthly_score RPC was
  // returning avg_score_pct=100 when no days had been counted yet
  // (PG AVG() of zero rows → NULL → COALESCE on the RPC side to 100
  // for a fresh-month default). UI was then declaring "On track for
  // full variable payout" on day 1 with no meetings logged.
  // Treat working_days === 0 as no-data and render the empty state
  // instead of the score ring.
  if (!data || (Number(data.working_days || 0) === 0 && !isAgency)) {
    return (
      <div className="lead-card" style={{
        padding: 20, marginBottom: 14, textAlign: 'center',
        background: 'var(--surface)', border: '1px solid var(--border)',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 999, margin: '0 auto 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,230,0,.10)', color: 'var(--accent, #FFE600)',
        }}>
          <Sparkles size={22} strokeWidth={1.6} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          {isAgency ? 'No earnings yet this month' : 'No score yet this month'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
          {isAgency
            ? 'Create a govt proposal and mark it won — your commission appears here once payment is recorded.'
            : `Log a meeting or move a lead through a stage and your score will
              start building. Sundays, holidays and approved leaves don't count
              against you.`}
        </div>
        {/* Phase 34Z.58 — give the rep an exact next step. Owner
            reported the empty state with no CTA was confusing. Both
            paths land where the action lives. */}
        {!isAgency ? (
          <a
            href="/work"
            className="lead-btn lead-btn-primary"
            style={{ textDecoration: 'none', display: 'inline-flex', gap: 6 }}
          >
            Start today on /work
          </a>
        ) : (
          <a
            href="/quotes/new/government"
            className="lead-btn lead-btn-primary"
            style={{ textDecoration: 'none', display: 'inline-flex', gap: 6 }}
          >
            Start a govt proposal
          </a>
        )}
      </div>
    )
  }

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

      {/* Phase 33J (B11 fix) — score breakdown. Rep at 47% needs to
          see WHAT is hurting the score, not just the result. Math is:
          score = (meetings_done / meetings_target) × 100, averaged
          across working days in month. Coaching = "to reach 80% you
          need M more meetings over the remaining D working days". */}
      {(() => {
        // Pull this-month math directly from data. avg_score_pct is
        // already the average across working_days. We surface the
        // delta needed to hit each milestone (50% threshold, 80%
        // target, 100% max).
        const remainingToFifty   = Math.max(0, 50  - pct).toFixed(0)
        const remainingToEighty  = Math.max(0, 80  - pct).toFixed(0)
        const remainingToHundred = Math.max(0, 100 - pct).toFixed(0)
        const hitFifty   = pct >= 50
        const hitEighty  = pct >= 80
        const hitHundred = pct >= 100
        return (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,.03)',
            border: '1px solid var(--border)',
            fontSize: 12,
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.12em',
              color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6,
            }}>
              What's hurting your score
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr',
              gap: '4px 10px', fontSize: 12,
            }}>
              <span style={{ color: hitFifty   ? 'var(--success)' : 'var(--danger)' }}>
                {hitFifty ? '✓' : '○'} 50% threshold
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {hitFifty ? 'Variable unlocked' : `${remainingToFifty}% to unlock variable salary`}
              </span>
              <span style={{ color: hitEighty  ? 'var(--success)' : 'var(--warning)' }}>
                {hitEighty ? '✓' : '○'} 80% target
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {hitEighty ? 'Strong month' : `${remainingToEighty}% to hit team target`}
              </span>
              <span style={{ color: hitHundred ? 'var(--success)' : 'var(--text-muted)' }}>
                {hitHundred ? '✓' : '○'} 100% max
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {hitHundred ? 'Maxed out' : `${remainingToHundred}% to maximise payout`}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
              Score = (meetings done ÷ daily target) × 100, averaged across {days} working day{days !== 1 ? 's' : ''} this month.
            </div>
          </div>
        )
      })()}

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

      {/* Phase 33L (F5 fix) — 6-month sparkline. Gives reps the trend
          line that was lost when MyPerformanceView was removed. */}
      {!isAgency && <ScoreSparkline userId={userId} />}
    </div>
  )
}
