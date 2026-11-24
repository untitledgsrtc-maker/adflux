// src/pages/v2/CoachTeamV2.jsx
//
// Phase 574 — Team Evening. Admin sees every sales + telecaller rep; a sales
// manager sees his assigned reps (coach_team_view decides, server-side).
// Per person: today's score, today's actions done, 14-day done-rate, and the
// 3 actions they got for the next working day. Worst done-rate first.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightbulb, Loader2, MessageCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { istTodayISO } from '../../utils/istDate'
import { coachText, coachLink } from '../../utils/coachText'
import { openWhatsApp } from '../../utils/whatsapp'
import { addDaysISO, fmtDateShort } from '../../utils/workUtils'
import { loadOfficeScores } from '../../components/work/OnTimeScoreCard'
import DateField from '../../components/work/DateField'

// Phase 687 - readable role tag (was the raw code, e.g. OPERATION_EXECUTIVE)
const ROLE_LABEL = { operation_executive: 'Ops executive', operation_head: 'Ops head', office_admin: 'Office admin', staff: 'Work team', hr: 'HR' }

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
  const [tips, setTips] = useState({})   // Phase 577: user_id -> latest AI tip
  const [phones, setPhones] = useState({})   // Phase 616: user_id -> whatsapp_number
  const [group, setGroup] = useState('all')   // Phase 575/576: all | sales | office | ops
  // Phase 688: pick the day, one person, and see the movement over the last N days
  const today = istTodayISO()
  const [day, setDay] = useState(today)
  const [person, setPerson] = useState('')
  const [span, setSpan] = useState(14)
  const [hist, setHist] = useState([])
  const [histErr, setHistErr] = useState('')
  // Phase 690: office team month score (tasks given 40 + hours 35 + in by 9:45 25), 1st of the month up to the picked day (today = up to yesterday)
  const [office, setOffice] = useState({})
  useEffect(() => {
    let alive = true
    const to = day === today ? addDaysISO(today, -1) : day
    const from = to.slice(0, 8) + '01'
    if (to < from) { setOffice({}); return undefined }
    loadOfficeScores(from, to).then((rows) => { if (alive) setOffice(Object.fromEntries((rows || []).map((x) => [x.user_id, x]))) })
    return () => { alive = false }
  }, [day, today])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const { data, error: err } = await supabase.rpc('coach_team_view', { p_date: day })
    if (err) setError(err.message || 'Could not load the team')
    else {
      setRows(data || [])
      // Phase 577 — latest AI tip per person (RLS: admin all, sales manager his reps)
      const ids = (data || []).map(r => r.id)
      if (ids.length) {
        const { data: t } = await supabase.from('coach_tips').select('user_id, en, gu, tip_date')
          .in('user_id', ids).order('tip_date', { ascending: false })
        const map = {}
        ;(t || []).forEach(x => { if (!map[x.user_id]) map[x.user_id] = x })
        setTips(map)
        const { data: u } = await supabase.from('users').select('id, whatsapp_number').in('id', ids)
        setPhones(Object.fromEntries((u || []).map(x => [x.id, x.whatsapp_number])))
      }
    }
    setLoading(false)
  }, [day])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    let alive = true
    setHistErr('')
    supabase.rpc('coach_history', { p_from: addDaysISO(day, -(span - 1)), p_to: day }).then(({ data, error: e }) => {
      if (!alive) return
      if (e) { setHistErr(e.message || 'Could not load the chart'); setHist([]) } else setHist(data || [])
    })
    return () => { alive = false }
  }, [day, span])
  const series = useMemo(() => {
    const days = Array.from({ length: span }, (_, i) => addDaysISO(day, i - (span - 1)))
    const pick = hist.filter((h) => !person || h.user_id === person)
    const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null }
    return days.map((d) => {
      const rowsD = pick.filter((h) => h.day === d)
      return {
        day: d,
        score: avg(rowsD.map((h) => h.score)),
        done: avg(rowsD.map((h) => (h.checked > 0 ? Math.round(100 * h.done / h.checked) : null))),
      }
    })
  }, [hist, person, day, span])

  // Phase 616 - send this person their AI tip + next-day actions on WhatsApp (in the page language)
  const shareOnWhatsApp = (r) => {
    const tip = tips[r.id]?.[lang]
    const acts = (r.next_actions || []).map((a, i) => `${i + 1}. ${coachText(a.kind, a.detail)[lang]}`)
    const gu = lang === 'gu'
    const lines = [
      gu ? `નમસ્તે ${r.name},` : `Hi ${r.name},`,
      ...(tip ? ['', gu ? '*આજની ટીપ*' : '*Tip for you*', tip] : []),
      ...(acts.length ? ['', gu ? '*આવતા કામના દિવસે*' : '*Next working day*', ...acts] : []),
    ]
    openWhatsApp(phones[r.id] || '', lines.join('\n'))
  }

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
            Score and next-day actions
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

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <DateField value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Pick the day"
          style={{ width: 170, minHeight: 36 }} className="v2d-ghost" />
        {day !== today && <button type="button" style={pill(false)} onClick={() => setDay(today)}>Today</button>}
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Pick a person"
          style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1px solid var(--v2-line, #334155)', background: 'var(--v2-bg-1, #1e293b)', color: 'var(--v2-ink-1, #cbd5e1)', fontSize: 13, maxWidth: '100%' }}>
          <option value="">Everyone</option>
          {[...rows].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      {/* Phase 688: movement chart - day score % and actions done % */}
      <div style={{ padding: 14, borderRadius: 14, background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v2-ink-0, #f1f5f9)' }}>
            {person ? (rows.find((r) => r.id === person)?.name || 'Person') : 'Team average'} · last {span} days to {fmtDateShort(day)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 14, 30].map((n) => <button key={n} type="button" style={pill(span === n)} onClick={() => setSpan(n)}>{n} days</button>)}
          </div>
        </div>
        {histErr ? (
          <div style={{ color: 'var(--v2-rose, #EF4444)', fontSize: 13 }}>{histErr}</div>
        ) : (
          <MoveChart data={series} />
        )}
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

      {!loading && !error && rows.some(r => r.score_kind !== 'day') && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button type="button" style={pill(group === 'all')} onClick={() => setGroup('all')}>All</button>
          <button type="button" style={pill(group === 'sales')} onClick={() => setGroup('sales')}>Sales &amp; telecallers</button>
          <button type="button" style={pill(group === 'office')} onClick={() => setGroup('office')}>Office team</button>
          <button type="button" style={pill(group === 'ops')} onClick={() => setGroup('ops')}>Ops</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 32, borderRadius: 14, background: 'var(--v2-bg-1, #1e293b)', border: '1px dashed var(--v2-line, #334155)', textAlign: 'center', color: 'var(--v2-ink-2, #94a3b8)' }}>
          No reps to show yet.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 12 }}>
          {rows.filter(r => !person || r.id === person).filter(r => group === 'all' || (group === 'office' ? r.score_kind === 'ontime' : group === 'ops' ? r.score_kind === 'uptime' : r.score_kind === 'day')).map(r => (
            <div key={r.id} style={{ minWidth: 0, padding: 14, borderRadius: 14, background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)' }}>
              {/* Phase 687 - header wraps on a phone (a long role tag pushed the card past the screen edge) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ minWidth: 0, fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 17, fontWeight: 600, color: 'var(--v2-ink-0, #f1f5f9)' }}>{r.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  {(tips[r.id] || (r.next_actions || []).length > 0) && (
                    <button type="button" className="v2d-ghost" onClick={() => shareOnWhatsApp(r)}
                      title={phones[r.id] ? `Send to ${r.name} on WhatsApp` : 'No WhatsApp number saved - pick the chat'}
                      aria-label={`Send ${r.name} the tip on WhatsApp`}>
                      <MessageCircle size={14} />
                      <span>WhatsApp</span>
                    </button>
                  )}
                  <div style={{ fontSize: 12, padding: '3px 8px', borderRadius: 999, background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-2, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{ROLE_LABEL[r.role] || String(r.role || '').replace(/_/g, ' ')}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
                {[
                  r.score_kind === 'ontime'
                    ? ['Month score', office[r.id]?.score == null ? '–' : `${Math.round(office[r.id].score)}`, tone(office[r.id]?.score == null ? null : Number(office[r.id].score), 85, 60)]
                    : [r.score_kind === 'uptime' ? (day === today ? 'Uptime today' : 'Uptime') : (day === today ? 'Score today' : 'Day score'), r.score_today == null ? '–' : `${r.score_today}%`, tone(r.score_today, 70, 40)],
                  [day === today ? 'Done today' : 'Done that day', r.actions_today ? `${r.done_today}/${r.actions_today}` : '–', 'var(--v2-ink-0, #f1f5f9)'],
                  ['14-day done', r.done_rate_14d == null ? '–' : `${r.done_rate_14d}%`, tone(r.done_rate_14d, 70, 40)],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ padding: 8, borderRadius: 10, background: 'var(--v2-bg-2, #0f172a)', border: '1px solid var(--v2-line, #334155)' }}>
                    <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>{label}</div>
                    <div className="tabular-nums" style={{ fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 17, fontWeight: 600, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {r.score_kind === 'ontime' && office[r.id] && office[r.id].score != null && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>
                  Tasks given {Math.round(office[r.id].task_pts)}/40 ({office[r.id].given_on_time} of {office[r.id].given} on time) · Hours {Math.round(office[r.id].hours_pts)}/35 ({Math.round(office[r.id].hours)}h) · In by 9:45 {Math.round(office[r.id].punct_pts)}/25 ({office[r.id].on_time_days} of {office[r.id].full_days} days)
                </div>
              )}

              {tips[r.id] && (
                <div style={{ marginTop: 10, padding: 8, borderRadius: 10, background: 'var(--v2-bg-2, #0f172a)', border: '1px solid var(--v2-line, #334155)', fontSize: 13, lineHeight: 1.4, color: 'var(--v2-ink-1, #cbd5e1)' }}>
                  <span style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>AI tip · </span>{tips[r.id][lang]}
                </div>
              )}

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

// Phase 688: two-line chart, 0-100 %, gaps where a day has no number (Sunday, holiday, no tasks due)
function MoveChart({ data }) {
  // drawn at phone size on a phone, so the labels stay readable instead of shrinking with the picture
  const narrow = typeof window !== 'undefined' && window.innerWidth < 560
  const W = narrow ? 340 : 640, H = narrow ? 190 : 170, L = 34, R = 10, T = 10, B = 24
  const x = (i) => L + (data.length <= 1 ? 0 : (i * (W - L - R)) / (data.length - 1))
  const y = (v) => T + (H - T - B) * (1 - v / 100)
  const segs = (key) => {
    const out = []; let cur = []
    data.forEach((d, i) => { if (d[key] == null) { if (cur.length) out.push(cur); cur = [] } else cur.push([x(i), y(d[key])]) })
    if (cur.length) out.push(cur)
    return out
  }
  const lines = [['score', 'Day score %', 'var(--v2-blue, #3B82F6)'], ['done', 'Actions done %', 'var(--v2-green, #10B981)']]
  const has = data.some((d) => d.score != null || d.done != null)
  const ticks = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [0]
  const last = (key) => [...data].reverse().find((d) => d[key] != null)?.[key]
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginBottom: 6 }}>
        {lines.map(([k, label, col]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 3, borderRadius: 999, background: col }} aria-hidden="true" />
            {label}{last(k) != null ? ` · latest ${last(k)}%` : ''}
          </span>
        ))}
      </div>
      {!has ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>No scores or actions in these days yet.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Day score and actions done over ${data.length} days`}>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--v2-line, #334155)" strokeWidth="1" />
              <text x={L - 6} y={y(v) + 4} fontSize="12" textAnchor="end" fill="var(--v2-ink-2, #94a3b8)">{v}%</text>
            </g>
          ))}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 6} fontSize="12" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fill="var(--v2-ink-2, #94a3b8)">{fmtDateShort(data[i].day).slice(0, 5)}</text>
          ))}
          {lines.map(([k, , col]) => (
            <g key={k}>
              {segs(k).filter((pts) => pts.length > 1).map((pts, j) => (
                <polyline key={j} points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {data.map((d, i) => d[k] == null ? null : <circle key={i} cx={x(i)} cy={y(d[k])} r="3" fill={col}><title>{`${fmtDateShort(d.day)}: ${d[k]}%`}</title></circle>)}
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}
