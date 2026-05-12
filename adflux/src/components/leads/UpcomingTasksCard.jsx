// src/components/leads/UpcomingTasksCard.jsx
//
// Phase 34C — "Tomorrow + This Week" preview card on /work.
//
// Audit finding (item 2 of the May 13 sales-module review):
// reps cannot prep for tomorrow from /work — they only see today's
// tasks. The data already exists in `follow_ups`; this card pulls
// a count for tomorrow + the next 7 days and links to /follow-ups
// where the full grouped list lives.
//
// Mounted at the bottom of WorkV2 next to TodayTasksPanel so the
// rep glances at it before checking out at 7:30 PM and knows what's
// coming tomorrow.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClockIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'

function todayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString().slice(0, 10)
}

function addDaysISO(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function UpcomingTasksCard({ userId }) {
  const navigate = useNavigate()
  const [tomorrow, setTomorrow] = useState(null)
  const [week,     setWeek]     = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)

    const tomorrowDate = addDaysISO(1)
    const weekStart    = addDaysISO(2)
    const weekEnd      = addDaysISO(7)

    Promise.all([
      supabase.from('follow_ups')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', userId)
        .eq('is_done', false)
        .eq('follow_up_date', tomorrowDate),
      supabase.from('follow_ups')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', userId)
        .eq('is_done', false)
        .gte('follow_up_date', weekStart)
        .lte('follow_up_date', weekEnd),
    ]).then(([tRes, wRes]) => {
      if (cancelled) return
      setTomorrow(tRes.count ?? 0)
      setWeek(wRes.count ?? 0)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [userId])

  if (loading) {
    return (
      <div style={{
        background: 'var(--v2-bg-1, #111a2e)',
        border: '1px solid var(--v2-line, #1f2b47)',
        borderRadius: 'var(--v2-r, 14px)',
        padding: '12px 14px',
        marginTop: 12,
        color: 'var(--v2-ink-1, #a9b3c7)',
        fontSize: 12,
      }}>
        Loading what's next…
      </div>
    )
  }

  const tomorrowCount = tomorrow ?? 0
  const weekCount     = week     ?? 0
  const totalUpcoming = tomorrowCount + weekCount

  if (totalUpcoming === 0) {
    return (
      <div
        onClick={() => navigate('/follow-ups')}
        style={{
          background: 'var(--v2-bg-1, #111a2e)',
          border: '1px solid var(--v2-line, #1f2b47)',
          borderRadius: 'var(--v2-r, 14px)',
          padding: '12px 14px',
          marginTop: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--v2-ink-1, #a9b3c7)',
          fontSize: 13,
        }}
      >
        <span>Nothing scheduled for tomorrow or this week — go hunt some leads.</span>
        <ArrowRight size={14} />
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--v2-bg-1, #111a2e)',
      border: '1px solid var(--v2-line, #1f2b47)',
      borderRadius: 'var(--v2-r, 14px)',
      padding: '12px 14px',
      marginTop: 12,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--v2-ink-1, #a9b3c7)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 10,
      }}>
        <ClockIcon size={12} />
        <span>Coming up</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button
          type="button"
          onClick={() => navigate('/follow-ups')}
          style={{
            textAlign: 'left',
            background: 'var(--v2-bg-2, #1a2742)',
            border: '1px solid var(--v2-line, #1f2b47)',
            borderRadius: 10,
            padding: '10px 12px',
            cursor: 'pointer',
            color: 'inherit',
            fontFamily: 'inherit',
          }}
        >
          <div style={{
            fontSize: 22,
            fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
            fontWeight: 600,
            color: 'var(--v2-yellow, #FFE600)',
            lineHeight: 1.1,
          }}>{tomorrowCount}</div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-1, #a9b3c7)', marginTop: 4 }}>
            Tomorrow
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/follow-ups')}
          style={{
            textAlign: 'left',
            background: 'var(--v2-bg-2, #1a2742)',
            border: '1px solid var(--v2-line, #1f2b47)',
            borderRadius: 10,
            padding: '10px 12px',
            cursor: 'pointer',
            color: 'inherit',
            fontFamily: 'inherit',
          }}
        >
          <div style={{
            fontSize: 22,
            fontFamily: 'var(--v2-display, "Space Grotesk", system-ui, sans-serif)',
            fontWeight: 600,
            color: 'var(--v2-ink-0, #f5f7fb)',
            lineHeight: 1.1,
          }}>{weekCount}</div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-1, #a9b3c7)', marginTop: 4 }}>
            Next 7 days
          </div>
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate('/follow-ups')}
        style={{
          marginTop: 10,
          width: '100%',
          padding: '8px',
          borderRadius: 8,
          background: 'transparent',
          border: '1px solid var(--v2-line, #1f2b47)',
          color: 'var(--v2-ink-0, #f5f7fb)',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        Open Follow-ups <ArrowRight size={12} />
      </button>
    </div>
  )
}
