// src/pages/v2/AdminDashboardDesktop.jsx
//
// Desktop admin dashboard (≥860px).
// Route: /dashboard (via DashboardV2 switcher) when role = admin.
//
// Data pulls mirror the legacy admin components one-for-one so numbers
// stay consistent during cutover:
//   quotes                (pipeline, revenue, outstanding, active campaigns)
//   payments              (collected, pending approval queue, activity feed)
//   staff_incentive_profiles + monthly_sales_data + incentive_settings
//                         (top performers, incentive liability)
//
// Styles under .v2d scope in src/styles/v2.css.

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuoteStore } from '../../store/quoteStore'
import {
  LayoutDashboard, FileText, CheckSquare, BarChart3, Users, Building2,
  Repeat, Gift, Settings, LogOut, Search, Bell, Plus, AlertTriangle,
  CheckCircle2, CreditCard, Send, PenLine, ArrowUpRight,
  Contact2, MapPin, Tv, FileBox, Zap,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { buildSettlementMap } from '../../utils/settlement'
import {
  initials, formatRelative, formatCompact,
} from '../../utils/formatters'
// Phase 98.E1 (F-D003) — admin "today" KPIs anchor to IST, not UTC.
// `todayISO()` from formatters returned `new Date().toISOString().slice(0,10)`
// which is UTC and rolls over at IST 05:30. After 18:30 IST the admin
// dashboard was showing wrong "today collected" / today-rep-strip
// counts. `istTodayISO()` uses Intl.DateTimeFormat with timeZone
// Asia/Kolkata — stable across the IST workday.
import { istTodayISO } from '../../utils/istDate'
import { thisMonth } from '../../utils/period'
import { PeriodPicker } from '../../components/v2/PeriodPicker'
import WaBillingBanner from '../../components/v2/WaBillingBanner'
// Phase 12 rev3 — widgets folded in from the retired CockpitV2 page.
// Phase 31A.2 — added 4 sales-exec analysis widgets per owner spec
// (8 May 2026): stale leads alert, pipeline funnel, win rate / avg
// deal / projected, recent activity feed.
// Phase 41.5 — AiBriefingCard / PipelineFunnelCard / WinRateCard /
// RecentActivityFeedCard imports dropped (mounts removed; widgets
// duplicated content below the hero). Kept: LeadPipelinePanel +
// TeamActivityPanel still mounted in Row 4c.
import {
  LeadPipelinePanel, TeamActivityPanel,
} from '../../components/dashboard/CockpitWidgets'
import { wonDate } from '../../utils/wonDate'
import '../../styles/v2.css'

/* ─── Money display: full Indian-format number with lakh/crore grouping.
   Previously truncated to ₹3K / ₹29.7K / ₹1.2Cr etc., which hid the
   real figure from admins reviewing numbers. Now always renders full
   (e.g. ₹29,700 or ₹12,50,00,000) — if a cell ever becomes too narrow
   the container CSS handles overflow, not this formatter. ─── */
function Money({ value }) {
  const n = Number(value) || 0
  return <>₹{new Intl.NumberFormat('en-IN').format(Math.round(n))}</>
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24
  return Math.max(0, Math.round((new Date(a) - new Date(b)) / MS))
}

export default function AdminDashboardDesktop() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [state, setState] = useState({ loading: true })
  // Period drives every window-bucketed query below. Defaults to the
  // current month; PeriodPicker lets Admin jump to any past month, a
  // preset range (Last 7, This quarter, …), or a fully custom start/end.
  // The picker returns a normalized period object — see utils/period.js.
  const [period, setPeriod] = useState(() => thisMonth())
  // Phase B — segment filter. 'all' (default) keeps the historical
  // behaviour of mixing private + govt; 'private' / 'government' slice
  // the quote-derived KPIs (Pipeline, Won value, Outstanding, Lost,
  // Active campaigns, Stale, Activity). The leaderboard / incentive
  // liability still reads monthly_sales_data which is segment-blind —
  // see the comment by the leaderboard build below.
  const [segmentFilter, setSegmentFilter] = useState('all')

  useEffect(() => {
    load(period, segmentFilter)
    // Realtime — one channel, covers everything that moves numbers.
    // Re-use the current `period` + filter from closure on realtime.
    const ch = supabase
      .channel('v2d-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load(period, segmentFilter))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => load(period, segmentFilter))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  /* eslint-disable-next-line */ }, [period, segmentFilter])

  async function load(activePeriod, activeSegment = 'all') {
    const today = istTodayISO()
    const p = activePeriod || thisMonth()
    // All three are consumed below: startIso/endIso for row-level time
    // filters (payments, quote timestamps), monthKeys for anything that
    // looks up pre-aggregated monthly tables (monthly_sales_data).
    const monthStartIso = p.startIso
    const monthEndIso   = p.endIso
    const monthKeys     = p.monthKeys

    // M1 — daily targets + today's follow-ups completed across the
    // team. We pull these alongside the existing 8 queries so the
    // per-rep activity strip + missed-targets banner can render
    // without an extra round-trip.
    const todayDate = istTodayISO()

    // Phase 41.2 — Sprint 2 add: 3 new queries for Action Queue +
    // Reps-in-field cards. All counts only (head: true), so cheap.
    // Phase 57c — widened from 30 min to 60 min so reps with brief
    // GPS gaps (tunnels, weak signal, distance-filter quiet periods)
    // don't drop off the "Reps in field right now" card. Plugin
    // distanceFilter dropped to 10m in parallel; together they keep
    // stationary reps visible.
    const liveCutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const [quotesRes, paymentsAllRes, paymentsApprRes, pendingPayRes, profilesRes, msdRes, usersRes, settingsRes, dailyTargetsRes, followupsDoneTodayRes, pendingLeavesRes, pendingTaRes, liveGpsRes, hotLeadsRes, briefLogRes, sourceAttribRes, wsCheckedOutRes, followupsDueRes] = await Promise.all([
      // Use `*` to be tolerant of schema drift — earlier we enumerated
      // columns including `ref_number`, and a single missing column
      // would silently return an empty array (not throw), which made
      // the dashboard show all zeros even though quotes exist. The
      // dashboard touches lots of fields; safer to pull the whole row
      // and let JS pick what's needed.
      supabase.from('quotes').select('*'),
      // Phase 86.1 — `quotes.ref_number` does NOT exist (Phase 33N
       // confirmed). Embed dropped to use `quote_number` only.
       // Audit 24 May 2026 console showed 4× 400 from PostgREST
       // when this query hit prod.
      supabase.from('payments')
        .select('id, quote_id, amount_received, is_final_payment, approval_status, rejection_reason, payment_date, created_at, received_by, quotes(quote_number, client_name, sales_person_name, segment)')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('payments')
        .select('quote_id, amount_received, payment_date, is_final_payment')
        .eq('approval_status', 'approved'),
      supabase.from('payments')
        .select('id, quote_id, amount_received, created_at, received_by, quotes(quote_number, client_name, sales_person_name, segment)')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('staff_incentive_profiles').select('*, users(name)').eq('is_active', true),
      supabase.from('monthly_sales_data').select('staff_id, month_year, new_client_revenue, renewal_revenue'),
      // Everyone with role in (sales, telecaller, agency) — used for
      // the leaderboard so reps with zero wins still show up, AND for
      // RepsInFieldCard so TC + agency appear when their phone is pinging.
      // Phase 56l-fix (19 May 2026): owner reported "Dhara GPS is on
      // but admin can't see location". Pings WERE fetched but the
      // sales-only name filter dropped Dhara → card showed "No reps
      // live right now" despite 318 live pings.
      supabase.from('users').select('id, name, role').in('role', ['sales', 'telecaller', 'agency']),
      supabase.from('incentive_settings').select('*').maybeSingle(),
      // M1 — every rep's active daily target. Filtered by effective_to
      // is null (the unique partial index in supabase_phase9 ensures one
      // active row per user, so a single fetch is sufficient).
      supabase.from('daily_targets')
        .select('user_id, min_quotes, min_followups, min_calls')
        .is('effective_to', null),
      // Phase 86.1 — follow_ups column is `done_at`, NOT
      // `completed_at`. Comment was stale; query was 400ing in
      // PostgREST with `column completed_at does not exist`.
      // M1 — follow-ups completed today across the whole team.
      supabase.from('follow_ups')
        .select('id, assigned_to, done_at')
        .eq('is_done', true)
        .gte('done_at', `${todayDate}T00:00:00`)
        .lte('done_at', `${todayDate}T23:59:59`),
      // Phase 41.2 — pending leaves count for Action Queue card.
      supabase.from('leaves').select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      // Phase 41.2 — pending TA/DA claims count for Action Queue.
      supabase.from('ta_da_requests').select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      // Phase 41.2 — Reps in field RIGHT NOW. Distinct users with a
      // gps_ping in the last 30 minutes. Single SELECT then we de-dupe
      // client-side (count distinct over time-windowed rows is cheap).
      supabase.from('gps_pings')
        .select('user_id, created_at, lat, lng')
        .gte('created_at', liveCutoffIso)
        .order('created_at', { ascending: false })
        .limit(500),
      // Phase 41.3 — Top hot leads. Leads in stage=Working with any
      // activity in the last 7 days. Sorted by activity-count desc
      // (most-touched = hottest). Limit 50 server-side; we collapse
      // to top 3 client-side after grouping.
      (async () => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        return supabase.from('lead_activities')
          .select('lead_id, created_at, leads(id, name, company, stage, assigned_to)')
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: false })
          .limit(500)
      })(),
      // Phase 41.3 — Today's morning brief delivery status. push_log
      // captures every enqueued push with success/error; brief pushes
      // are tagged kind='morning_brief' per Phase 34Z.61.
      (async () => {
        // Phase 323 (fix) — push_log's real columns are `tag` + `enqueued_at`
        // (NOT kind/created_at/success/error_msg — those never existed, so this
        // query 400'd on every load since §41.3). The morning push tags
        // 'morning-checkin-<YYYY-MM-DD>' (Phase 34Z.61), not 'morning_brief'.
        // push_log records the ENQUEUE only (no FCM delivery receipt), so the
        // honest metric is "sent today".
        return supabase.from('push_log')
          .select('id, user_id, tag, enqueued_at')
          .like('tag', 'morning-checkin-%')
          .gte('enqueued_at', `${todayDate}T00:00:00`)
          .lte('enqueued_at', `${todayDate}T23:59:59`)
      })(),
      // Phase 47.7 — source attribution. Pull every lead's source +
      // stage to compute "Cronberry 23% convert vs JustDial 4%" type
      // breakdown. Filtered to last 90 days so old batches don't
      // dilute current performance.
      (async () => {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
        return supabase.from('leads')
          .select('source, stage')
          .not('source', 'is', null)
          .gte('created_at', cutoff)
          .limit(20000)
      })(),
      // Phase 110c (2026-06-02) — reps who CHECKED OUT today, to drop them
      // from "Reps in field right now" (a finished rep keeps a fresh
      // last-ping but is not in the field). Mirrors the TeamDashboard
      // live-count rule (check_out_at / auto_checked_out).
      supabase.from('work_sessions')
        .select('user_id, check_out_at, auto_checked_out')
        .eq('work_date', todayDate),
      // Perf (audit M8) — team-wide follow-ups-due count. Depends only on
      // todayDate (known above) so it rides the batch as the 18th element
      // instead of a separate serial round-trip later. head:count = no rows.
      supabase.from('follow_ups')
        .select('id', { count: 'exact', head: true })
        .eq('is_done', false)
        .lte('follow_up_date', todayDate),
    ])

    const allQuotes    = quotesRes.data       || []
    const paymentsAll  = paymentsAllRes.data  || []
    const paymentsApr  = paymentsApprRes.data || []
    const pending      = pendingPayRes.data   || []
    const profiles     = profilesRes.data     || []
    const msd          = msdRes.data          || []
    const salesUsers      = usersRes.data        || []
    const dailyTargets    = dailyTargetsRes.data || []
    const followupsToday  = followupsDoneTodayRes.data || []
    const settings     = settingsRes.data     || {}
    // Phase 41.2 — Sprint 2 derived values.
    const pendingLeavesCount = pendingLeavesRes.count ?? 0
    const pendingTaCount     = pendingTaRes.count     ?? 0
    // Reps in field = distinct user_id with a ping in last 30 min,
    // MINUS anyone who has checked out today (Phase 110c).
    const checkedOutToday = new Set(
      (wsCheckedOutRes.data || [])
        .filter(w => w.check_out_at || w.auto_checked_out)
        .map(w => w.user_id)
    )
    const liveRepsById = new Map()
    for (const ping of (liveGpsRes.data || [])) {
      if (checkedOutToday.has(ping.user_id)) continue
      if (!liveRepsById.has(ping.user_id)) liveRepsById.set(ping.user_id, ping)
    }
    const liveReps = Array.from(liveRepsById.entries()).map(([user_id, ping]) => ({
      user_id, lastPing: ping.created_at, lat: ping.lat, lng: ping.lng,
    }))
    // Phase 41.3 — Hot leads. Group activities by lead, keep only
    // stage=Working, sort by touch count desc, take top 3.
    const leadTouches = new Map()
    for (const a of (hotLeadsRes?.data || [])) {
      const lead = a.leads
      if (!lead || lead.stage !== 'Working') continue
      const id = lead.id
      const prev = leadTouches.get(id) || { ...lead, touches: 0, lastTouch: null }
      prev.touches += 1
      if (!prev.lastTouch || a.created_at > prev.lastTouch) prev.lastTouch = a.created_at
      leadTouches.set(id, prev)
    }
    const hotLeads = Array.from(leadTouches.values())
      .sort((a, b) => b.touches - a.touches || (b.lastTouch || '').localeCompare(a.lastTouch || ''))
      .slice(0, 3)
    // Phase 41.3 — Brief delivery stats. push_log entries for today
    // with kind='morning_brief'. delivered / failed / total counts.
    // Phase 323 (fix) — push_log records the ENQUEUE only (no FCM delivery
    // receipt: no success/error_msg columns), so "sent" (enqueued) is the honest
    // metric. delivered = sent; failed unknown → 0. Was reading r.success on a
    // column that doesn't exist.
    const briefRows = briefLogRes?.data || []
    const briefStats = {
      total:     briefRows.length,
      delivered: briefRows.length,
      failed:    0,
    }

    // Phase 47.7 — source attribution: per source count + won-count
    // + conversion %. Sorted by conversion desc; top 6 surfaced.
    const sourceAgg = new Map()
    for (const l of (sourceAttribRes?.data || [])) {
      const key = (l.source || '').trim() || '—'
      const row = sourceAgg.get(key) || { source: key, total: 0, won: 0 }
      row.total += 1
      if (l.stage === 'Won') row.won += 1
      sourceAgg.set(key, row)
    }
    const sourceAttrib = Array.from(sourceAgg.values())
      .map(r => ({ ...r, pct: r.total > 0 ? Math.round((r.won / r.total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct || b.total - a.total)
      .slice(0, 6)

    // Apply segment filter to the quote-derived calcs. Private rows
    // historically have segment=null (pre-Phase 4) so 'private' must
    // match both 'PRIVATE' and null/undefined.
    const quotes = activeSegment === 'all'
      ? allQuotes
      : activeSegment === 'government'
        ? allQuotes.filter(q => q.segment === 'GOVERNMENT')
        : allQuotes.filter(q => q.segment !== 'GOVERNMENT')

    // Filter approved payments by their parent quote's segment when a
    // filter is active. Without this, switching to "Government" would
    // still count private payments in Revenue.
    const filteredQuoteIds = new Set(quotes.map(q => q.id))
    const paymentsAprFiltered = activeSegment === 'all'
      ? paymentsApr
      : paymentsApr.filter(p => filteredQuoteIds.has(p.quote_id))

    // Revenue for the selected month = approved payments whose payment_date
    // falls inside [monthStart, monthEnd). The upper bound matters when
    // viewing a past month — without it, later months' payments would leak
    // into the total. paymentsAprFiltered respects the segment toggle.
    const revenue = paymentsAprFiltered
      .filter(p => (p.payment_date || '') >= monthStartIso
                && (p.payment_date || '') <  monthEndIso)
      .reduce((s, p) => s + (p.amount_received || 0), 0)

    // Active quotes = not lost
    const activeQuotesArr = quotes.filter(q => q.status !== 'lost')
    const activeQuotes    = activeQuotesArr.length
    // Phase 31E — owner reported (9 May 2026) Active Quotes card felt
    // bare next to Outstanding. Enrich with total ₹ value + a count of
    // "overdue" quotes (status sent/negotiating, created 30+ days ago,
    // still not closed). Both displayed under the count via the new
    // Kpi `sub` prop.
    const activeValue   = activeQuotesArr.reduce((s, q) => s + (q.total_amount || 0), 0)
    const overdueCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const activeOverdue = activeQuotesArr.filter(q =>
      ['sent', 'negotiating'].includes(q.status)
      && (q.created_at || '') < overdueCutoff
    ).length

    // Pipeline (sent + negotiating value)
    const pipelineValue = quotes
      .filter(q => ['sent', 'negotiating'].includes(q.status))
      .reduce((s, q) => s + (q.total_amount || 0), 0)

    // Lost revenue — quote value we *failed* to close in the selected
    // period. Uses updated_at to bucket by the month the quote moved to
    // 'lost', falling back to created_at. This mirrors the leaderboard's
    // period logic so a quote lost in Mar doesn't bleed into Apr's number.
    const lostRevenue = quotes.reduce((sum, q) => {
      if (q.status !== 'lost') return sum
      const ts = q.updated_at || q.created_at || ''
      if (ts < monthStartIso || ts >= monthEndIso) return sum
      return sum + (q.total_amount || 0)
    }, 0)

    // Won value — total_amount of quotes that flipped to 'won' in the
    // selected period. Same period-bucketing logic as Lost revenue
    // (updated_at falls inside the window). This is the "closed deals"
    // companion to Revenue (cash in): Revenue is what cleared, Won is
    // what was committed. Gap = collections still owed.
    const wonValue = quotes.reduce((sum, q) => {
      if (q.status !== 'won') return sum
      const ts = wonDate(q)  // Phase 311 — won month, not sent/edit month
      if (ts < monthStartIso || ts >= monthEndIso) return sum
      return sum + (q.total_amount || 0)
    }, 0)

    // Outstanding — same per-quote clamp logic as legacy RevenueSummary.
    // Uses paymentsApr (NOT paymentsAprFiltered) because we're already
    // iterating only the segment-filtered `quotes` array; matching by
    // quote_id is implicitly segment-correct.
    const outstanding = quotes.reduce((sum, q) => {
      if (q.status === 'lost') return sum
      const paid = paymentsApr.filter(p => p.quote_id === q.id)
                              .reduce((s, p) => s + Number(p.amount_received || 0), 0)
      const committed = q.status === 'won' || paid > 0
      if (!committed) return sum
      return sum + Math.max(0, Number(q.total_amount || 0) - paid)
    }, 0)

    /* ─── Phase 25d — design-aligned hero KPIs ───────────────────────
       The owner-approved dashboard hero shows five columns:
         Today · MTD · Won value · Pipeline · Outstanding
       Each cell has a small subtitle (delta or count or % of target).
       Compute the extra numbers needed alongside the legacy revenue
       set above. */
    const todayIso = new Date().toISOString().slice(0, 10)
    const todayCollected = paymentsAprFiltered
      .filter(p => (p.payment_date || '').slice(0, 10) === todayIso)
      .reduce((s, p) => s + Number(p.amount_received || 0), 0)

    // Won + pipeline quote counts (used as subtitle on the KPI cells)
    const wonCount = quotes.filter(q => {
      if (q.status !== 'won') return false
      const ts = wonDate(q)  // Phase 311 — won month
      return ts >= monthStartIso && ts < monthEndIso
    }).length
    const pipelineCount = quotes.filter(q =>
      ['sent', 'negotiating'].includes(q.status)
    ).length

    // Outstanding aged > 45 days (won_at older than 45d, balance > 0)
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86400000).toISOString()
    const outstandingOver45d = quotes.reduce((c, q) => {
      if (q.status !== 'won') return c
      const wonAt = q.updated_at || q.created_at || ''
      if (wonAt > fortyFiveDaysAgo) return c
      const paid = paymentsApr
        .filter(p => p.quote_id === q.id)
        .reduce((s, p) => s + Number(p.amount_received || 0), 0)
      return paid < Number(q.total_amount || 0) ? c + 1 : c
    }, 0)

    // Phase 41.3 — Pipeline funnel now period-bucketed. Terminal
    // stages (won, lost) filter by updated_at inside the selected
    // period; in-progress stages (draft, sent, negotiating) keep
    // all-open behaviour since those are forward-looking. Was
    // all-time on every status, which made the funnel useless for
    // monthly tracking.
    const inPeriod = (ts) =>
      ts && ts >= monthStartIso && ts < monthEndIso
    const stages = ['draft', 'sent', 'negotiating', 'won', 'lost'].map(s => {
      const isTerminal = s === 'won' || s === 'lost'
      const qs = quotes.filter(q => {
        if (q.status !== s) return false
        if (!isTerminal) return true
        return inPeriod(s === 'won' ? wonDate(q) : (q.updated_at || q.created_at))  // Phase 311 — won by won_at, lost by updated_at
      })
      return {
        status: s,
        count: qs.length,
        value: qs.reduce((sum, q) => sum + (q.total_amount || 0), 0),
      }
    })
    const funnelMax = Math.max(1, ...stages.map(r => r.count))

    // Team leaderboard — bucketed by SETTLED MONTH, not won month.
    //
    // Business rule: a rep is owed incentive only when the quote is
    // fully paid (sum of approved payments ≥ total OR a payment is
    // flagged is_final_payment). Settle month = date of the payment
    // that crossed the threshold. So a campaign closed in April but
    // fully paid in June lands on June's leaderboard, which is what
    // the rep actually gets paid for.
    //
    // We also compute won-month totals so the UI can show
    // "Closed vs Settled" if/when desired (currently not surfaced —
    // leaderboard renders settled only).
    const settlementMap = buildSettlementMap(quotes, paymentsApr)
    const settledByUser = {}
    const wonByUser = {}
    quotes.forEach(q => {
      // Settled bucket: clearing payment date inside the window
      const s = settlementMap.get(q.id)
      if (s && s.settledAt >= monthStartIso && s.settledAt < monthEndIso) {
        settledByUser[q.created_by] = (settledByUser[q.created_by] || 0) + (q.total_amount || 0)
      }
      // Won bucket (kept for reference / future split)
      if (q.status === 'won') {
        const ts = wonDate(q)  // Phase 311 — won month, consistent with wonValue/wonCount above
        if (ts >= monthStartIso && ts < monthEndIso) {
          wonByUser[q.created_by] = (wonByUser[q.created_by] || 0) + (q.total_amount || 0)
        }
      }
    })
    // Per-rep open pipeline + won-unsettled subtotals — drives the
    // Proposed (forecast) column on the team leaderboard. Same logic
    // the sales-side leaderboard uses; admin reads quotes + payments
    // directly via admin RLS so we don't need the get_team_leaderboard
    // RPC here.
    const finalByQuote = new Set()
    paymentsApr.forEach(p => { if (p.is_final_payment) finalByQuote.add(p.quote_id) })
    const repPipeline = {}
    const ensurePipe = (uid) => {
      if (!repPipeline[uid]) {
        repPipeline[uid] = { openNew: 0, openRen: 0, wuNew: 0, wuRen: 0, wonCount: 0 }
      }
      return repPipeline[uid]
    }
    quotes.forEach(q => {
      const a = ensurePipe(q.created_by)
      const sub = Number(q.subtotal) || 0
      if (!['lost','won'].includes(q.status)) {
        if (q.revenue_type === 'renewal') a.openRen += sub
        else                              a.openNew += sub
      } else if (q.status === 'won') {
        a.wonCount++
        if (!finalByQuote.has(q.id)) {
          if (q.revenue_type === 'renewal') a.wuRen += sub
          else                              a.wuNew += sub
        }
      }
    })

    // Profile lookup so we can run calculateIncentive per rep.
    const profileByUser = {}
    profiles.forEach(p => { profileByUser[p.user_id] = p })

    // Phase 25d — total monthly target across active sales staff,
    // for the MTD KPI's "% of target" subtitle. Per the owner's rule
    // (Phase 25), target = monthly_salary × sales_multiplier (default
    // multiplier 5 from incentive_settings). If no profiles configured,
    // target stays 0 and we render the subtitle as 'target not set'.
    const mtdTarget = profiles.reduce((sum, p) => {
      const salary = Number(p.monthly_salary) || 0
      const mult   = Number(p.sales_multiplier ?? settings.default_multiplier ?? 5)
      return sum + (salary * mult)
    }, 0)

    // Sum monthly_sales_data across the requested period (custom ranges
    // can span multiple months) so earned reflects the whole window.
    //
    // SEGMENT NOTE: monthly_sales_data is populated by the
    // rebuild_monthly_sales DB trigger (supabase_phase3c.sql) which
    // joins payments → quotes but does NOT filter by segment, so the
    // leaderboard reflects BOTH segments regardless of segmentFilter.
    // To split by segment we'd need either (a) an extra column on
    // monthly_sales_data + a trigger update, or (b) compute the
    // leaderboard from quotes+payments directly here. Out of scope
    // for this pass — flagged for follow-up.
    const msdByUser = {}
    const ensureMsd = (uid) => {
      if (!msdByUser[uid]) msdByUser[uid] = { newRev: 0, renRev: 0 }
      return msdByUser[uid]
    }
    msd.forEach(m => {
      if (!monthKeys.includes(m.month_year)) return
      const a = ensureMsd(m.staff_id)
      a.newRev += m.new_client_revenue || 0
      a.renRev += m.renewal_revenue    || 0
    })

    const leaderboard = salesUsers
      .map(u => {
        const pipe = ensurePipe(u.id)
        const monthRev = msdByUser[u.id] || { newRev: 0, renRev: 0 }
        const p = profileByUser[u.id] || {}
        const cfg = {
          monthlySalary:   p.monthly_salary || 0,
          salesMultiplier: p.sales_multiplier ?? settings.default_multiplier ?? 5,
          newClientRate:   p.new_client_rate  ?? settings.new_client_rate    ?? 0.05,
          renewalRate:     p.renewal_rate     ?? settings.renewal_rate       ?? 0.02,
          flatBonus:       p.flat_bonus       ?? settings.default_flat_bonus ?? 10000,
        }
        const earned = calculateIncentive({
          ...cfg,
          newClientRevenue: monthRev.newRev,
          renewalRevenue:   monthRev.renRev,
        })
        const proposed = calculateIncentive({
          ...cfg,
          newClientRevenue: monthRev.newRev + pipe.openNew + pipe.wuNew,
          renewalRevenue:   monthRev.renRev + pipe.openRen + pipe.wuRen,
        })
        return {
          id:       u.id,
          name:     u.name,
          earned:   earned.incentive   || 0,
          proposed: proposed.incentive || 0,
          wonCount: pipe.wonCount,
          settled:  settledByUser[u.id] || 0, // legacy — kept for reference
        }
      })
      .sort((a, b) => b.proposed - a.proposed)
    const lbMax = Math.max(1, ...leaderboard.map(p => p.proposed))

    // Incentive liability — monthly_sales_data is keyed by YYYY-MM, so
    // for a custom range we iterate every month the period touches and
    // sum each rep's incentive across those months. A "above target"
    // rep is counted once if they hit target in ANY month in range
    // (matches how admins think about it: "who's earning bonuses now?").
    let liability = 0
    let aboveTarget = 0
    for (const p of profiles) {
      let repIncentive = 0
      let everAboveTarget = false
      for (const mk of monthKeys) {
        const md = msd.find(s => s.staff_id === p.user_id && s.month_year === mk) || {}
        const r = calculateIncentive({
          monthlySalary:    p.monthly_salary,
          salesMultiplier:  p.sales_multiplier ?? settings.default_multiplier ?? 5,
          newClientRate:    p.new_client_rate  ?? settings.new_client_rate    ?? 0.05,
          renewalRate:      p.renewal_rate     ?? settings.renewal_rate       ?? 0.02,
          flatBonus:        p.flat_bonus       ?? settings.default_flat_bonus ?? settings.flat_bonus ?? 10000,
          newClientRevenue: md.new_client_revenue || 0,
          renewalRevenue:   md.renewal_revenue    || 0,
        })
        repIncentive += r.incentive
        if (r.targetExceeded) everAboveTarget = true
      }
      liability += repIncentive
      if (everAboveTarget) aboveTarget++
    }

    // Outstanding list (top 8)
    const outstandingFull = quotes
      .filter(q => q.status === 'won')
      .map(q => {
        const qPayments = paymentsApr.filter(p => p.quote_id === q.id)
        const paid = qPayments.reduce((s, p) => s + (p.amount_received || 0), 0)
        const final = qPayments.some(p => p.is_final_payment)
        const balance = (q.total_amount || 0) - paid
        return { ...q, paid, balance, final }
      })
      .filter(q => !q.final && q.balance > 0)
    const outstandingList = outstandingFull
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)

    // Phase 41.2 — cash forecast aging buckets. Age = days since
    // updated_at (when quote flipped to 'won'). 3 buckets:
    // fresh (<30d), waiting (30–60d), stale (60d+).
    const cashBuckets = { fresh: 0, waiting: 0, stale: 0 }
    const NOW = Date.now()
    for (const q of outstandingFull) {
      const age = Math.max(0, Math.round((NOW - new Date(q.updated_at || q.created_at).getTime()) / (1000 * 60 * 60 * 24)))
      if (age < 30) cashBuckets.fresh += q.balance
      else if (age < 60) cashBuckets.waiting += q.balance
      else cashBuckets.stale += q.balance
    }

    // Active campaigns (won, campaign_end_date >= today) — top 6
    const activeCampaigns = quotes
      .filter(q => q.status === 'won' && q.campaign_end_date && q.campaign_end_date >= today)
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
      .slice(0, 6)

    // Stale won quotes — won 60+ days ago (per updated_at) AND no final
    // approved payment on file. These are the deals reps closed but
    // haven't collected on, so they sit in everyone's forecast forever.
    // Surfacing them gives admin a punch list to either collect or
    // ask the rep to flip to lost. Sorted by oldest first (worst on top).
    const MS_PER_DAY = 1000 * 60 * 60 * 24
    const todayMs = new Date(today).getTime()
    const staleQuotes = quotes
      .filter(q => q.status === 'won')
      .map(q => {
        const qPayments = paymentsApr.filter(p => p.quote_id === q.id)
        const paid    = qPayments.reduce((s, p) => s + (p.amount_received || 0), 0)
        const final   = qPayments.some(p => p.is_final_payment)
        const balance = Math.max(0, (q.total_amount || 0) - paid)
        const wonAt   = q.updated_at || q.created_at
        const ageDays = wonAt ? Math.max(0, Math.round((todayMs - new Date(wonAt).getTime()) / MS_PER_DAY)) : 0
        return { ...q, paid, balance, final, ageDays }
      })
      .filter(q => !q.final && q.ageDays >= 60)
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 8)

    // Recent activity (merged quotes + payments, last 12).
    // Filter quote events by the segment toggle (uses already-filtered
    // `quotes`). Payment events filter by the joined quote's segment
    // when active so e.g. switching to Government doesn't show private
    // payment activity. `segment` travels with each event so the panel
    // routes /proposal/:id vs /quotes/:id correctly.
    const quoteEvents = quotes
      .slice()
      .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''))
      .slice(0, 10)
      .map(q => ({
        type: 'quote', id: q.id, ts: q.updated_at || q.created_at,
        label: q.client_name,
        sub: q.quote_number || q.ref_number,
        status: q.status,
        actor: q.sales_person_name,
        segment: q.segment,
      }))

    const payEventsAll = paymentsAll
      .slice(0, 10)
      .map(p => ({
        type: 'payment', id: p.quote_id, ts: p.created_at,
        label: p.quotes?.client_name || '—',
        sub:   p.quotes?.quote_number || p.quotes?.ref_number || '',
        amount: p.amount_received, final: p.is_final_payment,
        status: p.approval_status,
        actor: p.quotes?.sales_person_name,
        segment: p.quotes?.segment,
      }))
    const payEvents = activeSegment === 'all'
      ? payEventsAll
      : activeSegment === 'government'
        ? payEventsAll.filter(e => e.segment === 'GOVERNMENT')
        : payEventsAll.filter(e => e.segment !== 'GOVERNMENT')

    const activity = [...quoteEvents, ...payEvents]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 10)

    // 6-month revenue trend (approved payments grouped by month_year)
    const trendMonths = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      trendMonths.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        value: 0,
      })
    }
    paymentsAprFiltered.forEach(p => {
      const k = (p.payment_date || '').slice(0, 7)
      const m = trendMonths.find(x => x.key === k)
      if (m) m.value += p.amount_received || 0
    })
    const trendMax = Math.max(1, ...trendMonths.map(m => m.value))

    // Dashboard spec — Action Queue counts ──────────────────────────
    // The "what should I act on right now" widget. All counts derived
    // from already-fetched data, no extra round-trips.
    //
    // Follow-ups due today across the whole team (admin sees all reps).
    // Perf (audit M8) — folded into the main Promise.all above (18th element)
    // so it no longer costs a separate serial round-trip on every dashboard load.
    const followupsDueCount = followupsDueRes.count || 0

    // Govt proposals waiting on OC copy upload — proposals in 'draft'
    // status (haven't been Sent yet) that are MISSING the OC copy
    // attachment. Surfaces "I need OC copy from delivery before I can
    // mark this Sent" backlog. Reads attachments_checklist JSONB on
    // each govt quote.
    const govtAwaitingOcCount = allQuotes.reduce((n, q) => {
      if (q.segment !== 'GOVERNMENT') return n
      if (q.status !== 'draft') return n
      const checklist = Array.isArray(q.attachments_checklist) ? q.attachments_checklist : []
      const oc = checklist.find(c => /oc copy/i.test(c.label || ''))
      // Missing entirely OR present-but-no-file → still awaiting.
      if (!oc || !oc.file_url || String(oc.file_url).trim() === '') return n + 1
      return n
    }, 0)

    // Renewal opportunities — won quotes whose campaign window ends
    // in the next 30 days. Estimated renewal value = sum of those
    // total_amounts (assumes 1:1 renewal which is generous; real
    // renewal rate is rep+client specific).
    const RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
    const nowMs = new Date(today).getTime()
    const renewalsList = quotes
      .filter(q => q.status === 'won' && q.campaign_end_date)
      .filter(q => {
        const end = new Date(q.campaign_end_date).getTime()
        return end >= nowMs && (end - nowMs) <= RENEWAL_WINDOW_MS
      })
      .sort((a, b) => (a.campaign_end_date || '').localeCompare(b.campaign_end_date || ''))
    const renewalEstValue = renewalsList.reduce((s, q) => s + (q.total_amount || 0), 0)

    // Compose the Action Queue items in priority order. Each item =
    // { id, kind, count, label, urgency, onClickRoute }.
    // Items with count=0 are filtered out — empty rows aren't action.
    const actionQueueAll = [
      {
        id:       'approvals',
        kind:     'red',
        count:    pending.length,
        label:    pending.length === 1 ? 'payment approval waiting' : 'payment approvals waiting',
        route:    '/pending-approvals',
      },
      {
        id:       'stale_won',
        kind:     'red',
        count:    staleQuotes.length,
        label:    staleQuotes.length === 1 ? 'won quote stale 60+ days' : 'won quotes stale 60+ days',
        route:    '/quotes',
      },
      {
        id:       'oc_pending',
        kind:     'amber',
        count:    govtAwaitingOcCount,
        label:    govtAwaitingOcCount === 1 ? 'govt proposal awaiting OC copy' : 'govt proposals awaiting OC copy',
        route:    '/quotes',
      },
      {
        id:       'followups_due',
        kind:     'amber',
        count:    followupsDueCount,
        label:    followupsDueCount === 1 ? 'follow-up due today' : 'follow-ups due today',
        route:    '/quotes',
      },
    ].filter(i => i.count > 0)

    // M1 — per-rep TODAY activity strip + missed-targets banner ──────
    // For each sales user: count today's quotes sent, follow-ups
    // completed, payments logged. Compare against their daily target
    // (defaults applied when no target row exists). Flag misses for
    // the banner. Stale quote count per rep (sent >7d, no follow-up)
    // sits next to the activity counts so admin can see who's letting
    // deals rot.
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const targetByUser = {}
    dailyTargets.forEach(t => { targetByUser[t.user_id] = t })
    const followupCountByUser = {}
    followupsToday.forEach(f => {
      followupCountByUser[f.assigned_to] = (followupCountByUser[f.assigned_to] || 0) + 1
    })

    // We use allQuotes (un-filtered by segment) for the daily activity
    // strip on purpose — admin wants to see TOTAL rep activity today,
    // not per-segment slice. The segment toggle still affects funnel /
    // outstanding / etc. above.
    const repActivity = salesUsers.map(u => {
      const tgt = targetByUser[u.id] || { min_quotes: 2, min_followups: 5, min_calls: 0 }
      const sentToday = allQuotes.filter(q =>
        q.created_by === u.id && (q.created_at || '').slice(0, 10) === todayDate
      ).length
      const paymentsTodayCount = paymentsAll.filter(p =>
        p.received_by === u.id && (p.created_at || '').slice(0, 10) === todayDate
      ).length
      const followupsDone = followupCountByUser[u.id] || 0
      const stale = allQuotes.filter(q =>
        q.created_by === u.id &&
        q.status === 'sent' &&
        (Date.now() - new Date(q.updated_at || q.created_at).getTime()) > SEVEN_DAYS_MS
      ).length
      const missedQuotes    = sentToday    < (tgt.min_quotes    || 0)
      const missedFollowups = followupsDone < (tgt.min_followups || 0)
      return {
        id:   u.id,
        name: u.name,
        target: tgt,
        sentToday,
        followupsDone,
        paymentsTodayCount,
        stale,
        missed: missedQuotes || missedFollowups,
      }
    }).sort((a, b) => {
      // Reps who missed today bubble to top so admin can see them first.
      if (a.missed !== b.missed) return a.missed ? -1 : 1
      return (b.sentToday + b.followupsDone) - (a.sentToday + a.followupsDone)
    })

    const missedReps = repActivity.filter(r => r.missed)

    setState({
      loading: false,
      kpi: {
        revenue, activeQuotes, activeValue, activeOverdue,
        pipelineValue, outstanding,
        pending: pending.length, liability, lostRevenue, wonValue,
        // Phase 25d — design-aligned hero subtitle data
        todayCollected, mtdTarget,
        wonCount, pipelineCount, outstandingOver45d,
      },
      funnel: { stages, max: funnelMax },
      leaderboard, lbMax,
      liability: { total: liability, above: aboveTarget, staff: profiles.length },
      outstandingList, activeCampaigns, staleQuotes, activity, trendMonths, trendMax,
      pending,
      // M1 daily activity
      repActivity, missedReps,
      // Dashboard spec — Action Queue + Renewal Opportunities
      actionQueue: actionQueueAll,
      renewals: { list: renewalsList, estValue: renewalEstValue },
      // Phase 41.2 — admin Action Queue + Reps-in-field cards.
      pendingLeaves: pendingLeavesCount,
      pendingTa:     pendingTaCount,
      liveReps,
      cashBuckets,
      salesUsersForLive: salesUsers,
      // Phase 41.3
      hotLeads,
      briefStats,
      // Phase 47.7
      sourceAttrib,
    })
  }

  if (state.loading) {
    return (
      <div className="v2d">
        <div className="v2d-loading"><div className="v2d-spinner" />Loading dashboard…</div>
      </div>
    )
  }

  const firstName = (profile?.name || 'Admin').split(' ')[0]
  const isHome = location.pathname === '/dashboard'

  // Segment-aware quote opener — the panels below pass either an id
  // (legacy) or { id, segment } (new) to onOpen. Govt rows go to
  // /proposal/:id, everything else to /quotes/:id. Without this branch
  // govt rows 404 when admin clicks them anywhere on the dashboard.
  function openQuote(arg) {
    if (!arg) return
    if (typeof arg === 'string') {
      // Legacy callsite — assume private. New callsites pass an object.
      navigate(`/quotes/${arg}`)
      return
    }
    const { id, segment } = arg
    navigate(segment === 'GOVERNMENT' ? `/proposal/${id}` : `/quotes/${id}`)
  }

  return (
    // Phase 18 — dashboard now lives INSIDE V2AppShell, sharing the
    // same sidebar + topbar as every other page. Previously the
    // dashboard rendered its own chrome (.v2d-app + .v2d-side +
    // .v2d-topbar + .v2d-mnav) which caused users to lose the
    // Lead Pipeline / Team Live / Leads nav links the moment they
    // clicked Dashboard. The .v2d-side / .v2d-topbar / .v2d-mnav
    // blocks are deleted; greeting + period picker + segment filter
    // + Create Quote CTA fold into the page-head row inside content.
    <div className="v2d">
      <div className="v2d-content">
        {/* Greeting + filters + CTA — replaces the old internal topbar */}
        {/* Phase 31E — owner reported (9 May 2026) the entire LEFT half
            of this row was empty whitespace because of the old `flex:1`
            spacer that pushed period picker + segment tabs to the right.
            On a wide desktop it looked broken — like a missing widget.
            Removed the spacer and added a small "Filters" kicker on the
            left so the row reads as labelled controls instead of two
            floating chips. */}
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            flexWrap: 'wrap', marginBottom: 16,
          }}
        >
          <div style={{
            fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase',
            color: 'var(--v2-ink-2)', fontWeight: 700, marginRight: 4,
          }}>
            Filters
          </div>

          {/* Period picker — month nav + presets + custom range. */}
          <PeriodPicker period={period} onChange={setPeriod} />

          {/* Phase 41.5 — segment chip-toggle removed from filter bar;
              Phase 41.2 SegmentToggle pill below the hero is the single
              source. Was duplicated (chips here + pill below). */}
        </header>

        {/* end page-head, body below */}
        <div>
            {/* Phase 31F — owner-facing target progress line. The hero
                further down shows revenue / pipeline / outstanding but
                NOT % to target, which is the single number an owner
                steers by. Renders only when there's a target set so
                fresh installs don't display "0% to ₹0 target". */}
            {state.kpi.mtdTarget > 0 && (
              <div
                style={{
                  fontSize: 13, color: 'var(--v2-ink-1)', marginBottom: 12,
                  display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
                }}
              >
                <span style={{ color: 'var(--v2-ink-2)' }}>This month</span>
                <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)' }}>
                  <Money value={state.kpi.revenue} />
                </span>
                <span style={{ color: 'var(--v2-ink-2)' }}>of</span>
                <span style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, color: 'var(--v2-ink-0)' }}>
                  <Money value={state.kpi.mtdTarget} />
                </span>
                <span style={{
                  fontFamily: 'var(--v2-display)', fontWeight: 700,
                  color: state.kpi.revenue >= state.kpi.mtdTarget ? 'var(--v2-green)' : 'var(--v2-amber)',
                  fontSize: 12,
                  background: state.kpi.revenue >= state.kpi.mtdTarget ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)',
                  padding: '2px 8px', borderRadius: 999,
                }}>
                  {Math.round((state.kpi.revenue / state.kpi.mtdTarget) * 100)}% to target
                </span>
              </div>
            )}

            {/* Phase 41.5 — removed 5 top-of-page widgets that duplicated
                content rendered below the hero:
                - AiBriefingCard (replaced by BriefDeliveryCard Phase 41.3)
                - PipelineFunnelCard (FunnelPanel period-bucketed below)
                - WinRateCard (folded into upcoming polish; was redundant
                  with leaderboard win counts)
                - RecentActivityFeedCard (noise; dropped per Sprint 1 spec
                  but this CockpitWidgets variant survived)
                - ActionQueueCard items-list (replaced by AdminActionsCard
                  Phase 41.2 below the hero) */}

            {/* M1 — Missed-targets banner. Shown only when at least one
                rep is currently below their daily quota. Lists names so
                admin can see who to ping (or who to walk over to).
                When all reps are on track, banner disappears entirely. */}
            {/* Phase 25a — red "X reps below today's target" banner
                removed. Owner-approved design has this surfacing in the
                Team Leaderboard panel further down (Row 3), where each
                rep's % to target is shown with a visual bar and rank
                medals. The banner here was duplicating that signal in
                a less-actionable form. */}

            {/* WhatsApp API billing/eligibility failure (Meta 131042) — surfaced
                up top with a one-tap "Fix billing" link. Self-renders null when clean. */}
            <WaBillingBanner />

            {/* Action Queue — demoted from hero to an inline notification.
                Only renders when there's actually something pending. When
                the queue is empty the banner disappears entirely; admins
                don't need a "well done, inbox zero" pat on the back on
                every page load. */}
            {state.pending.length > 0 && (
              <section
                className="v2d-banner"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: 'rgba(249, 115, 22, 0.08)',
                  border: '1px solid rgba(249, 115, 22, 0.25)',
                  borderRadius: 12,
                  marginBottom: 16,
                }}
              >
                <AlertTriangle size={18} style={{ color: '#f97316', flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Zap size={14} strokeWidth={1.6} />
                    {state.pending.length} payment{state.pending.length > 1 ? 's' : ''} waiting on approval
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.6))' }}>
                    Approve to credit the sales team.
                  </div>
                </div>
                <button
                  className="v2d-banner-cta"
                  onClick={() => navigate('/pending-approvals')}
                  style={{ flex: '0 0 auto' }}
                >
                  Open queue
                </button>
              </section>
            )}

            {/* Phase 25d — Hero Revenue KPIs aligned to the
                owner-approved design (_design_reference/Untitled_Os_(1)/
                app.jsx). Five cells: Today / MTD / Won value / Pipeline /
                Outstanding. Each carries a sub-label (delta / % of target /
                count) that gives the number context.

                Lost revenue + Incentive liability moved off the hero —
                Liability already has its own dedicated mini-card in
                Row 4 (LiabilityPanel). Lost revenue surfaces in the
                Pipeline funnel (Lost row) below the hero. */}
            <section className="v2d-hero v2d-hero--action">
              <div className="v2d-hero-head">
                <div className="v2d-hero-kicker">
                  <span style={{ color: 'var(--v2-yellow, #FFE600)', marginRight: 6 }}>●</span>
                  Revenue · {period.label}
                </div>
                <button className="v2d-banner-cta" onClick={() => navigate('/quotes')}>
                  View quotes
                </button>
              </div>
              <div className="v2d-hero-grid v2d-hero-grid--5col">
                {/* 1. TODAY — today's approved collections */}
                <div>
                  <div className="v2d-hero-stat-l">Today</div>
                  <div className="v2d-hero-big" style={{ fontSize: 28, marginBottom: 6 }}>
                    <Money value={state.kpi.todayCollected} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    Collected today.
                  </div>
                </div>

                {/* 2. MTD — period collections + % of target */}
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">MTD</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.revenue} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    {state.kpi.mtdTarget > 0
                      ? `${Math.round((state.kpi.revenue / state.kpi.mtdTarget) * 100)}% of target`
                      : 'target not set'}
                  </div>
                </div>

                {/* 3. WON VALUE — won quotes total + count */}
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Won value</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.wonValue} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    {state.kpi.wonCount} {state.kpi.wonCount === 1 ? 'quote' : 'quotes'}
                  </div>
                </div>

                {/* 4. PIPELINE — sent + negotiating value + count */}
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Pipeline</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.pipelineValue} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    {state.kpi.pipelineCount} open
                  </div>
                </div>

                {/* 5. OUTSTANDING — unpaid balances + aged count */}
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Outstanding</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.outstanding} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    {state.kpi.outstandingOver45d > 0
                      ? `${state.kpi.outstandingOver45d} over 45d`
                      : 'all current'}
                  </div>
                </div>
              </div>
            </section>

            {/* Phase 41.2 — Segment toggle (was hidden state-only). */}
            <SegmentToggle value={segmentFilter} onChange={setSegmentFilter} />

            {/* Phase 41.2 — Action queue + Reps in field + Cash
                forecast. Three glance cards above the panels. */}
            <section className="v2d-grid-2" style={{ marginBottom: 16 }}>
              <AdminActionsCard
                payments={state.pending.length}
                leaves={state.pendingLeaves}
                ta={state.pendingTa}
                onPayments={() => navigate('/pending-approvals')}
                onLeaves={() => navigate('/people?tab=leaves', { state: { tab: 'leaves' } })}
                onTa={() => navigate('/people?tab=ta', { state: { tab: 'ta' } })}
              />
              <RepsInFieldCard
                rows={state.liveReps}
                salesUsers={state.salesUsersForLive}
                onOpen={() => navigate('/team-dashboard')}
              />
            </section>

            <section style={{ marginBottom: 16 }}>
              <CashForecastCard
                outstanding={state.kpi.outstanding}
                overdueCount={state.kpi.outstandingOver45d}
                buckets={state.cashBuckets}
                onChase={() => {
                  useQuoteStore.getState().resetFilters()
                  useQuoteStore.getState().setFilters({ status: 'won' })
                  navigate('/quotes')
                }}
              />
            </section>

            {/* Phase 41.3 — Top hot leads + brief delivery status. */}
            <section className="v2d-grid-2" style={{ marginBottom: 16 }}>
              <TopHotLeadsCard
                rows={state.hotLeads}
                onOpen={(id) => navigate(`/leads/${id}`)}
                onAll={() => navigate('/leads')}
              />
              <BriefDeliveryCard
                stats={state.briefStats}
                salesUsers={state.salesUsersForLive}
                onRetry={() => navigate('/admin/push-debug')}
              />
            </section>

            {/* Phase 47.7 — source attribution: which lead source
                is converting best in the last 90 days. */}
            <section style={{ marginBottom: 16 }}>
              <SourceAttribCard rows={state.sourceAttrib || []} />
            </section>

            {/* Row 2: Revenue trend + Funnel */}
            <section className="v2d-grid-2">
              {/* Phase 31F — clicking a bar drills into /quotes filtered
                  to that month. monthKey is "YYYY-MM"; we widen it to
                  the full month range and feed the global quote filter
                  store before navigating. */}
              <RevenueTrendPanel
                months={state.trendMonths}
                max={state.trendMax}
                onMonthClick={(monthKey) => {
                  const [yy, mm] = monthKey.split('-').map(Number)
                  const dateFrom = `${yy}-${String(mm).padStart(2, '0')}-01`
                  // Last day of month: day 0 of next month.
                  const last = new Date(yy, mm, 0).getDate()
                  const dateTo = `${yy}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`
                  useQuoteStore.getState().resetFilters()
                  useQuoteStore.getState().setFilters({ dateFrom, dateTo })
                  navigate('/quotes')
                }}
              />
              <FunnelPanel stages={state.funnel.stages} max={state.funnel.max} />
            </section>

            {/* Row 3: Outstanding (LEFT) + Team leaderboard (RIGHT).
                Both are 6-row scannable lists — pairing them fits the
                "where's the money stuck / who's earning" glance an
                admin runs every morning. Outstanding used to take a
                whole row alone which wasted half the width. */}
            <section className="v2d-grid-2">
              <OutstandingPanel
                rows={state.outstandingList}
                onOpen={(row) => openQuote(row)}
              />
              <LeaderboardPanel rows={state.leaderboard} max={state.lbMax} period={period} />
            </section>

            {/* Row 4: Incentive liability + Renewal opportunities.
                Liability = "what we owe the team if month closed today".
                Renewals = "money we could earn if we ask clients ending
                in 30 days." Both forward-looking, naturally paired. */}
            <section className="v2d-grid-2">
              <LiabilityPanel data={state.liability} />
              <RenewalsPanel data={state.renewals} onOpen={(row) => openQuote(row)} onAll={() => navigate('/renewal-tools')} />
            </section>

            {/* Row 4c — Phase 12 rev3 — Lead pipeline (left) + Today's
                team activity (right). Lead funnel is for the M1 LEADS
                table (separate from the QUOTES funnel above). Team
                activity shows daily check-ins + counters per person. */}
            <section className="v2d-grid-2" style={{ marginTop: 16 }}>
              <LeadPipelinePanel />
              <TeamActivityPanel />
            </section>

            {/* Row 4b: Stale won quotes — separate row, full-width when
                present. Forward-looking risk: deals won that won't
                actually collect unless someone chases. Hidden when
                count = 0 to keep the page tight. */}
            {state.staleQuotes && state.staleQuotes.length > 0 && (
              <section>
                <StalePanel rows={state.staleQuotes} onOpen={(row) => openQuote(row)} />
              </section>
            )}

            {/* Phase 41.1 — RepActivityPanel dropped (folded into
                TeamActivityPanel above). Recent activity feed
                (ActivityPanel) dropped — audit trail moves to a
                separate /audit-log page if needed; not daily-glance
                material. */}

            {/* Row 5: Active campaigns — horizontal grid of cards needs
                the full row width to lay out without wrapping awkwardly. */}
            <ActiveCampaignsPanel rows={state.activeCampaigns} onOpen={(row) => openQuote(row)} />

            <div className="v2d-foot">
              v2 · admin · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>
      </div>
    )
  }

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function Kpi({ label, value, count, tone, dot, sub, cta }) {
  const icon = { green: '₹', blue: '◎', amber: '⏱', rose: '!' }[tone] || '•'
  const iconClass = tone === 'green' ? 'v2d-kpi-ic--green'
                  : tone === 'blue'  ? 'v2d-kpi-ic--blue'
                  : tone === 'amber' ? 'v2d-kpi-ic--amber' : 'v2d-kpi-ic--rose'
  return (
    <div className="v2d-kpi">
      <div className="v2d-kpi-head">
        <div className={`v2d-kpi-ic ${iconClass}`}>{icon}</div>
        <div className="v2d-kpi-l">{label}</div>
        {/* Phase 31F — optional CTA link in the head row (top-right).
            Passed as { label, onClick }. Keeps the KPI value clean
            while giving the user a one-click drill-down. */}
        {cta && (
          <button
            type="button"
            onClick={cta.onClick}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 0,
              color: 'var(--v2-yellow)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', padding: 0,
            }}
          >
            {cta.label} →
          </button>
        )}
      </div>
      <div className="v2d-kpi-v">
        {value !== undefined ? <Money value={value} /> : (count ?? 0)}
      </div>
      {/* Phase 31E — optional sub line for richer context (e.g. value
          + overdue count under Active Quotes count). */}
      {sub && (
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 4, fontWeight: 500 }}>
          {sub}
        </div>
      )}
      {dot && <div className="v2d-kpi-delta"><span className="up">●</span> needs attention</div>}
    </div>
  )
}

