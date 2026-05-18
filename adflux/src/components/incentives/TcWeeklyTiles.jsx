// src/components/incentives/TcWeeklyTiles.jsx
//
// Phase 53 — telecaller-only weekly KPI strip on /my-performance.
//
// Mounted on MyPerformanceV2 between the score card and the
// MyPerformance revenue block. Hidden for non-telecaller roles.
//
// Data: single fetch of `tc_weekly_stats(p_user_id)` RPC (Phase 53
// SQL). Owner triage:
//   • Connect rate     — observability only (Q2 no)
//   • Qualified weekly — score-math gate (Q3 yes)
//   • Quotes weekly    — score-math gate (Q4 yes)
//
// Gate semantics (UI-first, no RPC change yet):
//   variable_after_gate = variable_earned
//     × min(1, qualified_count / qualified_target)
//     × min(1, quotes_count    / quotes_target)
//
// The displayed banner tells the rep when the gate is biting and
// by how much. /people Salary tab still surfaces the un-gated
// figure until owner promotes the gate into compute_monthly_salary
// (Phase 53b, deferred).

import { useEffect, useState } from 'react'
import { Loader2, Phone, CheckCircle2, AlertTriangle, FileText, Activity } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function TcWeeklyTiles() {
  const { profile } = useAuth()
  const isTelecaller = profile?.role === 'telecaller'

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isTelecaller || !profile?.id) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      const { data: rows, error: err } = await supabase
        .rpc('tc_weekly_stats', { p_user_id: profile.id })
      if (cancelled) return
      setLoading(false)
      if (err) { setError(err.message); return }
      setData(Array.isArray(rows) && rows.length > 0 ? rows[0] : null)
    })()
    return () => { cancelled = true }
  }, [profile?.id, isTelecaller])

  if (!isTelecaller) return null

  if (loading) {
    return (
      <div className="lead-card lead-card-pad" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        color: 'var(--text-muted)', marginTop: 14,
      }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading weekly stats…
      </div>
    )
  }
  if (error) {
    return (
      <div className="lead-card lead-card-pad" style={{
        color: 'var(--danger)', marginTop: 14,
      }}>
        Weekly stats unavailable: {error}
      </div>
    )
  }
  if (!data) return null

  const qualifiedCount  = Number(data.qualified_count  || 0)
  const qualifiedTarget = Number(data.qualified_target || 5)
  const quotesCount     = Number(data.quotes_count     || 0)
  const quotesTarget    = Number(data.quotes_target    || 2)
  const connectPct      = Number(data.connect_pct      || 0)
  const connectTargetPct= Number(data.connect_target_pct || 30)
  const totalCalls      = Number(data.total_calls      || 0)
  const connectedCount  = Number(data.connected_count  || 0)

  const qualifiedHit = qualifiedCount >= qualifiedTarget
  const quotesHit    = quotesCount    >= quotesTarget
  const connectHit   = connectPct     >= connectTargetPct

  // Gate factor — both must hit for full variable. Connect rate
  // does NOT participate (owner Q2 no).
  const qualifiedFactor = qualifiedTarget > 0
    ? Math.min(1, qualifiedCount / qualifiedTarget) : 1
  const quotesFactor    = quotesTarget > 0
    ? Math.min(1, quotesCount / quotesTarget)       : 1
  const gateFactor = qualifiedFactor * quotesFactor
  const gatePct    = Math.round(gateFactor * 100)
  const gateBiting = gatePct < 100

  return (
    <div className="lead-card" style={{
      padding: 16, marginTop: 14, marginBottom: 0,
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
        color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12,
      }}>
        This week — TC policy
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10,
      }}>
        <Tile
          icon={<Phone size={14} strokeWidth={1.6} />}
          label="Connect rate"
          value={`${connectPct.toFixed(0)}%`}
          target={`min ${connectTargetPct}%`}
          hit={connectHit}
          sub={totalCalls > 0
            ? `${connectedCount} / ${totalCalls} calls`
            : 'No calls yet this week'}
        />
        <Tile
          icon={<CheckCircle2 size={14} strokeWidth={1.6} />}
          label="Qualified this week"
          value={`${qualifiedCount}`}
          target={`/ ${qualifiedTarget}`}
          hit={qualifiedHit}
          gates
          sub={qualifiedHit
            ? 'Target hit — gate clear'
            : `${qualifiedTarget - qualifiedCount} more to clear gate`}
        />
        <Tile
          icon={<FileText size={14} strokeWidth={1.6} />}
          label="Quotes this week"
          value={`${quotesCount}`}
          target={`/ ${quotesTarget}`}
          hit={quotesHit}
          gates
          sub={quotesHit
            ? 'Target hit — gate clear'
            : `${quotesTarget - quotesCount} more to clear gate`}
        />
      </div>

      {/* Variable-unlock gate banner — only renders when biting. */}
      {gateBiting && (
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: 'var(--warning-soft, rgba(245,158,11,.12))',
          border: '1px solid var(--warning)',
          borderRadius: 10,
          fontSize: 12, color: 'var(--warning)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <AlertTriangle size={14} strokeWidth={1.6} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text)' }}>
              Weekly gate is reducing variable salary to {gatePct}%.
            </div>
            <div style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Variable salary scales with weekly qualified handoffs and quotes
              alongside daily calls. Hit both weekly targets to unlock 100% of
              variable. Connect rate is observability only and does not gate.
            </div>
          </div>
        </div>
      )}
      {!gateBiting && (qualifiedCount + quotesCount > 0) && (
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: 'var(--success-soft, rgba(16,185,129,.12))',
          border: '1px solid var(--success)',
          borderRadius: 10,
          fontSize: 12, color: 'var(--success)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Activity size={14} strokeWidth={1.6} />
          <span style={{ color: 'var(--text)' }}>Weekly gates clear — variable salary scales 1:1 with your daily call score.</span>
        </div>
      )}
    </div>
  )
}

function Tile({ icon, label, value, target, hit, gates, sub }) {
  const accent = hit
    ? 'var(--success)'
    : gates ? 'var(--warning)' : 'var(--text-muted)'
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'rgba(255,255,255,.03)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: '.10em',
        color: 'var(--text-muted)', textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        {icon} {label}
      </div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        marginBottom: 4,
      }}>
        <span style={{
          fontSize: 22, fontWeight: 700,
          fontFamily: 'var(--font-display, var(--font-sans))',
          color: accent,
        }}>{value}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{target}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.35 }}>
        {sub}
      </div>
    </div>
  )
}
