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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Calendar, CalendarClock, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import useAutoRefresh from '../../hooks/useAutoRefresh'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)

export default function TodaySummaryCard({ userId, session }) {
  const navigate = useNavigate()
  const [counts, setCounts] = useState(null)
  // Phase 34Z.62 — remember the highest follow-up count we've seen
  // this session. When the current count drops to 0 AND the high
  // mark was > 0, render the celebration row. Owner directive:
  // "after one finish, it should show 'you have finished your
  // complete follow-ups'."
  const highMarkRef = useRef(0)

  const load = useCallback(async () => {
    if (!userId) return
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

    const nextFollowUps = fuRes.data?.length || 0
    highMarkRef.current = Math.max(highMarkRef.current, nextFollowUps)
    setCounts({
      followUps: nextFollowUps,
      scheduledMeetings: mtRes.data?.length || 0,
      // Today's planned meetings from work_sessions.planned_meetings.
      // Lives on the session JSON; null-safe.
      plannedMeetings: Array.isArray(session?.planned_meetings)
        ? session.planned_meetings.filter(m => (m.client || '').trim() || (m.location || '').trim()).length
        : 0,
    })
  }, [userId, session?.planned_meetings])

  useEffect(() => { load() }, [load])
  // Phase 34Z.62 — owner reported the follow-up count stayed put
  // after he saved a call outcome. The component only refetched on
  // userId / session change. Auto-refresh on tab resume + realtime
  // sub on follow_ups so the count drops the moment a row flips to
  // is_done = true.
  useAutoRefresh(load, { enabled: !!userId })

  useEffect(() => {
    if (!userId) return
    const ch = supabase
      .channel(`today-summary-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'follow_ups', filter: `assigned_to=eq.${userId}` },
        () => { load() })
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
  }, [userId, load])

  if (!counts) {
    return (
      <div className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 12 }}>Loading today's load…</span>
      </div>
    )
  }

  const total = counts.followUps + counts.plannedMeetings + counts.scheduledMeetings

  // Phase 34Z.62 — celebration when the rep clears every follow-up
  // they had this session. Only fires when the high-mark was > 0,
  // so a fresh-mount day with 0 follow-ups still gets the gentle
  // empty state below, not a fake "you finished!" pat on the back.
  if (counts.followUps === 0 && highMarkRef.current > 0 && counts.plannedMeetings === 0 && counts.scheduledMeetings === 0) {
    return (
      <div className="m-card" style={{
        padding: 18, textAlign: 'center',
        background: 'var(--success-soft, rgba(16,185,129,0.12))',
        border: '1px solid var(--success, #10B981)',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 999, margin: '0 auto 8px',
          background: 'var(--success, #10B981)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckCircle2 size={20} strokeWidth={2} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          All follow-ups done · {highMarkRef.current} closed today
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Nothing pending. Send a quote or add a fresh lead while you're free.
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="m-card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No follow-ups, no meetings booked. Add a lead or send a quote while you have a minute.
      </div>
    )
  }

  const cells = [
    // Follow-ups → /follow-ups (full queue, default order).
    { icon: Clock,         tint: 'var(--warning, #F59E0B)', label: 'Follow-ups',          n: counts.followUps,         to: '/follow-ups' },
    // Meetings today → scroll to plan row on /work. Already on /work
    // when this card renders, so anchor scroll surfaces the planned
    // meeting list inside DayStatusSurface.
    { icon: Calendar,      tint: 'var(--accent, #FFE600)',  label: 'Meetings today',      n: counts.plannedMeetings,   to: '/work#day-status' },
    // Scheduled meetings → /follow-ups filtered to Meeting% notes
    // (Phase 34Z.63 filter param on FollowUpsV2).
    { icon: CalendarClock, tint: 'var(--blue, #3B82F6)',    label: 'Scheduled meetings',  n: counts.scheduledMeetings, to: '/follow-ups?filter=meetings' },
  ]

  return (
    <div className="m-card" style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
      padding: 12,
    }}>
      {cells.map(c => {
        const Icon = c.icon
        const empty = c.n === 0
        return (
          <button
            key={c.label}
            type="button"
            onClick={() => navigate(c.to)}
            disabled={empty}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 4,
              padding: '10px 10px',
              borderRadius: 10,
              background: `${c.tint}14`,
              border: `1px solid ${c.tint}33`,
              cursor: empty ? 'default' : 'pointer',
              opacity: empty ? 0.55 : 1,
              fontFamily: 'inherit',
              textAlign: 'left',
              color: 'inherit',
            }}
            title={empty ? `No ${c.label.toLowerCase()}` : `Open ${c.label.toLowerCase()}`}
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
          </button>
        )
      })}
    </div>
  )
}
