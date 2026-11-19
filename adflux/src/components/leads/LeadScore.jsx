// =============================================================================
// LeadScore — Phase 625 (19-11-2026, owner-approved). Lead score 0-100 from
// public.lead_scores (written by recompute_lead_scores: hourly + on every call /
// follow-up / stage change). Formula lives in db/functions/lead_score_calc.sql.
//   LeadScoreRing  — small ring for the Leads list (replaces the heat dot there).
//   LeadScoreCard  — ring + breakdown for the lead page side panel.
// Colours: green 70+, amber 40-69, red below 40. Tokens only.
// =============================================================================
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export function scoreTone(s) {
  if (s == null) return 'var(--v2-ink-2)'
  return s >= 70 ? 'var(--v2-green, #22c55e)' : s >= 40 ? 'var(--v2-amber, #f59e0b)' : 'var(--v2-rose, #f43f5e)'
}

export function scoreTitle(score, parts) {
  if (score == null) return 'Score not worked out yet'
  if (!parts) return `Lead score ${score}%`
  const meet = parts.meet_kind === 'interested' ? 'Said interested' : 'Meeting done'
  return [
    `Lead score ${score}%`,
    `Stage ${parts.stage ?? 0}`,
    `Talked in 7 days ${parts.talked ?? 0}`,
    `${meet} ${parts.meet ?? 0}`,
    `Follow-ups on time ${parts.ontime ?? 0} (${parts.ontime_n ?? 0} of ${parts.due_n ?? 0})`,
    parts.overdue ? `Overdue ${parts.overdue}` : null,
  ].filter(Boolean).join(' · ')
}

export function LeadScoreRing({ score, parts, size = 30 }) {
  const stroke = size >= 60 ? 7 : 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  return (
    <span title={scoreTitle(score, parts)} style={{ display: 'inline-flex', flexShrink: 0, position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={score == null ? 'No score yet' : `Lead score ${score} percent`} role="img">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--v2-line)" strokeWidth={stroke} />
        {score != null && score > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreTone(score)} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </svg>
      <span className="tabular-nums" style={{
        position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-display, "Space Grotesk", system-ui, sans-serif)', fontWeight: 600,
        fontSize: size >= 60 ? 20 : 12, color: 'var(--v2-ink-0)',
      }}>{score == null ? '–' : score}</span>
    </span>
  )
}

const ROW = { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '8px 0', borderTop: '1px solid var(--v2-line)' }

export function LeadScoreCard({ leadId, refreshKey, stage }) {
  const [row, setRow] = useState(undefined)   // undefined = loading, null = none
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!leadId) return undefined
    let alive = true
    supabase.from('lead_scores').select('score, parts, updated_at').eq('lead_id', leadId).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { setErr(error.message || 'Could not load the score'); return }
        setErr(''); setRow(data || null)
      })
    return () => { alive = false }
  }, [leadId, refreshKey])

  const p = row?.parts || {}
  const meetLabel = p.meet_kind === 'interested' ? 'Said interested on a call' : 'Meeting or site visit done'
  return (
    <div className="lead-card">
      <div className="lead-card-head"><div className="lead-card-title">Lead score</div></div>
      <div className="lead-card-pad">
        {err ? (
          <div role="alert" style={{ color: 'var(--v2-rose, #f43f5e)', fontSize: 13 }}>{err}</div>
        ) : row === undefined ? (
          <div style={{ color: 'var(--v2-ink-2)', fontSize: 13 }}>Loading score…</div>
        ) : row === null ? (
          <div style={{ color: 'var(--v2-ink-2)', fontSize: 13 }}>No score yet. It is worked out within the hour.</div>
        ) : (stage === 'Won' || stage === 'Lost') ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <LeadScoreRing score={row.score} parts={p} size={72} />
            <div style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>{stage === 'Won' ? 'Won — score is locked at 100.' : 'Lost — score is 0.'}</div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              <LeadScoreRing score={row.score} parts={p} size={72} />
              <div style={{ fontSize: 13, color: 'var(--v2-ink-1)', lineHeight: 1.5 }}>
                {row.score >= 70 ? 'Strong — keep the follow-ups on time.' : row.score >= 40 ? 'Warming up.' : 'Needs attention.'}
                {p.overdue ? <div style={{ color: 'var(--v2-rose, #f43f5e)' }}>A follow-up is overdue.</div> : null}
              </div>
            </div>
            <div style={{ ...ROW, borderTop: 0 }}><span>Stage</span><span className="tabular-nums">{p.stage ?? 0} / 35</span></div>
            <div style={ROW}><span>Talked in the last 7 days</span><span className="tabular-nums">{p.talked ?? 0} / 20</span></div>
            <div style={ROW}><span>{meetLabel}</span><span className="tabular-nums">{p.meet ?? 0} / 15</span></div>
            <div style={ROW}><span>Follow-ups on time ({p.ontime_n ?? 0} of {p.due_n ?? 0})</span><span className="tabular-nums">{p.ontime ?? 0} / 30</span></div>
            {p.overdue ? <div style={ROW}><span>Overdue follow-up</span><span className="tabular-nums" style={{ color: 'var(--v2-rose, #f43f5e)' }}>{p.overdue}</span></div> : null}
          </>
        )}
      </div>
    </div>
  )
}