function RevenueTrendPanel({ months, max, onMonthClick }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Revenue trend · last 6 months</div>
          {/* Phase 31F — added "click any bar to drill in" hint so the
              affordance is discoverable. */}
          <div className="v2d-panel-s">Approved payments per month · click a bar to open the quotes</div>
        </div>
      </div>
      <div className="v2d-bars">
        {months.map((m, i) => {
          const h = Math.max(6, Math.round((m.value / max) * 170))
          const isCurrent = i === months.length - 1
          // Phase 31F — render bar columns as buttons when an onMonthClick
          // handler is provided. Disabled for empty months so dead clicks
          // don't reach a /quotes view that has nothing to show.
          const clickable = !!onMonthClick && m.value > 0
          return (
            <button
              key={m.key}
              type="button"
              className="v2d-bar-col"
              onClick={clickable ? () => onMonthClick(m.key) : undefined}
              disabled={!clickable}
              title={clickable ? `Open ${m.label} quotes` : `${m.label}: no revenue`}
              style={{
                background: 'transparent', border: 0, padding: 0,
                cursor: clickable ? 'pointer' : 'default',
                color: 'inherit', font: 'inherit', textAlign: 'inherit',
              }}
            >
              <div className={`v2d-bar ${isCurrent ? 'is-current' : ''}`} style={{ height: h }}>
                <div className="v2d-bar-v"><Money value={m.value} /></div>
              </div>
              <div className="v2d-bar-m">{m.label}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FunnelPanel({ stages, max }) {
  const colors = {
    draft: 'var(--v2-ink-2)',
    sent: 'var(--v2-blue)',
    negotiating: 'var(--v2-amber)',
    won: 'var(--v2-green)',
    lost: 'var(--v2-rose)',
  }
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Pipeline funnel</div>
          <div className="v2d-panel-s">All-time quote distribution</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Phase 25b — hide zero-count stages. A row reading
            "Negotiating 0 [empty bar] ₹0" was visual noise. If a
            stage genuinely has no quotes there's nothing to render. */}
        {stages.filter(s => s.count > 0).map(s => (
          <div key={s.status} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 80px', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: colors[s.status], fontWeight: 600, textTransform: 'capitalize' }}>
              {s.status} <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}>{s.count}</span>
            </div>
            <div style={{ height: 8, background: 'var(--v2-bg-2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(s.count / max) * 100}%`, height: '100%', background: colors[s.status], borderRadius: 'inherit' }} />
            </div>
            <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 12, color: 'var(--v2-ink-0)', textAlign: 'right' }}>
              <Money value={s.value} />
            </div>
          </div>
        ))}
        {stages.every(s => s.count === 0) && (
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', padding: '8px 0' }}>
            No quotes yet.
          </div>
        )}
      </div>
    </div>
  )
}

function ApprovalQueuePanel({ pending, onOpen, onAll }) {
  const top = pending.slice(0, 5)
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Approval queue</div>
          <div className="v2d-panel-s">Payments waiting for your sign-off</div>
        </div>
        {pending.length > 0 && <button className="v2d-link" onClick={onAll}>Open all</button>}
      </div>
      {top.length === 0 ? (
        <div className="v2d-q-empty">Inbox zero — no pending payments.</div>
      ) : top.map(p => (
        <div key={p.id} className="v2d-q-row" onClick={() => onOpen(p.quote_id)}>
          <div className="v2d-q-ic v2d-q-ic--pay"><CreditCard size={14} /></div>
          <div className="v2d-q-body">
            <div className="v2d-q-t">
              {p.quotes?.client_name || '—'}
              <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}> · {p.quotes?.quote_number || ''}</span>
            </div>
            <div className="v2d-q-s">
              {p.quotes?.sales_person_name || 'Sales'} · {formatRelative(p.created_at)}
            </div>
          </div>
          <div className="v2d-q-amt"><Money value={p.amount_received} /></div>
          <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
        </div>
      ))}
    </div>
  )
}

// Segment badge — small inline pill that distinguishes govt from
// private rows in the dashboard lists. Returns null for private so
// the chrome stays clean for the historically-only-private case.
function SegmentBadge({ segment }) {
  if (segment !== 'GOVERNMENT') return null
  return (
    <span style={{
      marginLeft: 6,
      padding: '1px 7px',
      borderRadius: 999,
      background: 'rgba(100,181,246,.15)',
      color: '#64b5f6',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
    }}>Govt</span>
  )
}

function OutstandingPanel({ rows, onOpen }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Outstanding payments</div>
          <div className="v2d-panel-s">Won quotes with an unpaid balance</div>
        </div>
        {rows.length > 0 && <div className="v2d-badge v2d-badge--rose">{rows.length}</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2d-q-empty">No outstanding balances.</div>
      ) : rows.map(r => {
        const pct = r.total_amount ? Math.round((r.paid / r.total_amount) * 100) : 0
        return (
          <div key={r.id} className="v2d-q-row" onClick={() => onOpen(r)}>
            <div className="v2d-q-ic v2d-q-ic--rose"><AlertTriangle size={14} /></div>
            <div className="v2d-q-body">
              <div className="v2d-q-t">
                {r.client_company || r.client_name}
                {r.client_company && r.client_name && <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}> · {r.client_name}</span>}
                <SegmentBadge segment={r.segment} />
              </div>
              <div className="v2d-q-s">{r.quote_number || r.ref_number} · {pct}% paid</div>
            </div>
            <div className="v2d-q-amt"><Money value={r.balance} /></div>
            <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
          </div>
        )
      })}
    </div>
  )
}

