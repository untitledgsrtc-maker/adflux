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
import { isSystemClose } from '../utils/followups'
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
    // Quote ₹ figures are MONTH-TO-DATE (owner 2026-06-02: "quote sent/won
    // with amount, this month"). Month start = 1st of targetDate's month at
    // IST midnight (UTC+5:30 → previous-day 18:30Z).
    const [_qy, _qm] = targetDate.split('-').map(Number)
    const monthStartISO = new Date(Date.UTC(_qy, _qm - 1, 1, -5, -30, 0)).toISOString()
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
        overdueRes, quotesTodayRes, renewalRes, callLeadsRes, chaseRes,
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
          .select('id, lead_id, activity_type, outcome, notes')
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

        // 5b) follow_ups done by rep today — Phase 118: return lead_id
        // rows (not just a count) so we can gate "real follow-ups" on a
        // real call + qualify. data.length = the old done count.
        supabase.from('follow_ups')
          .select('id, lead_id, done_note')
          .eq('assigned_to', profile.id)
          .eq('is_done', true)
          .gte('done_at', startISO)
          .lte('done_at', endISO),

        // 6a) quotes created by rep THIS MONTH (sent) — rows for count + ₹.
        supabase.from('quotes')
          .select('total_amount')
          .eq('created_by', profile.id)
          .gte('created_at', monthStartISO)
          .lte('created_at', endISO),

        // 6b) quotes WON this month — rows for count + ₹. No `won_at`
        // column; `updated_at` is the won-flip proxy (same pattern as
        // AdminDashboardDesktop:385 / SalesDashboard:575).
        supabase.from('quotes')
          .select('total_amount')
          .eq('created_by', profile.id)
          .eq('status', 'won')
          .gte('updated_at', monthStartISO)
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

        // Phase 118 — overdue follow-ups (date < target, still open).
        supabase.from('follow_ups')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', profile.id)
          .eq('is_done', false)
          .lt('follow_up_date', targetDate),

        // Phase 118 — quotes the rep SENT today (daily, for the score;
        // the PLAN-vs-ACTUAL "Quotes sent" line stays month-to-date).
        supabase.from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', profile.id)
          .gte('created_at', startISO)
          .lte('created_at', endISO),

        // Phase 118 — renewals: won quotes whose campaign ends within 30
        // days (same source as RenewalReminderBanner).
        supabase.from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('created_by', profile.id)
          .eq('status', 'won')
          .gte('campaign_end_date', targetDate)
          .lte('campaign_end_date', istTodayPlusDays(30)),

        // Phase 128.3 — lead_ids the rep CALLED today (ANY attempt; a
        // no-answer / tapped-Call counts — owner rule "called = dialed,
        // pickup not required", matching the Phase 128 Done-gate). NO >=10s
        // filter (that gates the calls-toward-50 metric, a different thing).
        // Gates "real follow-ups" = done + the lead was actually called.
        supabase.from('call_logs')
          .select('lead_id')
          .eq('user_id', profile.id)
          .gte('call_at', startISO)
          .lte('call_at', endISO)
          .not('lead_id', 'is', null),

        // Phase 118 — quote outstanding (count + ₹) via the self-scoped
        // SECURITY DEFINER RPC (sales-only payments RLS forbids a client
        // join). Line stays hidden when 0.
        supabase.rpc('my_chase_counts'),

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
      let whatsapp_sent = 0, qualified = 0
      // Phase 127.1 — dedupe meetings + site-visits BY LEAD (one company /
      // lead per day = 1 visit), matching §33 + the live counter
      // (recompute_daily_meetings) + the GPS-track + the pay score. The old
      // code counted EACH row, so a lead visited twice the same day (kirti's
      // Devam) read 2 on the report while every other screen read 1.
      // COALESCE(lead_id, id) keeps walk-ins (no lead) each unique.
      const meetingLeads = new Set()
      const siteVisitLeads = new Set()
      ;(actRes.data || []).forEach(r => {
        const t = (r.activity_type || '').toLowerCase()
        // Phase 110 — apply the CLAUDE.md §33 "done meeting" exclusions so
        // the evening report's count matches the dashboard counter. A
        // SCHEDULED (future) meeting or an auto-check-in companion row is
        // NOT a completed meeting/visit and must not inflate the tally.
        const note = r.notes || ''
        const isScheduled  = note.startsWith('Meeting scheduled')
        const isAutoCheckin = note.startsWith("I'm here")
        const key = r.lead_id || `walkin_${r.id}`
        if (t === 'meeting'    && !isScheduled && !isAutoCheckin) meetingLeads.add(key)
        if (t === 'site_visit' && !isScheduled && !isAutoCheckin) siteVisitLeads.add(key)
        if (t === 'whatsapp')   whatsapp_sent += 1
        // "qualified" = positive-outcome call/meeting (rough proxy)
        if (r.outcome === 'positive') qualified += 1
      })
      const meetings = meetingLeads.size
      const site_visits = siteVisitLeads.size

      // PLAN — prefer the morning planner row, fall back to daily_targets,
      // then to the same defaults V2Hero / TeamDashboard use.
      const ws = wsRes.data || null
      const dt = dtRes?.data || null
      const role = (profile.role || '').toLowerCase()
      const isTC = role === 'telecaller'
      // Phase 122 — align the report's meeting TARGET with the admin card +
      // the pay score (compute_daily_score), both of which use the real
      // target: users.daily_targets.meetings || 5. The old code used the
      // morning-planner COUNT, which is 0 when the rep didn't pre-plan any
      // meetings → pctOf() returned 100% → the report's DAY SCORE over-
      // counted meetings (Abhinav: 4/0 = full 50, report 81; the pay score
      // correctly used 4/5 = 80%). Now: use the rep's morning plan if they
      // entered one (count > 0), else fall back to the target. TC = 0 (no
      // field meetings). DISPLAY-ONLY — the pay score is untouched.
      const morningMeetingCount = Array.isArray(ws?.planned_meetings)
        ? ws.planned_meetings.filter(m => m && (m.client || m.time)).length
        : 0
      const planMeetings = morningMeetingCount > 0
        ? morningMeetingCount
        : (isTC ? 0 : ((profile?.daily_targets?.meetings) || 5))
      const planCalls = ws?.planned_calls
        ?? (dt?.min_calls ?? (isTC ? 50 : 20))
      const planLeads = ws?.planned_leads ?? 10

      // ─── Phase 118 — Sales Day Summary extras ──────────────────────
      // Real follow-ups: marked done today AND the lead got a real
      // (>=10s) call today AND a positive outcome today. A done flag with
      // no real call doesn't count (owner: "only if they really call and
      // qualified").
      const calledLeadIds = new Set(
        (callLeadsRes.data || []).map(r => r.lead_id).filter(Boolean))
      // Phase 175 — exclude system-closed rows (auto-closed on Lost/Won,
      // auto-skipped, healed) so a rep is never credited for the system closing
      // a follow-up. Same isSystemClose rule the team report uses.
      const doneFu = (fuDoneRes.data || []).filter(r => !isSystemClose(r.done_note))
      // Phase 128.3 — a follow-up counts as "real" when it was CLOSED and the
      // rep CALLED the lead today (any attempt). Dropped the qualifiedLeadIds
      // gate: a no-answer call still counts (owner: "called = follow-up done").
      const followUpsReal = doneFu.filter(f =>
        f.lead_id && calledLeadIds.has(f.lead_id)).length

      // Revisit tiers: for each lead met today (real, non-scheduled,
      // non-auto-checkin meeting/visit), what visit number is it over the
      // lead's lifetime. One follow-up query, only when meetings exist.
      const todayMeetLeadIds = [...new Set(
        (actRes.data || [])
          .filter(r => ['meeting', 'site_visit'].includes((r.activity_type || '').toLowerCase())
            && r.lead_id
            && !(r.notes || '').startsWith('Meeting scheduled')
            && !(r.notes || '').startsWith("I'm here"))
          .map(r => r.lead_id))]
      const revisitTiers = {}
      if (todayMeetLeadIds.length > 0) {
        const { data: priorMeets } = await supabase.from('lead_activities')
          .select('lead_id, notes')
          .in('lead_id', todayMeetLeadIds)
          .in('activity_type', ['meeting', 'site_visit'])
          .lt('created_at', startISO)
          .limit(1000)   // Phase 118 — cap (scoped to today's met-leads, tiny in practice; NULL-notes kept via client filter)
        const priorCount = {}
        ;(priorMeets || []).forEach(r => {
          const n = r.notes || ''
          if (n.startsWith('Meeting scheduled') || n.startsWith("I'm here")) return
          priorCount[r.lead_id] = (priorCount[r.lead_id] || 0) + 1
        })
        todayMeetLeadIds.forEach(lid => {
          const nth = (priorCount[lid] || 0) + 1
          if (nth >= 2) revisitTiers[nth] = (revisitTiers[nth] || 0) + 1
        })
      }

      // Quote outstanding (won, not fully paid) from the self-scoped RPC.
      const chase = (chaseRes?.data && chaseRes.data[0]) || {}
      const quoteOutstandingCount = Number(chase.pay_chase || 0)
      const quoteOutstandingAmount = Number(chase.pay_outstanding || 0)

      // Weighted DAY SCORE — message-only, NOT salary. Meetings 50 /
      // real follow-ups 20 / new leads 15 / quotes today 15. Each line =
      // min(1, actual/target) × weight.
      const pctOf = (a, t) => (t > 0 ? Math.min(1, a / t) : (a > 0 ? 1 : 0))
      const fuAssigned = fuTotalRes.count || 0
      const quotesToday = quotesTodayRes.count || 0
      // Phase 164 — the 50-point primary slot is role-aware. A telecaller's
      // core work is CALLS (>=10s — the same callRes the report's "Calls"
      // line shows), not field meetings. For TC, planMeetings is 0, so the
      // old meetings slot scored 0 → the TC report capped ~50/100 and never
      // credited their calls (owner: "TC daily report doesn't have score").
      // Sales / agency keep meetings. DISPLAY score only — the pay score
      // (compute_daily_score) is untouched.
      const dayScore = Math.round(
        (isTC
          ? pctOf(callRes.count || 0, planCalls) * 50
          : pctOf(meetings, planMeetings) * 50) +
        pctOf(followUpsReal, fuAssigned) * 20 +
        pctOf(leadRes.count || 0, planLeads) * 15 +
        pctOf(quotesToday, 1) * 15
      )

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
          follow_ups_done:   doneFu.length,   // Phase 175 — excludes system-closed rows (isSystemClose)
          site_visits,
          whatsapp_sent,
          voice_notes:       voiceRes.count || 0,
          // Phase 110b (2026-06-02) — quotes are MONTH-TO-DATE now, with ₹.
          quotes_sent:        (qSentRes.data || []).length,
          quotes_sent_amount: (qSentRes.data || []).reduce((s, q) => s + (Number(q.total_amount) || 0), 0),
          quotes_won:         (qWonRes.data || []).length,
          quotes_won_amount:  (qWonRes.data || []).reduce((s, q) => s + (Number(q.total_amount) || 0), 0),
          qualified,
          // Phase 118 — Sales Day Summary extras.
          follow_ups_real:          followUpsReal,
          overdue_follow_ups:       overdueRes.count || 0,
          quotes_today:             quotesToday,
          renewal_due:              renewalRes.count || 0,
          quote_outstanding_count:  quoteOutstandingCount,
          quote_outstanding_amount: quoteOutstandingAmount,
          revisit_tiers:            revisitTiers,
          day_score:                dayScore,
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
