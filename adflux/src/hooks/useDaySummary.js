// src/hooks/useDaySummary.js
//
// Phase 76 — load today's plan + actuals + tracking events for the
// signed-in rep, return a shape the DaySummaryCard + WhatsApp
// formatter both consume.
//
// IST date anchored via src/utils/istDate.js. All "today" windows
// computed in IST so the card matches the rep's local day even when
// the device clock is UTC.
//
// Queries (8 in parallel):
//   1) work_sessions.{planned_meetings, planned_calls, planned_leads,
//                     daily_counters} for today
//   2) lead_activities count by activity_type for today
//   3) call_logs count for today
//   4) leads count where created_by + created_at today
//   5) follow_ups count: total assigned today + done today
//   6) quotes count: sent today, won today
//   7) voice_logs count for today
//   8) gps_pings today (for uptime computation)
//   9) gps_off_events + network_off_events + force_stop_events today
//  10) daily_ta.km_traveled today
//
// Re-fetch is manual via the returned `refresh()` callback. The
// DaySummaryCard calls refresh on mount + every 5 min while visible.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { istTodayISO, istTodayPlusDays } from '../utils/istDate'

/**
 * Convert a YYYY-MM-DD IST date into UTC ISO strings bracketing the
 * IST day (00:00 IST → 23:59:59.999 IST). IST = UTC+5:30.
 */
function istDayBracketUTC(dateISO) {
  // IST midnight in UTC = previous day 18:30Z.
  const [y, m, d] = dateISO.split('-').map(Number)
  const istMidnightUtc = new Date(Date.UTC(y, m - 1, d, -5, -30, 0))
  const istEndUtc = new Date(istMidnightUtc.getTime() + 24 * 60 * 60 * 1000 - 1)
  return {
    startISO: istMidnightUtc.toISOString(),
    endISO:   istEndUtc.toISOString(),
  }
}

/**
 * Compute "uptime" from raw GPS pings:
 *   walk pings ordered by captured_at; sum gaps <= maxGapSeconds.
 *   gaps larger than maxGapSeconds are treated as "off" intervals.
 *
 * Result: total online seconds during the day.
 */
function computeUptimeSeconds(pings, maxGapSeconds = 600) {
  if (!Array.isArray(pings) || pings.length < 2) return 0
  const sorted = [...pings].sort((a, b) =>
    new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()
  )
  let total = 0
  for (let i = 1; i < sorted.length; i++) {
    const gap = (new Date(sorted[i].captured_at).getTime() -
                 new Date(sorted[i - 1].captured_at).getTime()) / 1000
    if (gap <= maxGapSeconds) total += gap
  }
  return Math.round(total)
}

/**
 * Main hook.
 */