/* Team leaderboard — admin flavour.
   Shows all sales reps ranked by won-quote revenue for the selected
   period. Unlike the sales-side leaderboard there's no "me" highlighting
   because admin isn't a rep. Reps with zero wins still render so admin
   can see who hasn't closed anything this month. Shows top 8 — long
   tail gets collapsed. */
function LeaderboardPanel({ rows, max, period }) {
  const medals = ['🥇', '🥈', '🥉']
  const top = rows.slice(0, 8)
  // period is the normalized object from utils/period.js; label is
  // already formatted for display ("Apr 2026" or "Apr 10 – 20, 2026").
  const label = period?.label
    || new Date().toLocaleDateString('en-IN', { month: 'short' })
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Team leaderboard · {label}</div>
          <div className="v2d-panel-s">Proposed incentive + total won quotes</div>
        </div>
      </div>
      {top.length === 0 ? (
        <div className="v2d-q-empty">No sales reps on the team yet.</div>
      ) : (
        <div className="v2d-lb">
          {top.map((r, i) => {
            const pct = max > 0 ? Math.round((r.proposed / max) * 100) : 0
            const rankCls = i === 0 ? 'v2d-lb-rank-1' : i === 1 ? 'v2d-lb-rank-2' : i === 2 ? 'v2d-lb-rank-3' : 'v2d-lb-rank-n'
            return (
              <div key={r.id} className="v2d-lb-row" style={{ alignItems: 'center' }}>
                <div className={`v2d-lb-rank ${rankCls}`}>{medals[i] || i + 1}</div>
                <div className="v2d-lb-avatar">{initials(r.name)}</div>
                {/* Phase 31E — owner reported (9 May 2026) leaderboard
                    names truncating to "Test...", "Brijesh...". The
                    1fr name column gets squeezed when Outstanding
                    panel takes the other half. Added a hover tooltip
                    so the full name is one mouse-over away even when
                    truncation kicks in; tightened the right cols in
                    .v2d-lb-row CSS to 80/80/40 to give names a bit
                    more breathing room before truncation triggers. */}
                <div className="v2d-lb-name" title={r.name}>
                  {r.name}
                  <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontWeight: 500, marginTop: 2 }}>
                    {r.wonCount} won quote{r.wonCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 90 }}>
                  <div style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--v2-ink-2)', fontWeight: 700, textTransform: 'uppercase' }}>Earned</div>
                  <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13, color: 'var(--v2-green)' }}>
                    <Money value={r.earned} />
                  </div>
                </div>
                <div className="v2d-lb-val" style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--v2-ink-2)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 1 }}>Proposed</div>
                  <Money value={r.proposed} />
                </div>
                <div className="v2d-lb-pct">{pct}%</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LiabilityPanel({ data }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Incentive liability</div>
          <div className="v2d-panel-s">Projected payout if the month closed today</div>
        </div>
        <div className="v2d-badge v2d-badge--neutral">{data.above}/{data.staff} above target</div>
      </div>
      <div className="v2d-prog-big"><Money value={data.total} /></div>
      <div className="v2d-prog-meta">
        <span>Active sales staff</span>
        <span style={{ color: 'var(--v2-ink-0)', fontWeight: 700 }}>{data.staff}</span>
      </div>
    </div>
  )
}

