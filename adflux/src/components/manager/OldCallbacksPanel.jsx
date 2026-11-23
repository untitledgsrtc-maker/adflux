// src/components/manager/OldCallbacksPanel.jsx
//
// Phase 567 — the sales head's list of overdue callbacks, oldest first.
// Reads follow_ups directly: RLS (Phase 564) already limits the rows to the
// reps assigned to him and to PRIVATE leads. Bulk close goes through the
// gated RPC manager_close_followups (closes only his reps' rows, marks the
// note 'Auto-closed' so it never counts as the rep's own done work).

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, PhoneCall, CheckSquare, Square } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchAllPages } from '../../utils/fetchAllPages'
import { keepInFollowupQueue } from '../../utils/followups'
import { istTodayISO } from '../../utils/istDate'
import { confirmDialog } from '../v2/ConfirmDialog'
import { toastError, toastSuccess } from '../v2/Toast'

const PAGE = 40

function daysOverdue(dateISO, todayISO) {
  const a = new Date(`${dateISO}T00:00:00Z`).getTime()
  const b = new Date(`${todayISO}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((b - a) / 86400000))
}

export default function OldCallbacksPanel({ reps }) {
  const navigate = useNavigate()
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [minDays, setMinDays]   = useState(7)
  const [picked, setPicked]     = useState(() => new Set())
  const [shown, setShown]       = useState(PAGE)
  const [closing, setClosing]   = useState(false)

  const today = istTodayISO()
  const repName = useMemo(() => Object.fromEntries((reps || []).map(r => [r.id, r.name])), [reps])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    // Phase 647 - read every page (.limit(1500) still stopped at the 1000-row server cap).
    const { data, error: err } = await fetchAllPages((f, t) => supabase
      .from('follow_ups')
      .select('id, follow_up_date, follow_up_time, note, assigned_to, lead_id, cadence_type, lead:leads(id, name, company, stage)')
      .eq('is_done', false)
      .not('lead_id', 'is', null)
      .lte('follow_up_date', today)
      .order('follow_up_date', { ascending: true })
      .order('id')
      .range(f, t))
    if (err) { setError(err.message || 'Could not load callbacks'); setLoading(false); return }
    setRows((data || []).filter(keepInFollowupQueue))
    setPicked(new Set())
    setLoading(false)
  }, [today])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => rows.filter(r =>
    (!repFilter || r.assigned_to === repFilter) &&
    daysOverdue(r.follow_up_date, today) >= minDays
  ), [rows, repFilter, minDays, today])

  const slice = visible.slice(0, shown)
  const allShownPicked = slice.length > 0 && slice.every(r => picked.has(r.id))

  function toggle(id) {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllShown() {
    setPicked(prev => {
      const n = new Set(prev)
      if (allShownPicked) slice.forEach(r => n.delete(r.id))
      else slice.forEach(r => n.add(r.id))
      return n
    })
  }

  async function closeSelected() {
    const ids = [...picked]
    if (ids.length === 0 || closing) return
    const ok = await confirmDialog({
      title: 'Close old callbacks?',
      message: `Close ${ids.length} callback${ids.length === 1 ? '' : 's'}? The leads stay open. Only the reminder is closed, and it will not count as the rep's work.`,
      confirmLabel: 'Close callbacks',
      danger: true,
    })
    if (!ok) return
    setClosing(true)
    const { data, error: err } = await supabase.rpc('manager_close_followups', { p_ids: ids })
    setClosing(false)
    if (err) { toastError(err, 'Could not close callbacks.'); return }
    toastSuccess(`${data ?? 0} callback${data === 1 ? '' : 's'} closed.`)
    load()
  }

  const sel = {
    minHeight: 44, padding: '0 12px', borderRadius: 10, fontSize: 14,
    background: 'var(--v2-bg-2, #0f172a)', color: 'var(--v2-ink-0, #f1f5f9)',
    border: '1px solid var(--v2-line, #334155)',
  }

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{
            fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 13, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--v2-ink-2, #94a3b8)',
          }}>Old callbacks</div>
          <div style={{ fontSize: 14, color: 'var(--v2-ink-1, #cbd5e1)', marginTop: 2 }}>
            {loading ? 'Loading…' : `${visible.length} overdue, oldest first`}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <select aria-label="Filter by rep" style={sel} value={repFilter} onChange={e => { setRepFilter(e.target.value); setShown(PAGE) }}>
            <option value="">All reps</option>
            {(reps || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select aria-label="Minimum days overdue" style={sel} value={minDays} onChange={e => { setMinDays(Number(e.target.value)); setShown(PAGE) }}>
            <option value={1}>1+ days overdue</option>
            <option value={7}>7+ days overdue</option>
            <option value={14}>14+ days overdue</option>
            <option value={30}>30+ days overdue</option>
          </select>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, color: 'var(--v2-ink-2, #94a3b8)' }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} /> Loading callbacks…
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: 16, borderRadius: 14, background: 'rgba(239,68,68,0.10)', color: 'var(--v2-rose, #EF4444)', display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button type="button" onClick={load} style={{ ...sel, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div style={{ padding: 28, borderRadius: 14, background: 'var(--v2-bg-1, #1e293b)', border: '1px dashed var(--v2-line, #334155)', textAlign: 'center', color: 'var(--v2-ink-2, #94a3b8)' }}>
          No overdue callbacks for this filter.
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={toggleAllShown} style={{ ...sel, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              {allShownPicked ? <CheckSquare size={16} /> : <Square size={16} />}
              {allShownPicked ? 'Unselect shown' : 'Select shown'}
            </button>
            <button
              type="button"
              onClick={closeSelected}
              disabled={picked.size === 0 || closing}
              style={{
                minHeight: 44, padding: '0 16px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                cursor: picked.size === 0 || closing ? 'not-allowed' : 'pointer',
                background: picked.size === 0 ? 'var(--v2-bg-2, #0f172a)' : 'var(--v2-yellow, #FFE600)',
                color: picked.size === 0 ? 'var(--v2-ink-2, #94a3b8)' : 'var(--accent-fg, #0f172a)',
                border: '1px solid var(--v2-line, #334155)',
              }}
            >
              {closing ? 'Closing…' : `Close selected (${picked.size})`}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {slice.map(r => {
              const d = daysOverdue(r.follow_up_date, today)
              const on = picked.has(r.id)
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
                  background: 'var(--v2-bg-1, #1e293b)',
                  border: `1px solid ${on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-line, #334155)'}`,
                }}>
                  <button
                    type="button" aria-label={on ? 'Unselect callback' : 'Select callback'} aria-pressed={on}
                    onClick={() => toggle(r.id)}
                    style={{ minWidth: 44, minHeight: 44, display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', color: on ? 'var(--v2-yellow, #FFE600)' : 'var(--v2-ink-2, #94a3b8)', cursor: 'pointer' }}
                  >
                    {on ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.lead?.name || r.lead?.company || 'Lead'}{r.lead?.company && r.lead?.name ? ` · ${r.lead.company}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 2 }}>
                      {repName[r.assigned_to] || 'Rep'} · {r.lead?.stage || '—'}{r.note ? ` · ${r.note}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontFamily: 'var(--v2-display, "Space Grotesk")', fontSize: 17, fontWeight: 700, color: d >= 14 ? 'var(--v2-rose, #EF4444)' : 'var(--v2-amber, #F59E0B)' }}>{d}d</div>
                    <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)' }}>overdue</div>
                  </div>
                  <button
                    type="button" aria-label="Open lead" onClick={() => navigate(`/leads/${r.lead_id}`)}
                    style={{ minWidth: 44, minHeight: 44, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'var(--v2-bg-2, #0f172a)', border: '1px solid var(--v2-line, #334155)', color: 'var(--v2-ink-1, #cbd5e1)', cursor: 'pointer' }}
                  >
                    <PhoneCall size={16} />
                  </button>
                </div>
              )
            })}
          </div>

          {visible.length > shown && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" onClick={() => setShown(s => s + PAGE)} style={{ ...sel, cursor: 'pointer' }}>
                Show more ({visible.length - shown} left)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
