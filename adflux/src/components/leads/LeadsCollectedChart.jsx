// src/components/leads/LeadsCollectedChart.jsx
//
// Phase 44.1 — Leads Collected daily bar chart.
//
// Owner directive (18 May 2026): mirror the "Leads Collected"
// chart from the external CRM screenshot. One bar per day with the
// count above, date range picker + segment + source (Audience)
// filters, auto-scaled Y axis.
//
// Renders at the top of /leads (LeadsV2). Read-only — does not
// touch the existing filter store or the leads table below.
//
// Data:
//   leads where created_at BETWEEN from AND to, grouped by date.
//   Optional .eq('segment', s) and .eq('source', src) filters.
//
// Default range: last 30 days inclusive (so today's bar is the
// last one on the right).

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

function istTodayISO() {
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000)
  return ist.toISOString().slice(0, 10)
}

function isoMinusDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function fmtDayLabel(iso) {
  // "19 Apr" — matches the screenshot.
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', timeZone: 'UTC',
  })
}

function fmtRangeLabel(from, to) {
  const f = new Date(from + 'T00:00:00Z')
  const t = new Date(to   + 'T00:00:00Z')
  const fmt = (d) => d.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  })
  return `${fmt(f)} - ${fmt(t)}`
}

export default function LeadsCollectedChart() {
  const today = istTodayISO()
  const [from, setFrom] = useState(isoMinusDays(today, 29))
  const [to,   setTo]   = useState(today)
  const [segment, setSegment] = useState('all')
  const [source,  setSource]  = useState('all')

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState([])       // [{date, count}]
  const [sources, setSources] = useState([]) // distinct source list

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setErr('')

      let q = supabase
        .from('leads')
        .select('id, created_at, segment, source')
        .gte('created_at', `${from}T00:00:00`)
        .lte('created_at', `${to}T23:59:59`)
        .limit(20000)
      if (segment !== 'all') {
        // Private rows historically have segment=null (pre-Phase 4).
        if (segment === 'private') {
          q = q.or('segment.eq.PRIVATE,segment.is.null')
        } else {
          q = q.eq('segment', segment.toUpperCase())
        }
      }
      if (source !== 'all') q = q.eq('source', source)

      const { data, error } = await q
      if (cancelled) return
      if (error) { setErr(error.message); setLoading(false); return }

      // Bucket by date.
      const bucket = new Map()
      for (const r of (data || [])) {
        const d = (r.created_at || '').slice(0, 10)
        if (!d) continue
        bucket.set(d, (bucket.get(d) || 0) + 1)
      }
      // Fill every day in range (including zero days) so the X axis is
      // continuous and not just sparse.
      const out = []
      let cursor = from
      while (cursor <= to) {
        out.push({ date: cursor, count: bucket.get(cursor) || 0 })
        cursor = isoMinusDays(cursor, -1)
      }
      setRows(out)

      // Build distinct source list (separate query so the dropdown
      // shows all sources, not just ones in current date range).
      const { data: src } = await supabase
        .from('leads')
        .select('source')
        .not('source', 'is', null)
        .limit(2000)
      if (cancelled) return
      const uniq = Array.from(new Set((src || []).map(r => r.source).filter(Boolean))).sort()
      setSources(uniq)

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [from, to, segment, source])

  const maxCount = useMemo(
    () => Math.max(1, ...rows.map(r => r.count)),
    [rows]
  )
  // Round up to a nice grid line (50 / 60 / 100 / 240 / 300 etc).
  const yMax = useMemo(() => {
    const m = maxCount
    if (m <= 5)   return 5
    if (m <= 10)  return 10
    if (m <= 30)  return 30
    if (m <= 60)  return 60
    if (m <= 120) return 120
    if (m <= 180) return 180
    if (m <= 240) return 240
    if (m <= 300) return 300
    return Math.ceil(m / 100) * 100
  }, [maxCount])

  return (
    <div style={styles.card}>
      {/* Header row: title + filters. Phase 44.2 — single date range
          (from/to inputs side-by-side, no duplicate visible pill). */}
      <div style={styles.head}>
        <div style={styles.title}>Leads Collected</div>
        <div style={styles.filters}>
          <div style={styles.rangeBox}>
            <input
              type="date" value={from}
              onChange={e => setFrom(e.target.value)}
              max={to}
              style={styles.dateInline}
              title="Start date"
            />
            <span style={styles.rangeSep}>→</span>
            <input
              type="date" value={to}
              onChange={e => setTo(e.target.value)}
              min={from} max={today}
              style={styles.dateInline}
              title="End date"
            />
          </div>
          <select value={segment} onChange={e => setSegment(e.target.value)} style={styles.select}>
            <option value="all">All segments</option>
            <option value="private">Private</option>
            <option value="government">Government</option>
          </select>
          <select value={source} onChange={e => setSource(e.target.value)} style={styles.select}>
            <option value="all">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={styles.loadingBox}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : err ? (
        <div style={styles.errBox}>
          <AlertTriangle size={14} /> {err}
        </div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>No leads in this range.</div>
      ) : (
        <div style={styles.chartWrap}>
          {/* Y-axis labels (4 ticks). */}
          <div style={styles.yAxis}>
            {[yMax, Math.round(yMax * 0.8), Math.round(yMax * 0.6), Math.round(yMax * 0.4), Math.round(yMax * 0.2), 0].map((v, i) => (
              <div key={i} style={styles.yTick}>{v}</div>
            ))}
          </div>
          {/* Bars + day labels */}
          <div style={styles.barsWrap}>
            <div style={styles.bars}>
              {rows.map(r => {
                const h = (r.count / yMax) * 100
                // Phase 44.2 — brand-yellow bars. Full saturation at
                // top, faded for lower bars so the eye still groups
                // them without using a non-brand colour.
                const isHi = r.count >= yMax * 0.6
                return (
                  <div key={r.date} style={styles.barCol} title={`${r.count} leads on ${r.date}`}>
                    <div style={styles.countLabel}>{r.count > 0 ? r.count : ''}</div>
                    <div style={styles.barTrack}>
                      <div style={{
                        ...styles.barFill,
                        height: `${Math.max(r.count > 0 ? 4 : 0, h)}%`,
                        background: 'var(--v2-yellow, #FFE600)',
                        opacity: r.count === 0 ? 0 : isHi ? 1 : 0.62,
                      }} />
                    </div>
                    <div style={styles.dayLabel}>{fmtDayLabel(r.date)}</div>
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

const styles = {
  card: {
    background: 'var(--v2-bg-1, var(--surface))',
    border: '1px solid var(--v2-line, var(--border))',
    borderRadius: 14,
    padding: '18px 20px',
    marginBottom: 16,
  },
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 10, marginBottom: 14, flexWrap: 'wrap',
  },
  title: {
    fontSize: 14, fontWeight: 700,
    color: 'var(--v2-ink-0, var(--text))',
    letterSpacing: '0.02em',
  },
  filters: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  // Phase 44.2 — single date range pill with two inline inputs.
  rangeBox: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 32, padding: '0 10px',
    background: 'var(--v2-bg-2, var(--surface))',
    border: '1px solid var(--v2-line, var(--border))',
    borderRadius: 8,
  },
  dateInline: {
    height: 24, padding: '0 4px',
    background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--v2-ink-1, var(--text))',
    fontSize: 12, fontFamily: 'inherit',
    colorScheme: 'dark',
  },
  rangeSep: {
    fontSize: 12, color: 'var(--v2-ink-2, var(--text-muted))',
    padding: '0 2px',
  },
  select: {
    height: 32, padding: '0 28px 0 10px',
    background: 'var(--v2-bg-2, var(--surface))',
    border: '1px solid var(--v2-line, var(--border))',
    borderRadius: 8,
    color: 'var(--v2-ink-1, var(--text))',
    fontSize: 12, fontFamily: 'inherit',
    minWidth: 100,
  },
  loadingBox: {
    padding: 60, textAlign: 'center',
    color: 'var(--v2-ink-2, var(--text-muted))',
  },
  errBox: {
    padding: '10px 14px',
    background: 'rgba(239,68,68,.08)',
    border: '1px solid rgba(239,68,68,.25)',
    borderRadius: 8, fontSize: 12,
    color: 'var(--v2-rose, var(--danger))',
    display: 'flex', alignItems: 'center', gap: 6,
  },
  empty: {
    padding: 40, textAlign: 'center',
    fontSize: 13, color: 'var(--v2-ink-2, var(--text-muted))',
  },
  chartWrap: {
    display: 'flex', gap: 10, height: 230,
  },
  yAxis: {
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    paddingBottom: 24, paddingTop: 18,
    fontSize: 10, color: 'var(--v2-ink-2, var(--text-muted))',
    minWidth: 28, textAlign: 'right',
  },
  yTick: { lineHeight: 1 },
  barsWrap: { flex: 1, overflowX: 'auto' },
  bars: {
    display: 'flex', alignItems: 'flex-end',
    gap: 6, height: '100%', minWidth: '100%',
  },
  barCol: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-end',
    flex: '1 0 28px', minWidth: 28, height: '100%',
  },
  countLabel: {
    fontSize: 10, fontWeight: 600,
    color: 'var(--v2-ink-1, var(--text))',
    marginBottom: 4, minHeight: 14, lineHeight: 1,
  },
  barTrack: {
    width: '100%', flex: 1,
    display: 'flex', alignItems: 'flex-end',
  },
  barFill: {
    width: '100%',
    borderRadius: '4px 4px 0 0',
    transition: 'height 220ms ease',
  },
  dayLabel: {
    fontSize: 10,
    color: 'var(--v2-ink-2, var(--text-muted))',
    marginTop: 6, whiteSpace: 'nowrap',
  },
}
