// Phase 469 - Team Work -> Insights (admin only). One call to work_insights (server gate: active admin).
// Headline numbers count up, the throughput line draws itself, the client donut sweeps in, workload bars fill.
// On-time = this month through the same definition as the staff pay rule (work_ontime_stats). Workload = open
// tasks due this week or earlier x the person's average hours per task, against 8 h per remaining working day.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toastError } from '../v2/Toast'
import { istTodayISO } from '../../utils/istDate'
import { addDaysISO, fmtDateShort, clientColor } from '../../utils/workUtils'
import UserAvatar from '../common/UserAvatar'

const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days']]

function useCount(to, dec = 0) {
  const [v, setV] = useState(0)
  useEffect(() => {
    const target = Number(to) || 0
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    let raf; const t0 = performance.now(); const dur = 900
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); setV(target * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step)
    const done = setTimeout(() => setV(target), dur + 150)
    return () => { cancelAnimationFrame(raf); clearTimeout(done) }
  }, [to])
  return v.toFixed(dec)
}

function Kpi({ label, value, dec = 0, suffix = '', delta, good, delay, note, neutral }) {
  const shown = useCount(value, dec)
  return (
    <div className="wk-in-k" style={{ animationDelay: `${delay}s` }}>
      <small>{label}</small>
      <b>{shown}{suffix}</b>
      {delta != null && <i className={neutral ? '' : good ? 'ok' : 'bad'}>{delta}</i>}
      {note && <span className="wk-sm" style={{ display: 'block', marginTop: 2 }}>{note}</span>}
    </div>
  )
}

// Phase 488: a % change against a tiny earlier number is meaningless (+3,360%), so say there is no earlier data instead
const pctDelta = (a, b, min = 10) => (b >= min ? `${a >= b ? '+' : '-'}${Math.round(Math.abs(a - b) / b * 100)}%` : null)
const NO_PREV = 'no earlier data'