export default function useDaySummary({ dateISO } = {}) {
  const profile = useAuthStore(s => s.profile)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)

  const targetDate = dateISO || istTodayISO()

  const refresh = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    const { startISO, endISO } = istDayBracketUTC(targetDate)
    // Phase 91a — tomorrow preview. Anchored to IST regardless of
    // device clock (istTodayPlusDays guarantees that). Only needed
    // when targetDate is "today" — historical dates don't show a
    // tomorrow preview.
    const tomorrowISO = istTodayPlusDays(1)
    const isToday = targetDate === istTodayISO()

    try {
      const [
        wsRes, actRes, callRes, leadRes, fuTotalRes, fuDoneRes,
        qSentRes, qWonRes, voiceRes, pingsRes,
        gpsOffRes, netOffRes, forceStopRes, daRes, dtRes,
        tomFuRes, tomWsRes,
      ] = await Promise.all([
        // 1) Today's work_sessions row
        supabase.from('work_sessions')
          .select('planned_meetings, planned_calls, planned_leads, daily_counters, check_in_at, evening_summary_sent_at')
          .eq('user_id', profile.id)
          .eq('work_date', targetDate)
          .maybeSingle(),

        // 2) lead_activities counts grouped client-side.
        // Phase 76.4 guardian fix: column is `created_by` (Phase 12
        // schema), not `user_id` — the latter does not exist on this
        // table and the query was silently returning 0 rows.
        supabase.from('lead_activities')
          .select('id, activity_type, outcome')
          .eq('created_by', profile.id)
          .gte('created_at', startISO)
          .lte('created_at', endISO),

        // 3) call_logs count
        // Phase 76.2.2 (2026-05-23) — owner directive: only count
        // calls with duration_seconds >= 10s. Excludes misdials,
        // ringing-hangups, immediate-cuts. Applies to sales reps on
        // /work + TC reps on /telecaller (this hook feeds
        // DaySummaryCard, mounted on both). NULL durations excluded
        // until Phase 65 60-second auto-patch fills the field.
        // Phase 93.1 — also exclude direction='missed' so the count
        // matches GpsTrack's "qualified" bucket. Was overstating by
        // any missed-inbound row whose duration somehow landed ≥10
        // (legacy patch paths). .or() preserves NULL-direction rows.
        // Phase 93.24 — lead-tied calls only. KPI semantic = "calls
        // to clients today", not "every tel-tap captured by native
        // dialer ingest".
        supabase.from('call_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .gte('call_at', startISO)
          .lte('call_at', endISO)
          .gte('duration_seconds', 10)
          .or('direction.is.null,direction.neq.missed')
          .not('lead_id', 'is', null),

        // 4) leads created by this rep today
        supabase.from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', profile.id)
          .gte('created_at', startISO)
          .lte('created_at', endISO),

        // 5a) follow_ups assigned to rep due today
        supabase.from('follow_ups')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', profile.id)
          .eq('follow_up_date', targetDate),

        // 5b) follow_ups done by rep today
        supabase.from('follow_ups')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', profile.id)
          .eq('is_done', true)
          .gte('done_at', startISO)
          .lte('done_at', endISO),

        // 6a) quotes created by rep today (sent count)
        supabase.from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', profile.id)
          .gte('created_at', startISO)
          .lte('created_at', endISO),

        // 6b) quotes won today. Schema has no dedicated `won_at`
        // column — the codebase uses `updated_at` as the proxy for
        // "when status flipped to won" (same pattern as
        // AdminDashboardDesktop:385 / SalesDashboard:575).
        supabase.from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', profile.id)
          .eq('status', 'won')
          .gte('updated_at', startISO)
          .lte('updated_at', endISO),

        // 7) voice_logs count
        supabase.from('voice_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .gte('created_at', startISO)
          .lte('created_at', endISO),

        // 8) gps_pings for uptime
        supabase.from('gps_pings')
          .select('captured_at')
          .eq('user_id', profile.id)
          .gte('captured_at', startISO)
          .lte('captured_at', endISO)
          .order('captured_at', { ascending: true }),

        // 9a) gps_off_events today
        supabase.from('gps_off_events')
          .select('duration_seconds, toggled_off_at, toggled_on_at')
          .eq('user_id', profile.id)
          .gte('toggled_off_at', startISO)
          .lte('toggled_off_at', endISO),

        // 9b) network_off_events today
        supabase.from('network_off_events')
          .select('duration_seconds, lost_at, regained_at')
          .eq('user_id', profile.id)
          .gte('lost_at', startISO)
          .lte('lost_at', endISO),

        // 9c) force_stop_events today
        supabase.from('force_stop_events')
          .select('gap_seconds, last_seen_at, relaunched_at, during_work_hours')
          .eq('user_id', profile.id)
          .gte('relaunched_at', startISO)
          .lte('relaunched_at', endISO),

        // 10) daily_ta.km_traveled for today
        supabase.from('daily_ta')
          .select('km_traveled')
          .eq('user_id', profile.id)
          .eq('ta_date', targetDate)
          .maybeSingle(),

        // policy row for plan defaults — daily_targets
        supabase.from('daily_targets')
          .select('min_calls, min_qualified_weekly')
          .eq('user_id', profile.id)
          .is('effective_to', null)
          .maybeSingle(),

        // Phase 91a — tomorrow preview queries. Only run when
        // targetDate is today; otherwise return empty placeholders
        // (cheap unconditional dispatch is fine since both are
        // .head:true counts and one is a single-row select).
        isToday
          ? supabase.from('follow_ups')
              .select('id', { count: 'exact', head: true })
              .eq('assigned_to', profile.id)
              .eq('follow_up_date', tomorrowISO)
              .eq('is_done', false)
          : Promise.resolve({ count: 0, data: null, error: null }),

        isToday
          ? supabase.from('work_sessions')
              .select('planned_meetings')
              .eq('user_id', profile.id)
              .eq('work_date', tomorrowISO)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      // Tally activity types client-side.
      let meetings = 0, site_visits = 0, whatsapp_sent = 0, qualified = 0
      ;(actRes.data || []).forEach(r => {
        const t = (r.activity_type || '').toLowerCase()
        if (t === 'meeting')    meetings      += 1
        if (t === 'site_visit') site_visits   += 1
        if (t === 'whatsapp')   whatsapp_sent += 1
        // "qualified" = positive-outcome call/meeting (rough proxy)
        if (r.outcome === 'positive') qualified += 1
      })

      // PLAN — prefer the morning planner row, fall back to daily_targets,
      // then to the same defaults V2Hero / TeamDashboard use.
      const ws = wsRes.data || null
      const dt = dtRes?.data || null
      const role = (profile.role || '').toLowerCase()
      const isTC = role === 'telecaller'
      const planMeetings = Array.isArray(ws?.planned_meetings)
        ? ws.planned_meetings.filter(m => m && (m.client || m.time)).length
        : (isTC ? 0 : 5)
      const planCalls = ws?.planned_calls
        ?? (dt?.min_calls ?? (isTC ? 50 : 20))
      const planLeads = ws?.planned_leads ?? 10

      const tracking = {
        gps_uptime_seconds:         computeUptimeSeconds(pingsRes.data),
        gps_off_count:              (gpsOffRes.data || []).length,
        gps_off_duration_seconds:   (gpsOffRes.data || [])
                                      .reduce((s, r) => s + (Number(r.duration_seconds) || 0), 0),
        network_off_count:          (netOffRes.data || []).length,
        network_off_duration_seconds:(netOffRes.data || [])
                                      .reduce((s, r) => s + (Number(r.duration_seconds) || 0), 0),
        force_stop_count:           (forceStopRes.data || []).length,
        km_traveled:                daRes?.data?.km_traveled ?? 0,
      }

      // Phase 91a — tomorrow preview. Follow-ups count + non-empty
      // planned_meetings rows on tomorrow's work_sessions row (if rep
      // already drafted it). Both safely degrade to 0 when there is no
      // data.
      const tomorrowMeetings = Array.isArray(tomWsRes?.data?.planned_meetings)
        ? tomWsRes.data.planned_meetings.filter(m => m && (m.client || m.time || m.location)).length
        : 0
      const tomorrow = {
        dateISO:    isToday ? tomorrowISO : null,
        followUps:  tomFuRes?.count || 0,
        meetings:   tomorrowMeetings,
      }

      const _summary = {
        repName: profile.name,
        role,
        dateISO: targetDate,
        plan: {
          meetings:   planMeetings,
          calls:      planCalls,
          leads:      planLeads,
        },
        actual: {
          meetings,
          calls:             callRes.count || 0,
          leads:             leadRes.count || 0,
          follow_ups_total:  fuTotalRes.count || 0,
          follow_ups_done:   fuDoneRes.count || 0,
          site_visits,
          whatsapp_sent,
          voice_notes:       voiceRes.count || 0,
          quotes_sent:       qSentRes.count || 0,
          quotes_won:        qWonRes.count || 0,
          qualified,
        },
        tracking,
        tomorrow,
        sentAt:    ws?.evening_summary_sent_at || null,
        checkedIn: !!ws?.check_in_at,
      }
      setData(_summary)
      // Phase 109.2 — return the assembled object so a caller (the
      // share button) can build the WhatsApp text from THIS fetch
      // instead of stale React state.
      return _summary
    } catch (e) {
      console.warn('[useDaySummary] load failed:', e?.message || e)
      setError(e?.message || 'Load failed')
      return null
    } finally {
      setLoading(false)
    }
  }, [profile?.id, profile?.name, profile?.role, targetDate])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
