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

export default function LeadsCollectedChart({ onDayClick }) {
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
        <div>
          <div style={styles.title}>Leads Collected</div>
          <div style={styles.sub}>Click a bar to filter the table to that day</div>
        </div>
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
        /* Phase 44.3 — bars match AdminDashboard RevenueTrendPanel
           spec exactly: yellow gradient (top 88% → bottom 45%),
           radius 6 6 0 0, min-height 6 even for empty days, count
           label absolute -18 above each bar, day label uppercase
           10/600 letter-spacing below. Today gets the brighter
           is-current gradient + glow. */
        <div style={styles.barsWrap}>
          {rows.map((r, i) => {
            const h = Math.max(6, Math.round((r.count / yMax) * 170))
            const isToday = r.date === today
            const clickable = !!onDayClick && r.count > 0
            return (
              <button
                key={r.date}
                type="button"
                onClick={clickable ? () => onDayClick(r.date) : undefined}
                disabled={!clickable}
                title={clickable
                  ? `Open ${r.count} lead${r.count > 1 ? 's' : ''} from ${fmtDayLabel(r.date)}`
                  : `${fmtDayLabel(r.date)}: ${r.count} leads`}
                style={{
                  ...styles.barCol,
                  cursor: clickable ? 'pointer' : 'default',
                }}
              >
                <div style={{
                  ...styles.bar,
                  height: h,
                  background: isToday
                    ? 'linear-gradient(180deg, #FFE600, #f59e0b)'
                    : 'linear-gradient(180deg, rgba(255,230,0,.88), rgba(255,230,0,.45))',
                  boxShadow: isToday ? '0 0 0 2px rgba(255,230,0,.18)' : 'none',
                }}>
                  <div style={styles.barValue}>{r.count > 0 ? r.count : '0'}</div>
                </div>
                <div style={styles.dayLabel}>{fmtDayLabel(r.date)}</div>
              </button>
            )
          })}
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
    fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
    fontSize: 14, fontWeight: 700,
    color: 'var(--v2-ink-0, var(--text))',
    letterSpacing: '0.02em',
  },
  sub: {
    fontSize: 11, color: 'var(--v2-ink-2, var(--text-muted))',
    marginTop: 2,
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
  /* Phase 44.3 — bar styles mirror .v2d-bars / .v2d-bar from
     v2.css (RevenueTrendPanel). One-row flex with gap, bars grow
     up from baseline. Height computed inline per bar. */
  barsWrap: {
    display: 'flex', alignItems: 'flex-end',
    gap: 6, height: 200,
    padding: '24px 4px 0',
    overflowX: 'auto',
  },
  barCol: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'flex-end',
    gap: 6, height: '100%',
    flex: '1 0 28px', minWidth: 28,
    background: 'transparent', border: 0, padding: 0,
    color: 'inherit', font: 'inherit', textAlign: 'inherit',
  },
  bar: {
    width: '100%',
    borderRadius: '6px 6px 0 0',
    minHeight: 6,
    position: 'relative',
    transition: 'height 220ms ease',
  },
  barValue: {
    position: 'absolute', top: -18, left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
    fontSize: 10, fontWeight: 700,
    color: 'var(--v2-ink-0, var(--text))',
    whiteSpace: 'nowrap',
  },
  dayLabel: {
    fontSize: 10,
    color: 'var(--v2-ink-2, var(--text-muted))',
    fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
}