function ActiveCampaignsPanel({ rows, onOpen }) {
  const today = istTodayISO()
  return (
    <section className="v2d-panel" style={{ marginBottom: 22 }}>
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Active campaigns</div>
          <div className="v2d-panel-s">Won quotes with a live campaign window</div>
        </div>
        {rows.length > 0 && <div className="v2d-badge v2d-badge--green">{rows.length} running</div>}
      </div>
      {rows.length === 0 ? (
        <div className="v2d-q-empty">No active campaigns. Won quotes with future end dates will appear here.</div>
      ) : (
        <div className="v2d-camp-grid">
          {rows.map(r => {
            const daysLeft = daysBetween(r.campaign_end_date, today)
            const pillCls = daysLeft <= 3 ? 'v2d-camp-pill--end'
                          : daysLeft <= 7 ? 'v2d-camp-pill--soon'
                          : 'v2d-camp-pill--live'
            const pillLabel = daysLeft <= 3 ? 'Ending' : daysLeft <= 7 ? 'Soon' : 'Live'
            // Progress = elapsed / total
            const totalDays = r.campaign_start_date ? daysBetween(r.campaign_end_date, r.campaign_start_date) : 30
            const elapsed = r.campaign_start_date ? Math.max(0, daysBetween(today, r.campaign_start_date)) : 0
            const pct = totalDays > 0 ? Math.min(100, Math.round((elapsed / totalDays) * 100)) : 0
            return (
              <div key={r.id} className="v2d-camp" onClick={() => onOpen(r)} style={{ cursor: 'pointer' }}>
                <div className="v2d-camp-h">
                  <div className="v2d-camp-n" title={r.client_company || r.client_name}>
                    {r.client_company || r.client_name}
                    <SegmentBadge segment={r.segment} />
                  </div>
                  <span className={`v2d-camp-pill ${pillCls}`}>{pillLabel}</span>
                </div>
                <div className="v2d-camp-s">
                  {r.quote_number || r.ref_number}
                  {r.sales_person_name && ` · ${r.sales_person_name}`}
                </div>
                <div className="v2d-camp-s" style={{ marginTop: 4, color: 'var(--v2-ink-0)', fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 13 }}>
                  {daysLeft} day{daysLeft === 1 ? '' : 's'} left · <Money value={r.total_amount || 0} />
                </div>
                <div className="v2d-camp-prog"><div className="v2d-camp-prog-fill" style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// Stale won-quote panel — won 60+ days ago, never settled. Each row
// shows the rep responsible, age in days, balance owed. Sorted oldest
// first (60+ d → ∞). Used by admin to either chase the cash or have
// the rep flip the quote to lost so it stops inflating forecasts.
function StalePanel({ rows, onOpen }) {
  return (
    <section className="v2d-panel" style={{ marginBottom: 22 }}>
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Stale won quotes · 60+ days unsettled</div>
          <div className="v2d-panel-s">Won, never paid in full — chase the cash or flip to lost</div>
        </div>
        <div className="v2d-badge v2d-badge--rose">{rows.length} stale</div>
      </div>
      <table className="v2d-qt">
        <thead>
          <tr>
            <th>Quote</th>
            <th>Client</th>
            <th>Rep</th>
            <th className="num">Age</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} onClick={() => onOpen(r)} style={{ cursor: 'pointer' }}>
              <td>{r.quote_number || r.ref_number || '—'}</td>
              <td>
                {r.client_company || r.client_name || '—'}
                <SegmentBadge segment={r.segment} />
              </td>
              <td>{r.sales_person_name || '—'}</td>
              <td className="num">
                <span className="v2d-camp-age v2d-camp-age--stale">{r.ageDays}d</span>
              </td>
              <td className="num"><Money value={r.balance || 0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// Dashboard spec — Action Queue card. Hero slot. Static rule-based
// version. AI agent integration replaces this with a generated
// morning briefing later (same slot, swap the body content). When
// the queue is empty, shows "Inbox zero" instead of hiding entirely
// because the slot is supposed to be the hero of the page.
function ActionQueueCard({ items, onOpen }) {
  const allClear = items.length === 0
  const KIND = {
    red:   { color: '#f87171', bg: 'rgba(248,113,113,.1)',  border: 'rgba(248,113,113,.3)' },
    amber: { color: '#fbbf24', bg: 'rgba(251,191,36,.08)',  border: 'rgba(251,191,36,.25)' },
    green: { color: '#4ade80', bg: 'rgba(74,222,128,.08)',  border: 'rgba(74,222,128,.25)' },
  }
  return (
    <section
      // Phase 25b — was className="v2d-banner" but that has
      // display:flex globally, which made the title-block and the
      // items-list lay out side-by-side, leaving a big empty void to
      // the right of the chips. Use plain block so children stack.
      style={{
        display: 'block',
        padding: '14px 18px', marginBottom: 16,
        background: allClear ? 'rgba(74,222,128,.06)' : 'rgba(15, 23, 42, .6)',
        border: `1px solid ${allClear ? 'rgba(74,222,128,.2)' : 'var(--v2-border)'}`,
        borderRadius: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: allClear ? 0 : 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--v2-ink-2)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>
            Action queue {!allClear && `· ${items.length} item${items.length === 1 ? '' : 's'}`}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--v2-ink-0)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {allClear ? (<><CheckCircle2 size={16} /> Inbox zero — nothing needs your attention.</>) : 'What you should act on today'}
          </div>
        </div>
      </div>
      {!allClear && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(it => {
            const meta = KIND[it.kind] || KIND.amber
            return (
              <button
                key={it.id}
                onClick={() => onOpen?.(it.route)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  background: meta.bg,
                  border: `1px solid ${meta.border}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = meta.bg.replace(/,\.\d+\)/, ',.18)') }}
                onMouseLeave={e => { e.currentTarget.style.background = meta.bg }}
              >
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 32, height: 28, padding: '0 8px', borderRadius: 8,
                  background: meta.color, color: 'var(--v2-bg-0)',
                  fontFamily: 'var(--v2-display)', fontWeight: 800, fontSize: 14,
                }}>{it.count}</span>
                <span style={{ fontSize: 13, color: 'var(--v2-ink-0)', fontWeight: 500, flex: 1 }}>
                  {it.label}
                </span>
                <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

// Dashboard spec — Renewal Opportunities widget. Paired with the
// Liability panel (both forward-looking). Shows count of campaigns
// ending in the next 30 days + estimated renewal value (sum of
// total_amounts; assumes 1:1 renewal which is generous, real rate
// varies by client). Click → opens specific quote or routes to
// renewal-tools page.
function RenewalsPanel({ data, onOpen, onAll }) {
  const list = data?.list || []
  const estValue = data?.estValue || 0
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Renewal opportunities</div>
          <div className="v2d-panel-s">Campaigns ending in the next 30 days</div>
        </div>
        {list.length > 0 && <button className="v2d-link" onClick={onAll}>Open all →</button>}
      </div>
      {list.length === 0 ? (
        <div className="v2d-q-empty">No campaigns ending in the next 30 days.</div>
      ) : (
        <>
          {/* Big "estimated renewal value" stat at the top */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '8px 0 14px', borderBottom: '1px solid var(--v2-border)',
            marginBottom: 10,
          }}>
            <div>
              <div className="v2d-prog-big"><Money value={estValue} /></div>
              <div className="v2d-prog-meta">
                <span>Est. renewal value · {list.length} campaign{list.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          {/* Top 5 ending soonest */}
          {list.slice(0, 5).map(r => {
            const daysLeft = Math.max(0, Math.round((new Date(r.campaign_end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
            return (
              <div key={r.id} className="v2d-q-row" onClick={() => onOpen?.(r)}>
                <div className="v2d-q-ic v2d-q-ic--green"><Repeat size={14} /></div>
                <div className="v2d-q-body">
                  <div className="v2d-q-t">
                    {r.client_company || r.client_name}
                    {r.client_company && r.client_name && (
                      <span style={{ color: 'var(--v2-ink-2)', fontWeight: 500 }}> · {r.client_name}</span>
                    )}
                  </div>
                  <div className="v2d-q-s">
                    {r.quote_number || r.ref_number} · ends in {daysLeft} day{daysLeft === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="v2d-q-amt"><Money value={r.total_amount || 0} /></div>
                <ArrowUpRight size={14} style={{ color: 'var(--v2-ink-2)' }} />
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// M1 — Per-rep daily activity strip. Renders one row per sales user
// with today's quote count + follow-ups + payments + stale quote
// count. Each cell shows X/Y format with an amber chip when below
// target. Stale = sent quotes idle >7d with no follow-up; this is
// the "rotting deal" warning for the rep.
function RepActivityPanel({ rows }) {
  return (
    <section className="v2d-panel" style={{ marginBottom: 22 }}>
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Team — today's activity</div>
          <div className="v2d-panel-s">Quotes sent / follow-ups done / payments logged · vs daily target</div>
        </div>
        {rows.some(r => r.missed) && (
          <div className="v2d-badge v2d-badge--rose">
            {rows.filter(r => r.missed).length} below target
          </div>
        )}
      </div>
      <table className="v2d-qt">
        <thead>
          <tr>
            <th>Rep</th>
            <th className="num">Quotes</th>
            <th className="num">Follow-ups</th>
            <th className="num">Payments</th>
            <th className="num">Stale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const cell = (value, target) => {
              if (target === 0) return <span style={{ color: 'var(--v2-ink-2)' }}>{value}</span>
              const hit = value >= target
              return (
                <span style={{
                  fontWeight: 600,
                  color: hit ? 'var(--v2-green)' : 'var(--v2-amber)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  {value} / {target}{hit && <CheckCircle2 size={12} />}
                </span>
              )
            }
            return (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name || '—'}</td>
                <td className="num">{cell(r.sentToday,     r.target.min_quotes    || 0)}</td>
                <td className="num">{cell(r.followupsDone, r.target.min_followups || 0)}</td>
                <td className="num">
                  <span style={{ color: r.paymentsTodayCount > 0 ? 'var(--v2-green)' : 'var(--v2-ink-2)', fontWeight: 600 }}>
                    {r.paymentsTodayCount}
                  </span>
                </td>
                <td className="num">
                  <span style={{
                    color: r.stale > 0 ? 'var(--v2-rose)' : 'var(--v2-ink-2)',
                    fontWeight: r.stale > 0 ? 700 : 400,
                  }}>
                    {r.stale}{r.stale > 0 ? ' ⚠' : ''}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}

function ActivityPanel({ items, onOpen }) {
  function getIcon(item) {
    if (item.type === 'payment') {
      return item.final
        ? <CheckCircle2 size={14} style={{ color: 'var(--v2-green)' }} />
        : <CreditCard size={14} style={{ color: 'var(--v2-blue)' }} />
    }
    if (item.status === 'sent')        return <Send size={14} style={{ color: 'var(--v2-blue)' }} />
    if (item.status === 'won')         return <CheckCircle2 size={14} style={{ color: 'var(--v2-green)' }} />
    if (item.status === 'draft')       return <PenLine size={14} style={{ color: 'var(--v2-ink-2)' }} />
    return <FileText size={14} style={{ color: 'var(--v2-ink-2)' }} />
  }

  function getDesc(item) {
    if (item.type === 'payment') {
      return item.final
        ? <>Final payment <b><Money value={item.amount} /></b> received</>
        : <>Payment of <b><Money value={item.amount} /></b> recorded</>
    }
    const map = {
      draft:       'Quote drafted',
      sent:        'Quote sent to client',
      negotiating: 'Quote under negotiation',
      won:         'Quote marked Won',
      lost:        'Quote marked Lost',
    }
    return map[item.status] || `Status: ${item.status}`
  }

  return (
    <section className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Recent activity</div>
          <div className="v2d-panel-s">Latest quote + payment events</div>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="v2d-q-empty">No activity yet.</div>
      ) : items.map((it, i) => (
        <div key={`${it.type}-${it.id}-${i}`} className="v2d-act-row" onClick={() => onOpen(it)} style={{ cursor: 'pointer' }}>
          <div className={`v2d-act-dot ${it.type === 'payment' ? (it.final ? 'green' : 'blue') : it.status === 'won' ? 'green' : it.status === 'lost' ? 'rose' : ''}`} />
          <div>
            <div className="v2d-act-t">{getDesc(it)}</div>
            <div className="v2d-act-s">
              {it.label}
              {it.sub && ` · ${it.sub}`}
              {it.actor && ` · ${it.actor}`}
              <SegmentBadge segment={it.segment} />
            </div>
          </div>
          <div className="v2d-act-time">{formatRelative(it.ts)}</div>
        </div>
      ))}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════
   Phase 41.2 — Sprint 2 cards: Segment toggle + Admin Actions
   queue + Reps-in-field + Cash forecast.
   ═══════════════════════════════════════════════════════════ */

function SegmentToggle({ value, onChange }) {
  const opts = [
    { k: 'all',        label: 'All' },
    { k: 'private',    label: 'Private' },
    { k: 'government', label: 'Government' },
  ]
  return (
    <div style={{
      display: 'inline-flex', gap: 4, padding: 4,
      background: 'var(--v2-bg-1)', border: '1px solid var(--v2-line)',
      borderRadius: 999, marginBottom: 16,
    }}>
      {opts.map(o => {
        const on = value === o.k
        return (
          <button
            key={o.k}
            type="button"
            onClick={() => onChange(o.k)}
            style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              border: 'none', borderRadius: 999, cursor: 'pointer',
              background: on ? 'var(--v2-yellow, #FFE600)' : 'transparent',
              color:      on ? 'var(--accent-fg, #0F172A)' : 'var(--v2-ink-2)',
              fontFamily: 'inherit',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function AdminActionsCard({ payments, leaves, ta, onPayments, onLeaves, onTa }) {
  const total = (payments || 0) + (leaves || 0) + (ta || 0)
  const rows = [
    { k: 'pay',    label: 'Payments waiting approval',  count: payments, action: onPayments, tone: 'amber' },
    { k: 'leave',  label: 'Leave requests pending',     count: leaves,   action: onLeaves,   tone: 'blue'  },
    { k: 'ta',     label: 'TA/DA claims pending',       count: ta,       action: onTa,      tone: 'green' },
  ]
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Your action queue</div>
          <div className="v2d-panel-s">{total > 0 ? `${total} item${total > 1 ? 's' : ''} need you today` : 'All clear — nothing waiting'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <button
            key={r.k}
            type="button"
            onClick={r.count > 0 ? r.action : undefined}
            disabled={!(r.count > 0)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 14px',
              background: r.count > 0 ? 'rgba(255,255,255,.02)' : 'transparent',
              border: '1px solid var(--v2-line)',
              borderRadius: 10,
              cursor: r.count > 0 ? 'pointer' : 'default',
              opacity: r.count > 0 ? 1 : 0.55,
              fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>{r.label}</span>
            <span style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 14, fontWeight: 700,
              color: r.count > 0
                ? (r.tone === 'amber' ? 'var(--v2-amber, #F59E0B)'
                 : r.tone === 'blue'  ? 'var(--v2-blue, #3B82F6)'
                 :                       'var(--v2-green, #10B981)')
                : 'var(--v2-ink-2)',
            }}>
              {r.count || 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function RepsInFieldCard({ rows = [], salesUsers = [], onOpen }) {
  const nameById = new Map((salesUsers || []).map(u => [u.id, u.name]))
  const count = rows.length
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Reps in field right now</div>
          <div className="v2d-panel-s">GPS ping in last 30 min · live</div>
        </div>
        {count > 0 && (
          <button className="v2d-banner-cta" onClick={onOpen}>Open map</button>
        )}
      </div>
      {count === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
          No reps live right now.
        </div>
      ) : (
        <div>
          <div style={{
            fontFamily: 'var(--v2-display, Space Grotesk, sans-serif)',
            fontSize: 30, fontWeight: 700, color: 'var(--v2-green, #10B981)',
            marginBottom: 8,
          }}>
            {count} live
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {rows.slice(0, 12).map(r => (
              <span key={r.user_id} style={{
                fontSize: 11, padding: '4px 10px',
                background: 'rgba(16,185,129,.14)',
                color: 'var(--v2-green, #10B981)',
                borderRadius: 999, fontWeight: 600,
              }}>
                {nameById.get(r.user_id) || '—'}
              </span>
            ))}
            {rows.length > 12 && (
              <span style={{ fontSize: 11, color: 'var(--v2-ink-2)', padding: '4px 6px' }}>
                +{rows.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CashForecastCard({ outstanding, overdueCount, buckets = {}, onChase }) {
  const fresh   = Number(buckets.fresh   || 0)
  const waiting = Number(buckets.waiting || 0)
  const stale   = Number(buckets.stale   || 0)
  const total = fresh + waiting + stale
  function pct(n) { return total > 0 ? Math.round((n / total) * 100) : 0 }
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Cash forecast · outstanding aging</div>
          <div className="v2d-panel-s">Total owed: <Money value={outstanding} /> {overdueCount > 0 ? `· ${overdueCount} over 45d` : ''}</div>
        </div>
        {outstanding > 0 && (
          <button className="v2d-banner-cta" onClick={onChase}>Chase</button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ForecastBar label="Fresh · under 30 days"    value={fresh}   pct={pct(fresh)}   color="var(--v2-green, #10B981)" />
        <ForecastBar label="Waiting · 30 to 60 days"  value={waiting} pct={pct(waiting)} color="var(--v2-amber, #F59E0B)" />
        <ForecastBar label="Stale · 60+ days"         value={stale}   pct={pct(stale)}   color="var(--v2-rose, #EF4444)" />
      </div>
    </div>
  )
}

function TopHotLeadsCard({ rows = [], onOpen, onAll }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Top hot leads · this week</div>
          <div className="v2d-panel-s">Most-touched Working leads in the last 7 days</div>
        </div>
        <button className="v2d-banner-cta" onClick={onAll}>All leads</button>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--v2-ink-2)', fontSize: 13 }}>
          No active lead activity in last 7 days.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpen?.(r.id)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 14px', borderRadius: 10,
                border: '1px solid var(--v2-line)', background: 'rgba(255,255,255,.02)',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{
                  fontFamily: 'var(--v2-display, Space Grotesk, sans-serif)',
                  fontSize: 18, fontWeight: 700, color: 'var(--v2-yellow, #FFE600)',
                  width: 24, textAlign: 'center',
                }}>
                  {i + 1}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v2-ink-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.company || r.name || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
                    {r.name || '—'} · {r.stage}
                  </div>
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12, fontWeight: 700, color: 'var(--v2-green, #10B981)',
                padding: '3px 9px', background: 'rgba(16,185,129,.14)',
                borderRadius: 999,
              }}>
                {r.touches} touch{r.touches > 1 ? 'es' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BriefDeliveryCard({ stats = {}, salesUsers = [], onRetry }) {
  const total = stats.total || 0
  const delivered = stats.delivered || 0
  const failed = stats.failed || 0
  const teamSize = (salesUsers || []).length || 0
  const expected = teamSize > 0 ? teamSize : total
  const allOk = total > 0 && failed === 0
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Morning brief · today</div>
          <div className="v2d-panel-s">
            {total === 0
              ? 'No brief enqueued yet today (sends 9:30 IST)'
              : allOk
                ? `Delivered to ${delivered}/${expected}`
                : `${delivered}/${expected} delivered · ${failed} failed`}
          </div>
        </div>
        {failed > 0 && (
          <button className="v2d-banner-cta" onClick={onRetry}>Open log</button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <BriefStat label="Sent"      value={total}     color="var(--v2-blue, #3B82F6)" />
        <BriefStat label="Delivered" value={delivered} color="var(--v2-green, #10B981)" />
        <BriefStat label="Failed"    value={failed}    color={failed > 0 ? 'var(--v2-rose, #EF4444)' : 'var(--v2-ink-2)'} />
      </div>
    </div>
  )
}

function BriefStat({ label, value, color }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px',
      background: 'rgba(255,255,255,.02)',
      border: '1px solid var(--v2-line)',
      borderRadius: 10, textAlign: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--v2-display, Space Grotesk, sans-serif)',
        fontSize: 22, fontWeight: 700, color,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.10em', marginTop: 4, fontWeight: 600 }}>
        {label}
      </div>
    </div>
  )
}

function ForecastBar({ label, value, pct, color }) {
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 12, marginBottom: 4, color: 'var(--v2-ink-1)',
      }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>
          <Money value={value} /> · {pct}%
        </span>
      </div>
      <div style={{
        height: 8, background: 'rgba(255,255,255,.04)', borderRadius: 999, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.max(2, pct)}%`, height: '100%',
          background: color, borderRadius: 999,
          transition: 'width 240ms ease',
        }} />
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   PHASE 47.7 — Source attribution card
   ════════════════════════════════════════════════════════════════════ */
function SourceAttribCard({ rows = [] }) {
  if (rows.length === 0) return null
  const maxTotal = Math.max(1, ...rows.map(r => r.total))
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Source attribution · last 90 days</div>
          <div className="v2d-panel-s">Which lead source is converting best (Won / total leads).</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => {
          const widthPct = Math.round((r.total / maxTotal) * 100)
          const goodPct  = r.pct >= 15
          return (
            <div
              key={r.source}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 90px 70px',
                gap: 10, alignItems: 'center',
                padding: '8px 12px',
                background: 'rgba(255,255,255,.02)',
                border: '1px solid var(--v2-line)',
                borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--v2-ink-0)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.source}
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,.04)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.max(2, widthPct)}%`, height: '100%',
                  background: goodPct ? 'var(--v2-green, #10B981)' : 'var(--v2-amber, #F59E0B)',
                  borderRadius: 999,
                  transition: 'width 220ms ease',
                }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', textAlign: 'right' }}>
                {r.won} / {r.total}
              </div>
              <div style={{
                fontFamily: 'var(--v2-display)',
                fontSize: 14, fontWeight: 700, textAlign: 'right',
                color: goodPct ? 'var(--v2-green, #10B981)' : 'var(--v2-amber, #F59E0B)',
              }}>
                {r.pct}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
