// src/components/incentives/DailyScoresCard.jsx
//
// Phase 186 — rep-facing "Daily scores" on My Performance. Shows the per-day
// score_pct rows (from daily_performance) that make up the monthly average the
// rep sees on their score card + salary slip. Owner: wire the daily scores so a
// rep can see WHICH days dragged the month down.
//
// Self-fetching + read-only + RLS-safe: reads the rep's OWN daily_performance
// (dp_own policy = user_id = auth.uid()). Month stepper (can't go into the
// future). Additive; the monthly average shown here = the same number
// monthly_score averages (AVG of non-excluded score_pct).

import { useState, useEffect, useMemo } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istCurrentMonthYM } from '../../utils/istDate'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad2(n) { return String(n).padStart(2, '0') }

export default function DailyScoresCard() {
  const profile = useAuthStore((s) => s.profile)
  const isTC = profile?.role === 'telecaller'

  // Current IST month = the max month the rep can view (no future).
  const nowYM = istCurrentMonthYM() // 'YYYY-MM'
  const [curYear, curMonth] = nowYM.split('-').map(Number)

  const [ym, setYm] = useState({ y: curYear, m: curMonth })
  const [rows, setRows] = useState(null) // null=loading, []=none
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState(null)

  const atCurrent = ym.y === curYear && ym.m === curMonth

  useEffect(() => {
    let cancelled = false
    if (!profile?.id) return
    if (profile.role === 'agency') { setRows([]); return } // commission-only, no score
    setRows(null); setErr(null)
    ;(async () => {
      const start = `${ym.y}-${pad2(ym.m)}-01`
      const nextM = ym.m === 12 ? 1 : ym.m + 1
      const nextY = ym.m === 12 ? ym.y + 1 : ym.y
      const end = `${nextY}-${pad2(nextM)}-01`
      const { data, error } = await supabase
        .from('daily_performance')
        .select('work_date, score_pct, meetings_done, meetings_target, is_excluded, excluded_reason')
        .eq('user_id', profile.id)
        .gte('work_date', start)
        .lt('work_date', end)
        .order('work_date', { ascending: true })
      if (cancelled) return
      if (error) { setErr('Could not load daily scores.'); setRows([]); return }
      setRows(data || [])
    })()
    return () => { cancelled = true }
  }, [profile?.id, profile?.role, ym.y, ym.m])

  // Monthly average = AVG of non-excluded score_pct (matches monthly_score).
  const avg = useMemo(() => {
    if (!rows || !rows.length) return null
    const active = rows.filter((r) => !r.is_excluded)
    if (!active.length) return null
    const sum = active.reduce((s, r) => s + Number(r.score_pct || 0), 0)
    return Math.round((sum / active.length) * 10) / 10
  }, [rows])

  function step(delta) {
    setOpen(true)
    setYm((p) => {
      let m = p.m + delta
      let y = p.y
      if (m < 1) { m = 12; y -= 1 }
      if (m > 12) { m = 1; y += 1 }
      // never go into the future
      if (y > curYear || (y === curYear && m > curMonth)) return p
      return { y, m }
    })
  }

  if (profile?.role === 'agency') return null

  const avgColor = avg == null ? 'var(--text-subtle, #64748b)'
    : avg >= 50 ? 'var(--success, #10B981)' : 'var(--warning, #F59E0B)'

  return (
    <div
      style={{
        marginTop: 14, padding: '16px 18px', borderRadius: 14,
        background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #334155)',
      }}
    >
      {/* Header + month stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 42, height: 42, borderRadius: 10, flex: '0 0 auto',
            background: 'var(--accent-soft, rgba(255,230,0,0.14))', color: 'var(--accent, #FFE600)',
          }}
        >
          <CalendarDays size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            Daily scores
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)' }}>
            {MON_FULL[ym.m - 1]} {ym.y} · month avg{' '}
            <span className="tabular-nums" style={{ color: avgColor, fontWeight: 700 }}>
              {avg == null ? '—' : `${avg}%`}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous month"
            style={iconBtn}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => step(1)} disabled={atCurrent} aria-label="Next month"
            style={{ ...iconBtn, opacity: atCurrent ? 0.35 : 1 }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Toggle */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          marginTop: 12, width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10,
          border: '1px solid var(--border, #334155)', background: 'transparent',
          color: 'var(--text-muted, #94a3b8)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        {open ? 'Hide daily breakdown' : 'Show daily breakdown'}
        <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {err && (
            <div style={{ fontSize: 12, color: 'var(--danger, #EF4444)', padding: '6px 0' }}>{err}</div>
          )}
          {rows === null && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)', padding: '10px 0' }}>Loading…</div>
          )}
          {rows && rows.length === 0 && !err && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle, #64748b)', padding: '10px 0' }}>
              No scored days this month yet.
            </div>
          )}
          {rows && rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
              {rows.map((r) => {
                const d = new Date(`${r.work_date}T00:00:00`)
                const dateLbl = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`
                const excluded = r.is_excluded
                const pct = Number(r.score_pct || 0)
                const scoreColor = excluded ? 'var(--text-subtle, #64748b)'
                  : pct >= 50 ? 'var(--success, #10B981)' : 'var(--warning, #F59E0B)'
                return (
                  <div key={r.work_date}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 10, background: 'var(--surface-2, #334155)',
                    }}
                  >
                    <div className="tabular-nums" style={{ width: 92, fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                      {dateLbl}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--text-subtle, #64748b)' }}>
                      {excluded
                        ? (r.excluded_reason || 'Off day')
                        : <span className="tabular-nums">{r.meetings_done}/{r.meetings_target} {isTC ? 'calls' : 'meetings'}</span>}
                    </div>
                    <div className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: scoreColor, width: 48, textAlign: 'right' }}>
                      {excluded ? '—' : `${Math.round(pct)}%`}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const iconBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 10, cursor: 'pointer',
  border: '1px solid var(--border, #334155)', background: 'transparent',
  color: 'var(--text-muted, #94a3b8)',
}
