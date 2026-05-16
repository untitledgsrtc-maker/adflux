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
import { Clock, Calendar, CalendarClock, Loader2, CheckCircle2, FileText, IndianRupee, Repeat } from 'lucide-react'
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
    // Phase 34Z.85 — renewal window: won quotes whose campaign ends
    // within 60 days (mirrors RenewalToolsV2 query).
    const sixtyDaysOut = (() => {
      const d = new Date()
      d.setDate(d.getDate() + 60)
      return d.toISOString().slice(0, 10)
    })()

    const [fuRes, chaseRes, paymentRes, scheduledRes, renewalRes] = await Promise.all([
      // 1. Pending follow-ups — lead_intro + nurture cadences, due
      //    today or earlier. Quote-chase + payment broken out below
      //    so they don't double-count here.
      supabase.from('follow_ups')
        .select('id, cadence_type', { count: 'exact', head: false })
        .eq('assigned_to', userId)
        .eq('is_done', false)
        .lte('follow_up_date', today)
        .or('cadence_type.is.null,cadence_type.in.(lead_intro,nurture,lost_nurture)'),

      // 2. Quote chases — cadence_type=quote_chase due today.
      supabase.from('follow_ups')
        .select('id', { count: 'exact', head: false })
        .eq('assigned_to', userId)
        .eq('is_done', false)
        .lte('follow_up_date', today)
        .eq('cadence_type', 'quote_chase'),

      // 3. Payment chases — open FU linked to a won quote with
      //    outstanding amount. The list comes back joined to quotes
      //    + payments so we can filter outstanding > 0 client-side.
      supabase.from('follow_ups')
        .select(`id, quotes!inner(id, status, total_amount, payments(amount_received, approval_status))`)
        .eq('assigned_to', userId)
        .eq('is_done', false)
        .lte('follow_up_date', today)
        .eq('quotes.status', 'won'),

      // 4. Scheduled meetings — future follow_ups whose note starts
      //    with "Meeting" (Phase 34Z.60 prefix).
      supabase.from('follow_ups')
        .select('id', { count: 'exact', head: false })
        .eq('assigned_to', userId)
        .eq('is_done', false)
        .gt('follow_up_date', today)
        .ilike('note', 'Meeting%'),

      // 5. Renewal — won quotes assigned to this rep with campaign
      //    end within 60 days. Mirrors RenewalToolsV2 query.
      supabase.from('quotes')
        .select('id', { count: 'exact', head: false })
        .eq('created_by', userId)
        .eq('status', 'won')
        .gte('campaign_end_date', today)
        .lte('campaign_end_date', sixtyDaysOut),
    ])

    // Compute payment-outstanding count client-side (Postgres can't
    // express "sum of payments < quote total" in a single
    // PostgREST filter without an RPC).
    const paymentChases = (paymentRes.data || []).filter(r => {
      const q = r.quotes
      if (!q || q.status !== 'won') return false
      const paid = (q.payments || [])
        .filter(p => (p.approval_status || 'approved') === 'approved')
        .reduce((sum, p) => sum + Number(p.amount_received || 0), 0)
      return Number(q.total_amount || 0) - paid > 0
    }).length

    const nextFollowUps = fuRes.data?.length || 0
    highMarkRef.current = Math.max(highMarkRef.current, nextFollowUps)
    setCounts({
      followUps:         nextFollowUps,
      quoteChase:        chaseRes.data?.length || 0,
      paymentChase:      paymentChases,
      plannedMeetings:   Array.isArray(session?.planned_meetings)
        ? session.planned_meetings.filter(m => (m.client || '').trim() || (m.location || '').trim()).length
        : 0,
      scheduledMeetings: scheduledRes.data?.length || 0,
      renewal:           renewalRes.data?.length || 0,
    })
  }, [userId, session?.planned_meetings])

  useEffect(() => { load() }, [load])
  // Phase 34Z.62 — owner reported the follow-up count stayed put
  // after he saved a call outcome. The component only refetched on
  // userId / session change. Auto-refresh on tab resume + realtime
  // sub on follow_ups so the count drops the moment a row flips to
  // is_done = true.
  useAutoRefresh(load, { enabled: !!userId })

  // Phase 34Z.69 — fix #11: debounce the realtime callback so
  // visibilitychange + realtime + focus don't triple-fire load()
  // within a single tab resume. Single 800ms throttle, same as
  // useAutoRefresh, sharing a timestamp ref.
  const lastLoadAt = useRef(0)
  useEffect(() => {
    if (!userId) return
    function safeLoad() {
      const now = Date.now()
      if (now - lastLoadAt.current < 800) return
      lastLoadAt.current = now
      load()
    }
    // Phase 34Z.69 — fix #18: stronger channel name uniqueness.
    // userId + Date.now() so concurrent mounts (e.g. multi-tab,
    // hot reload) never collide on the same channel name.
    const ch = supabase
      .channel(`today-summary-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'follow_ups', filter: `assigned_to=eq.${userId}` },
        safeLoad)
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

  // Phase 34Z.85 — six-bucket total.
  const total = counts.followUps + counts.quoteChase + counts.paymentChase
              + counts.plannedMeetings + counts.scheduledMeetings + counts.renewal

  // Phase 34Z.62 — celebration when the rep clears every follow-up
  // they had this session. Only fires when the high-mark was > 0,
  // so a fresh-mount day with 0 follow-ups still gets the gentle
  // empty state below, not a fake "you finished!" pat on the back.
  if (counts.followUps === 0 && highMarkRef.current > 0 && total === 0) {
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

  // Phase 34Z.86 — re-laid out cells. Earlier 3-col grid clipped
  // 2-word labels on phone (PAYMEN…/RENEW… got truncated). Now:
  //   - Single-word short labels: FOLLOW-UP, QUOTE, PAYMENT, TODAY,
  //     SCHEDULED, RENEWAL.
  //   - Icon above label (not inline), tightens column width.
  //   - Big number centered, label centered below.
  //   - Padding 8/8, gap 6, radius 12 — same spec.
  const cells = [
    // Row 1 — call-action today
    { icon: Clock,         tint: 'var(--warning, #F59E0B)', label: 'Follow-up',     n: counts.followUps,         to: '/follow-ups' },
    { icon: FileText,      tint: 'var(--blue, #3B82F6)',    label: 'Quote',         n: counts.quoteChase,        to: '/follow-ups?filter=quote_chase' },
    { icon: IndianRupee,   tint: 'var(--danger, #EF4444)',  label: 'Payment',       n: counts.paymentChase,      to: '/follow-ups?filter=payment' },
    // Row 2 — future / informational
    { icon: Calendar,      tint: 'var(--accent, #FFE600)',  label: 'Today',         n: counts.plannedMeetings,   to: '/work#day-status' },
    { icon: CalendarClock, tint: 'var(--blue, #3B82F6)',    label: 'Scheduled',     n: counts.scheduledMeetings, to: '/follow-ups?filter=meetings' },
    { icon: Repeat,        tint: 'var(--success, #10B981)', label: 'Renewal',       n: counts.renewal,           to: '/renewal-tools' },
  ]

  return (
    <div className="m-card" style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
      padding: 10,
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
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 4,
              padding: '12px 6px',
              borderRadius: 12,
              background: `${c.tint}14`,
              border: `1px solid ${c.tint}33`,
              cursor: empty ? 'default' : 'pointer',
              opacity: empty ? 0.5 : 1,
              fontFamily: 'inherit',
              color: 'inherit',
              minHeight: 78,
            }}
            title={empty ? `No ${c.label.toLowerCase()}` : `Open ${c.label.toLowerCase()}`}
          >
            <Icon size={14} strokeWidth={1.6} style={{ color: c.tint }} />
            <div style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1,
            }}>
              {c.n}
            </div>
            <div style={{
              fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.08em',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '100%',
            }}>
              {c.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}
