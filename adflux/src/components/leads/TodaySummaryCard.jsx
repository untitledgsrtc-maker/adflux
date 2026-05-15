// src/components/leads/TodaySummaryCard.jsx
//
// Phase 34Z.61 — one-line "today's load" summary for /work.
//
// Owner directive (15 May 2026): "When checking in the today page,
// somebody should show there. Like today you have 10 follow-ups
// and 3 meetings and 2 schedule meetings."
//
// Reads three counts for the signed-in rep:
//   • Follow-ups due today + overdue            (follow_ups)
//   • Planned meetings on today's work_session  (planned_meetings)
//   • Scheduled future meetings (future follow_ups whose note starts
//                                with "Meeting" — Phase 34Z.60 source)
// Falls back to a single empty state when all three are 0.

import { useEffect, useState } from 'react'
import { Clock, Calendar, CalendarClock, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

export default function TodaySummaryCard({ userId, session }) {
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const today = TODAY_ISO()

      const [fuRes, mtRes] = await Promise.all([
        // Follow-ups: due today or overdue, not done.
        supabase.from('follow_ups')
          .select('id, follow_up_date, note', { count: 'exact', head: false })
          .eq('assigned_to', userId)
          .eq('is_done', false)
          .lte('follow_up_date', today),
        // Scheduled meetings: future follow_ups whose note starts with
        // "Meeting" (Phase 34Z.60 prefix). Counted separately so the
        // rep sees the breakdown between "you have to call X" and
        // "you have meetings booked."
        supabase.from('follow_ups')
          .select('id, follow_up_date, note', { count: 'exact', head: false })
          .eq('assigned_to', userId)
          .eq('is_done', false)
          .gt('follow_up_date', today)
          .ilike('note', 'Meeting%'),
      ])

      if (cancelled) return
      setCounts({
        followUps: fuRes.data?.length || 0,
        scheduledMeetings: mtRes.data?.length || 0,
        // Today's planned meetings from work_sessions.planned_meetings.
        // Lives on the session JSON; null-safe.
        plannedMeetings: Array.isArray(session?.planned_meetings)
          ? session.planned_meetings.filter(m => (m.client || '').trim() || (m.location || '').trim()).length
          : 0,
      })
    })()
    return () => { cancelled = true }
  }, [userId, session?.planned_meetings])

  if (!counts) {
    return (
      <div className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 12 }}>Loading today's load…</span>
      </div>
    )
  }

  const total = counts.followUps + counts.plannedMeetings + counts.scheduledMeetings
  if (total === 0) {
    return (
      <div className="m-card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No follow-ups, no meetings booked. Add a lead or send a quote while you have a minute.
      </div>
    )
  }

  const cells = [
    { icon: Clock,         tint: 'var(--warning, #F59E0B)', label: 'Follow-ups',          n: counts.followUps },
    { icon: Calendar,      tint: 'var(--accent, #FFE600)',  label: 'Meetings today',      n: counts.plannedMeetings },
    { icon: CalendarClock, tint: 'var(--blue, #3B82F6)',    label: 'Scheduled meetings',  n: counts.scheduledMeetings },
  ]

  return (
    <div className="m-card" style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
      padding: 12,
    }}>
      {cells.map(c => {
        const Icon = c.icon
        return (
          <div
            key={c.label}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 4,
              padding: '10px 10px',
              borderRadius: 10,
              background: `${c.tint}14`,
              border: `1px solid ${c.tint}33`,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              color: c.tint, fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '.06em',
            }}>
              <Icon size={12} strokeWidth={1.8} />
              <span style={{ color: 'var(--text-muted)' }}>{c.label}</span>
            </div>
            <div style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1,
            }}>
              {c.n}
            </div>
          </div>
        )
      })}
    </div>
  )
}
