// src/pages/v2/CoachTeamV2.jsx
//
// Phase 574 — Team Evening. Admin sees every sales + telecaller rep; a sales
// manager sees his assigned reps (coach_team_view decides, server-side).
// Per person: today's score, today's actions done, 14-day done-rate, and the
// 3 actions they got for the next working day. Worst done-rate first.

import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightbulb, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import { coachText, coachLink } from '../../utils/coachText'

function tone(v, good, ok) {
  if (v == null) return 'var(--v2-ink-2, #94a3b8)'
  if (v >= good) return 'var(--v2-green, #10B981)'
  if (v >= ok) return 'var(--v2-amber, #F59E0B)'
  return 'var(--v2-rose, #EF4444)'
}

export default function CoachTeamV2() {
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lang, setLang] = useState('en')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.rpc('coach_team_view', { p_date: istTodayISO() })
    if (err) setError(err.message || 'Could not load the team')
    else setRows(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const pill = (active) => ({
    minHeight: 36, padding: '0 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
    border: '1px solid var(--v2-line, #334155)',
    background: active ? 'var(--v2-yellow, #FFE600)' : 'transparent',
    color: active ? 'var(--accent-fg, #0f172a)' : 'var(--v2-ink-1, #cbd5e1)',
  })

  return (
    <div className="v2" style={{ padding: '24px 20px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--v2-ink-2, #94a3b8)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lightbulb size={14} strokeWidth={1.6} /> Team Evening
          </div>
          <h1 style={{ fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 28, fontWeight: 700, margin: '6px 0 0', color: 'var(--v2-ink-0, #f1f5f9)' }}>
            Score and tomorrow's actions
          </h1>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 4 }}>
            Actions are built at 6:45 pm and checked at 11:45 pm. Done-rate = actions done in the last 14 days.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={pill(lang === 'en')} onClick={() => setLang('en')}>English</button>
          <button type="button" style={pill(lang === 'gu')} onClick={() => setLang('gu')}>ગુજરાતી</button>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--v2-ink-2, #94a3b8)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} /> Loading team…
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: 16, borderRadius: 14, background: 'var(--danger-soft, rgba(239,68,68,0.12))', color: 'var(--v2-rose, #EF4444)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>{error}</span>
          <button type="button" onClick={load} style={{ ...pill(false), color: 'inherit' }}>Retry</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 32, borderRadius: 14, background: 'var(--v2-bg-1, #1e293b)', border: '1px dashed var(--v2-line, #334155)', textAlign: 'center', color: 'var(--v2-ink-2, #94a3b8)' }}>
          No reps to show yet.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 12 }}>
          {rows.map(r => (
            <div key={r.id} style={{ padding: 14, borderRadius: 14, background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 17, fontWeight: 600, color: 'var(--v2-ink-0, #f1f5f9)' }}>{r.name}</div>
                <div style={{ fontSize: 12, padding: '3px 8px', borderRadius: 999, background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-2, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{r.role}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
                {[
                  ['Score today', r.score_today == null ? '–' : `${r.score_today}%`, tone(r.score_today, 70, 40)],
                  ['Done today', r.actions_today ? `${r.done_today}/${r.actions_today}` : '–', 'var(--v2-ink-0, #f1f5f9)'],
                  ['14-day done', r.done_rate_14d == null ? '–' : `${r.done_rate_14d}%`, tone(r.done_rate_14d, 70, 40)],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ padding: 8, borderRadius: 10, background: 'var(--v2-bg-2, #0f172a)', border: '1px solid var(--v2-line, #334155)' }}>
                    <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>{label}</div>
                    <div className="tabular-nums" style={{ fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 17, fontWeight: 600, color }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>Next working day</div>
              {(r.next_actions || []).length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--v2-ink-1, #cbd5e1)', marginTop: 4 }}>No actions (nothing pending, or not built yet today).</div>
              ) : (
                <ol style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
                  {r.next_actions.map((a, i) => {
                    const to = coachLink(a)
                    const text = coachText(a.kind, a.detail)[lang]
                    return (
                      <li key={i} style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--v2-ink-1, #cbd5e1)' }}>
                        {to ? (
                          <button type="button" onClick={() => navigate(to)} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--v2-line, #334155)' }}>{text}</button>
                        ) : text}
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