export default function InsightsTab({ nameOf, projName }) {
  const [range, setRange] = useState('30')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [animKey, setAnimKey] = useState(0)
  const [sweep, setSweep] = useState(false)
  const latch = useRef(0)

  const load = useCallback(async () => {
    const my = ++latch.current
    setLoading(true); setErr('')
    const to = istTodayISO()
    const { data: d, error } = await supabase.rpc('work_insights', { p_from: addDaysISO(to, -(Number(range) - 1)), p_to: to })
    if (my !== latch.current) return
    if (error) { setErr(error.message || 'Could not load.'); setLoading(false); return }
    if (!d || !d.kpis) { setErr('Insights are for the admin only.'); setLoading(false); return }
    setData(d); setLoading(false); setAnimKey((k) => k + 1); setSweep(false)
    setTimeout(() => { if (my === latch.current) setSweep(true) }, 60)
  }, [range])
  useEffect(() => { load() }, [load])

  const k = data?.kpis, ot = data?.ontime
  const hours = k ? k.seconds / 3600 : 0
  const finDelta = k ? pctDelta(k.finished_hand, k.finished_hand_prev) : null
  const hoursPrev = k ? k.seconds_prev / 3600 : 0
  const hoursDelta = pctDelta(hours, hoursPrev, 10)
  const otPct = ot && ot.counted > 0 ? Math.round(ot.on_time / ot.counted * 100) : 0
  const otPrev = ot && ot.counted_prev >= 5 ? Math.round(ot.on_time_prev / ot.counted_prev * 100) : null

  const chart = useMemo(() => {
    if (!data) return null
    const A = data.series.this.map((x) => x.n), B = data.series.prev.map((x) => x.n)
    const m = Math.max(4, ...A, ...B), W = 520, H = 170
    const path = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${(i * W / Math.max(1, a.length - 1)).toFixed(1)} ${(H - v / m * H).toFixed(1)}`).join(' ')
    const last = A.length ? A[A.length - 1] : 0
    return { pa: path(A), pb: path(B), m, W, H, endY: H - last / m * H, first: data.series.this[0]?.d, lastD: data.series.this[data.series.this.length - 1]?.d }
  }, [data])

  const clients = useMemo(() => {
    if (!data) return []
    const rows = data.by_client.map((c) => ({ name: projName(c.project_id) || 'No client', s: c.seconds }))
    const total = rows.reduce((a, r) => a + r.s, 0) || 1
    const top = rows.slice(0, 4).map((r) => ({ ...r, pct: Math.round(r.s / total * 100), col: clientColor(r.name) }))
    const rest = rows.slice(4).reduce((a, r) => a + r.s, 0)
    if (rest > 0) top.push({ name: 'Other clients', s: rest, pct: Math.round(rest / total * 100), col: '#9ca3af' })
    return top
  }, [data, projName])

  const exportCsv = () => {
    if (!data) return
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Day', 'Tasks finished (by hand)', 'All finished incl. system'].map(esc).join(',')]
    data.series.this.forEach((r) => lines.push([fmtDateShort(r.d), r.n, r.n_all ?? r.n].map(esc).join(',')))
    lines.push('', ['Person', 'Open tasks', 'Avg hours per task', 'Open work (h)', 'Capacity this week (h)'].map(esc).join(','))
    data.workload.forEach((w) => lines.push([nameOf(w.user_id), w.open, w.avg_hours, w.est_hours, w.capacity_hours].map(esc).join(',')))
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `work-insights-${istTodayISO()}.csv`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000)
  }

  const R = 44, C = 2 * Math.PI * R
  let off = 0

  return (
    <div className="wk-in">
      <div className="wk-in-row">
        <div className="wk-sm">Admin only. How the work team did over the selected days.</div>
        <div className="wk-in-row" style={{ gap: 8 }}>
          <div className="wk-in-seg" role="group" aria-label="Period">
            {RANGES.map(([v, l]) => <button key={v} type="button" className={range === v ? 'on' : ''} onClick={() => setRange(v)}>{l}</button>)}
          </div>
          <button type="button" className="wk-btn o sm" onClick={exportCsv} disabled={!data}><Download size={14} aria-hidden="true" /> Export CSV</button>
        </div>
      </div>

      {err && <div className="wk-err" role="alert"><span>{err}</span><button className="wk-btn g sm" onClick={load}>Retry</button></div>}
      {loading && !data && !err && <div className="wk-empty"><Loader2 className="spin" size={26} aria-hidden="true" /></div>}

      {data && !err && (
        <div key={animKey} style={{ display: 'grid', gap: 16, opacity: loading ? .6 : 1 }}>
          <div className="wk-in-kpis">
            <Kpi label="Tasks finished (made by hand)" value={k.finished_hand} delta={finDelta ?? NO_PREV} neutral={finDelta == null} good={k.finished_hand >= k.finished_hand_prev} note={k.finished_auto > 0 ? `+ ${k.finished_auto} system tasks (repeating, HR, finance)` : null} delay={0} />
            <Kpi label="On-time rate, this month" value={otPct} suffix="%" delta={otPrev != null ? `${otPct >= otPrev ? '+' : '-'}${Math.abs(otPct - otPrev)} pts` : NO_PREV} neutral={otPrev == null} good={otPrev == null || otPct >= otPrev} note={`${ot.on_time} of ${ot.counted} tasks · whole month, not the days picked`} delay={.08} />
            <Kpi label="Hours tracked" value={hours} suffix="h" delta={hoursDelta ?? NO_PREV} neutral={hoursDelta == null} good={hours >= hoursPrev} delay={.16} />
            <Kpi label="Avg time to finish (by hand)" value={k.avg_days ?? 0} dec={1} suffix="d" delta={k.finished_hand_prev >= 10 && k.avg_days_prev != null && k.avg_days != null ? `${k.avg_days <= k.avg_days_prev ? '-' : '+'}${Math.abs(k.avg_days - k.avg_days_prev).toFixed(1)}d` : null} good={k.avg_days == null || k.avg_days_prev == null || k.avg_days <= k.avg_days_prev} delay={.24} />
          </div>
          <div className="wk-in-two">
            <div className="wk-in-card">
              <h3>Tasks finished each day (made by hand)</h3>
              <p>{fmtDateShort(chart.first)} to {fmtDateShort(chart.lastD)}, against the same number of days before</p>
              <div className="wk-in-lg"><span><em style={{ background: '#1baf7a' }} />This period</span><span><em style={{ background: '#b4b2a9' }} />Before</span></div>
              <svg viewBox={`0 0 ${chart.W} ${chart.H + 6}`} width="100%" role="img" aria-label={`Tasks finished per day, ${k.finished_hand} in this period`}>
                {[0, 1, 2, 3, 4].map((i) => <line key={i} x1="0" x2={chart.W} y1={chart.H - i * chart.H / 4} y2={chart.H - i * chart.H / 4} stroke="currentColor" strokeOpacity=".12" />)}
                <path d={chart.pb} fill="none" stroke="#b4b2a9" strokeWidth="2" strokeDasharray="5 4" />
                <path d={chart.pa} className="wk-in-line" pathLength="1" fill="none" stroke="#1baf7a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle className="wk-in-dot" cx={chart.W} cy={chart.endY} r="5" fill="#1baf7a" stroke="var(--w-card, #111)" strokeWidth="2" />
              </svg>
            </div>
            <div className="wk-in-card">
              <h3>Where the time went</h3>
              <p>Share of hours by client</p>
              {clients.length === 0 ? <div className="wk-sm">No hours in this period.</div> : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <svg viewBox="0 0 120 120" width="130" height="130" role="img" aria-label="Hours by client">
                    {clients.map((c, i) => { const len = C * c.pct / 100; const el = (
                      <circle key={c.name} cx="60" cy="60" r={R} fill="none" stroke={c.col} strokeWidth="16" transform="rotate(-90 60 60)"
                        strokeDasharray={sweep ? `${Math.max(0, len - 2)} ${C}` : `0 ${C}`} strokeDashoffset={-off}
                        style={{ transition: `stroke-dasharray 1s ${i * 0.18}s cubic-bezier(.2,.8,.2,1)` }} />); off += len; return el })}
                    <text x="60" y="65" textAnchor="middle" fontSize="15" fill="currentColor">{Math.round(hours)}h</text>
                  </svg>
                  <div style={{ display: 'grid', gap: 6, fontSize: 12, flex: 1, minWidth: 130 }}>
                    {clients.map((c) => <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><em style={{ width: 10, height: 10, borderRadius: 2, background: c.col, flex: 'none' }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span><b style={{ marginLeft: 'auto', fontWeight: 500 }}>{c.pct}%</b></div>)}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="wk-in-card">
            <h3>Workload this week</h3>
            <p>Open work (tasks due this week or earlier, each at the person's average hours) against 8 hours per working day left. The line marks full capacity.</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {data.workload.length === 0 && <div className="wk-sm">No people on the timeclock.</div>}
              {data.workload.map((w, i) => {
                const pct = w.capacity_hours > 0 ? Math.round(w.est_hours / w.capacity_hours * 100) : 0
                const col = pct > 100 ? '#e34948' : pct > 80 ? '#eda100' : '#1baf7a'
                return (
                  <div key={w.user_id} className="wk-in-w">
                    <span className="wk-grp" style={{ flexWrap: 'nowrap', gap: 8, minWidth: 0 }}><UserAvatar className="wk-av" userId={w.user_id} name={nameOf(w.user_id)} size={26} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(w.user_id).split(' ')[0]}</span></span>
                    <div className="wk-in-tr"><u style={{ background: col, width: sweep ? `${Math.min(pct, 125) * 0.8}%` : '0%', transitionDelay: `${i * 0.07}s` }} /><i className="cap" /></div>
                    <span className="wk-sm" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{w.est_hours}h of {w.capacity_hours}h{pct > 100 ? ' (over)' : ''} · {w.open} open</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
