// src/components/coach/CoachActions.jsx
//
// Phase 574 — "Tomorrow's 3 actions" inside the evening Day Summary card
// (sales + telecallers). On open it asks the database to rebuild the rep's own
// actions (coach_build_mine, self only), then shows them in English + Gujarati,
// plus how many of the last checked day's actions were done. Advice only.

import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lightbulb, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { coachText, coachLink } from '../../utils/coachText'

// Phase 575 — roles that get evening actions (sales/TC in the Day Summary card, office staff on My Work)
const COACH_ROLES = ['sales', 'telecaller', 'staff', 'hr', 'accounts', 'office_admin']

export default function CoachActions({ userId, role }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [forDate, setForDate] = useState(null)
  const [actions, setActions] = useState([])
  const [last, setLast]       = useState(null) // { date, done, total }

  const load = useCallback(async () => {
    if (!userId || !COACH_ROLES.includes(role)) return
    setLoading(true); setError('')
    const { data: d, error: bErr } = await supabase.rpc('coach_build_mine')
    if (bErr) { setError(bErr.message || 'Could not load suggestions'); setLoading(false); return }
    const [{ data: next, error: nErr }, { data: checked }] = await Promise.all([
      supabase.from('coach_actions').select('id, kind, detail, lead_id, quote_id, rank')
        .eq('user_id', userId).eq('for_date', d).order('rank'),
      supabase.from('coach_actions').select('for_date, done')
        .eq('user_id', userId).not('checked_at', 'is', null)
        .order('for_date', { ascending: false }).limit(10),
    ])
    if (nErr) { setError(nErr.message || 'Could not load suggestions'); setLoading(false); return }
    setForDate(d)
    setActions(next || [])
    if (checked && checked.length) {
      const day = checked[0].for_date
      const rows = checked.filter(r => r.for_date === day)
      setLast({ date: day, done: rows.filter(r => r.done).length, total: rows.length })
    } else {
      setLast(null)
    }
    setLoading(false)
  }, [userId, role])

  useEffect(() => { load() }, [load])

  if (!COACH_ROLES.includes(role)) return null

  const dayLabel = forDate
    ? new Date(`${forDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
    : ''

  return (
    <div style={{
      marginTop: 14, padding: 14, borderRadius: 14,
      background: 'var(--v2-bg-2, #0f172a)', border: '1px solid var(--v2-line, #334155)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Lightbulb size={16} strokeWidth={1.6} color="var(--v2-yellow, #FFE600)" />
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          Your 3 actions for {dayLabel || 'tomorrow'}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--v2-ink-2, #94a3b8)', marginTop: 2 }}>
        કાલના 3 કામ · checked automatically at night
      </div>

      {last && (
        <div style={{ marginTop: 8, fontSize: 12, color: last.done === last.total ? 'var(--v2-green, #10B981)' : 'var(--v2-amber, #F59E0B)' }}>
          Last time: {last.done} of {last.total} done · છેલ્લી વખત {last.total} માંથી {last.done} પૂરા
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', fontSize: 13, color: 'var(--v2-ink-2, #94a3b8)' }}>
          <Loader2 size={14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} /> Preparing your suggestions…
        </div>
      )}

      {!loading && error && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'var(--danger-soft, rgba(239,68,68,0.12))', color: 'var(--v2-rose, #EF4444)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button type="button" onClick={load} style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--v2-line, #334155)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {!loading && !error && actions.length === 0 && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--v2-ink-1, #cbd5e1)' }}>
          Nothing pending. Keep the same pace tomorrow.
          <div style={{ color: 'var(--v2-ink-2, #94a3b8)', marginTop: 2 }}>કંઈ બાકી નથી. કાલે પણ આ જ ગતિ રાખો.</div>
        </div>
      )}

      {!loading && !error && actions.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {actions.map((a, i) => {
            const t = coachText(a.kind, a.detail)
            const to = coachLink(a)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => to && navigate(to)}
                disabled={!to}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  minHeight: 44, padding: '10px 12px', borderRadius: 10, fontFamily: 'inherit',
                  background: 'var(--v2-bg-1, #1e293b)', border: '1px solid var(--v2-line, #334155)',
                  color: 'var(--v2-ink-0, #f1f5f9)', cursor: to ? 'pointer' : 'default',
                }}
              >
                <span style={{
                  flex: '0 0 auto', width: 22, height: 22, borderRadius: 999, display: 'grid', placeItems: 'center',
                  background: 'var(--v2-yellow, #FFE600)', color: 'var(--accent-fg, #0f172a)', fontSize: 12, fontWeight: 700,
                }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, lineHeight: 1.35 }}>{t.en}</span>
                  <span style={{ display: 'block', fontSize: 13, lineHeight: 1.35, marginTop: 2, color: 'var(--v2-ink-2, #94a3b8)' }}>{t.gu}</span>
                </span>
                {to && <ChevronRight size={16} strokeWidth={1.6} color="var(--v2-ink-2, #94a3b8)" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
