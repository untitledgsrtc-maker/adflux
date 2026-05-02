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
import {
  LayoutDashboard, FileText, CheckSquare, BarChart3, Users, Building2,
  Repeat, Gift, Settings, LogOut, Search, Bell, Plus, AlertTriangle,
  CheckCircle2, CreditCard, Send, PenLine, ArrowUpRight,
  Contact2, MapPin, Tv, FileBox,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { calculateIncentive } from '../../utils/incentiveCalc'
import { buildSettlementMap } from '../../utils/settlement'
import {
  todayISO, initials, formatRelative,
} from '../../utils/formatters'
import { thisMonth } from '../../utils/period'
import { PeriodPicker } from '../../components/v2/PeriodPicker'
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
    const today = todayISO()
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
    const todayDate = todayISO()

    const [quotesRes, paymentsAllRes, paymentsApprRes, pendingPayRes, profilesRes, msdRes, usersRes, settingsRes, dailyTargetsRes, followupsDoneTodayRes] = await Promise.all([
      // Use `*` to be tolerant of schema drift — earlier we enumerated
      // columns including `ref_number`, and a single missing column
      // would silently return an empty array (not throw), which made
      // the dashboard show all zeros even though quotes exist. The
      // dashboard touches lots of fields; safer to pull the whole row
      // and let JS pick what's needed.
      supabase.from('quotes').select('*'),
      supabase.from('payments')
        .select('id, quote_id, amount_received, is_final_payment, approval_status, rejection_reason, payment_date, created_at, recorded_by, quotes(quote_number, ref_number, client_name, sales_person_name, segment)')
        .order('created_at', { ascending: false })
        .limit(40),
      supabase.from('payments')
        .select('quote_id, amount_received, payment_date, is_final_payment')
        .eq('approval_status', 'approved'),
      supabase.from('payments')
        .select('id, quote_id, amount_received, created_at, recorded_by, quotes(quote_number, ref_number, client_name, sales_person_name, segment)')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false }),
      supabase.from('staff_incentive_profiles').select('*, users(name)').eq('is_active', true),
      supabase.from('monthly_sales_data').select('staff_id, month_year, new_client_revenue, renewal_revenue'),
      // Everyone with role='sales' — used for the leaderboard so reps with
      // zero wins still show up (and to resolve names without relying on
      // the denormalized sales_person_name column).
      supabase.from('users').select('id, name, role').eq('role', 'sales'),
      supabase.from('incentive_settings').select('*').maybeSingle(),
      // M1 — every rep's active daily target. Filtered by effective_to
      // is null (the unique partial index in supabase_phase9 ensures one
      // active row per user, so a single fetch is sufficient).
      supabase.from('daily_targets')
        .select('user_id, min_quotes, min_followups, min_calls')
        .is('effective_to', null),
      // M1 — follow-ups completed today across the whole team.
      // recorded_by isn't on follow_ups; we use assigned_to + is_done
      // + completed_at-on-today to count completions per user.
      supabase.from('follow_ups')
        .select('id, assigned_to, completed_at')
        .eq('is_done', true)
        .gte('completed_at', `${todayDate}T00:00:00`)
        .lte('completed_at', `${todayDate}T23:59:59`),
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
    const activeQuotes = quotes.filter(q => q.status !== 'lost').length

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
      const ts = q.updated_at || q.created_at || ''
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

    // Pipeline funnel
    const stages = ['draft', 'sent', 'negotiating', 'won', 'lost'].map(s => {
      const qs = quotes.filter(q => q.status === s)
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
        const ts = q.updated_at || q.created_at || ''
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
    const outstandingList = quotes
      .filter(q => q.status === 'won')
      .map(q => {
        const qPayments = paymentsApr.filter(p => p.quote_id === q.id)
        const paid = qPayments.reduce((s, p) => s + (p.amount_received || 0), 0)
        const final = qPayments.some(p => p.is_final_payment)
        const balance = (q.total_amount || 0) - paid
        return { ...q, paid, balance, final }
      })
      .filter(q => !q.final && q.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)

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
        p.recorded_by === u.id && (p.created_at || '').slice(0, 10) === todayDate
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
      kpi: { revenue, activeQuotes, pipelineValue, outstanding, pending: pending.length, liability, lostRevenue, wonValue },
      funnel: { stages, max: funnelMax },
      leaderboard, lbMax,
      liability: { total: liability, above: aboveTarget, staff: profiles.length },
      outstandingList, activeCampaigns, staleQuotes, activity, trendMonths, trendMax,
      pending,
      // M1 daily activity
      repActivity, missedReps,
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
    <div className="v2d">
      <div className="v2d-app">
        {/* ──── Sidebar ──── */}
        <aside className="v2d-side">
          <div className="v2d-brand">
            <span className="v2d-brand-mark">A</span>
            <div>
              <div className="v2d-brand-t">Adflux</div>
              <div className="v2d-brand-s">Admin</div>
            </div>
          </div>

          <nav className="v2d-nav">
            <button className={isHome ? 'is-active' : ''} onClick={() => navigate('/dashboard')}>
              <LayoutDashboard size={16} /><span>Dashboard</span>
            </button>
            <button onClick={() => navigate('/quotes')}>
              <FileText size={16} /><span>Quotes</span>
            </button>
            <button onClick={() => navigate('/clients')}>
              <Contact2 size={16} /><span>Clients</span>
            </button>
            <button onClick={() => navigate('/pending-approvals')}>
              <CheckSquare size={16} /><span>Approvals</span>
              {state.pending.length > 0 && <span className="v2d-nav-badge">{state.pending.length}</span>}
            </button>

            <div className="v2d-nav-group">Manage</div>
            <button onClick={() => navigate('/cities')}>
              <Building2 size={16} /><span>Cities</span>
            </button>
            <button onClick={() => navigate('/auto-districts')}>
              <MapPin size={16} /><span>Auto Districts</span>
            </button>
            <button onClick={() => navigate('/gsrtc-stations')}>
              <Tv size={16} /><span>GSRTC Stations</span>
            </button>
            <button onClick={() => navigate('/master')}>
              <FileBox size={16} /><span>Master</span>
            </button>
            <button onClick={() => navigate('/team')}>
              <Users size={16} /><span>Team</span>
            </button>
            <button onClick={() => navigate('/hr')}>
              <Gift size={16} /><span>HR</span>
            </button>
            <button onClick={() => navigate('/renewal-tools')}>
              <Repeat size={16} /><span>Renewal Tools</span>
            </button>
            <button onClick={() => navigate('/incentives')}>
              <BarChart3 size={16} /><span>Incentives</span>
            </button>

            <div className="v2d-nav-spacer" />
            <div className="v2d-nav-foot">
              <button onClick={() => navigate('/incentives')}>
                <Settings size={16} /><span>Settings</span>
              </button>
              <button onClick={() => signOut?.()}>
                <LogOut size={16} /><span>Log out</span>
              </button>
            </div>
          </nav>
        </aside>

        {/* ──── Main column ──── */}
        <main className="v2d-main">
          <header className="v2d-topbar">
            <div>
              <div className="v2d-crumb-kicker">{greeting()}</div>
              <div className="v2d-crumb-t">{firstName} 👋</div>
            </div>
            <div className="v2d-topbar-spacer" />
            <div className="v2d-search">
              <Search size={14} />
              <input placeholder="Search quotes, clients…" onFocus={() => navigate('/quotes')} readOnly />
            </div>
            {/* Period picker — month nav + presets + custom range.
                PeriodPicker returns a normalized period object
                (see utils/period.js). Every calc in load() reads
                startIso/endIso and monthKeys off that object. */}
            <PeriodPicker period={period} onChange={setPeriod} />

            {/* Segment filter — slices quote-derived KPIs (Pipeline,
                Won value, Outstanding, Lost, Active campaigns, Stale,
                Activity) by segment. Leaderboard / Incentive liability
                stay segment-blind because monthly_sales_data is. */}
            <div style={{ display: 'inline-flex', gap: 4, padding: 3, background: 'var(--v2-bg-2)', borderRadius: 999, border: '1px solid var(--v2-border)' }}>
              {[
                { key: 'all',        label: 'All' },
                { key: 'private',    label: 'Private' },
                { key: 'government', label: 'Govt' },
              ].map(o => (
                <button
                  key={o.key}
                  onClick={() => setSegmentFilter(o.key)}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    background: segmentFilter === o.key ? 'var(--v2-ink-0)' : 'transparent',
                    color:      segmentFilter === o.key ? 'var(--v2-bg-0)' : 'var(--v2-ink-2)',
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button className="v2d-cta" onClick={() => navigate('/quotes/new')}>
              <Plus size={14} strokeWidth={2.6} /> Create Quote
            </button>
            <button className="v2d-bell" aria-label="Notifications" onClick={() => navigate('/pending-approvals')}>
              <Bell size={14} />
              {state.pending.length > 0 && <span className="v2d-bell-dot" />}
            </button>
            <div className="v2d-me">
              <div className="v2d-me-av">{initials(profile?.name || 'Admin')}</div>
              <div>
                <div className="v2d-me-name">{profile?.name || 'Admin'}</div>
                <div className="v2d-me-role">Admin</div>
              </div>
            </div>
          </header>

          <div className="v2d-content">
            {/* M1 — Missed-targets banner. Shown only when at least one
                rep is currently below their daily quota. Lists names so
                admin can see who to ping (or who to walk over to).
                When all reps are on track, banner disappears entirely. */}
            {state.missedReps && state.missedReps.length > 0 && (
              <section
                className="v2d-banner"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: 'rgba(229, 57, 53, 0.08)',
                  border: '1px solid rgba(229, 57, 53, 0.25)',
                  borderRadius: 12,
                  marginBottom: 16,
                }}
              >
                <AlertTriangle size={18} style={{ color: '#ef9a9a', flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {state.missedReps.length} rep{state.missedReps.length === 1 ? '' : 's'} below today's target
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.6))' }}>
                    {state.missedReps.map(r => r.name).join(' · ')}
                  </div>
                </div>
              </section>
            )}

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
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    ⚡ {state.pending.length} payment{state.pending.length > 1 ? 's' : ''} waiting on approval
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

            {/* Revenue hero — this is the number that actually matters
                every morning, so it gets the gradient slot. Incentive
                liability sits alongside because it's the natural
                counter-weight: every rupee of revenue increases what we
                owe the sales team. */}
            <section className="v2d-hero v2d-hero--action">
              <div className="v2d-hero-head">
                <div className="v2d-hero-kicker">₹ Revenue · {period.label}</div>
                <button className="v2d-banner-cta" onClick={() => navigate('/quotes')}>
                  View quotes
                </button>
              </div>
              {/* All four stats use the same number font-size (32px) so the
                  card reads as a uniform stat strip rather than a headline +
                  supporting numbers. The revenue cell keeps its description
                  below to mark it as the primary metric. Inline styles used
                  intentionally — v2d-hero-big / v2d-hero-stat-v are shared
                  across other heroes (Sales dashboard) and shouldn't shift. */}
              <div className="v2d-hero-grid v2d-hero-grid--5col">
                <div>
                  <div className="v2d-hero-stat-l">Revenue</div>
                  <div
                    className="v2d-hero-big"
                    style={{ fontSize: 28, marginBottom: 6 }}
                  >
                    <Money value={state.kpi.revenue} />
                  </div>
                  <div className="v2d-hero-sub" style={{ maxWidth: 'none' }}>
                    Approved payments collected this period.
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Won value</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.wonValue} />
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Pipeline value</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.pipelineValue} />
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Incentive liability</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.liability} />
                  </div>
                </div>
                <div className="v2d-hero-stat">
                  <div className="v2d-hero-stat-l">Lost revenue</div>
                  <div className="v2d-hero-stat-v" style={{ fontSize: 28 }}>
                    <Money value={state.kpi.lostRevenue} />
                  </div>
                </div>
              </div>
            </section>

            {/* KPI row — Revenue and Pipeline value are now in the hero
                above, so this row is trimmed to the two metrics that
                *aren't* already covered up there: Active quotes (count)
                and Outstanding (unpaid won-quote balance). The inline
                grid override forces 2-up on desktop since the base
                .v2d-kpi-row rule is repeat(4, 1fr) which would leave
                two empty gutters with only two children. */}
            <section className="v2d-kpi-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <Kpi label="Active quotes"   count={state.kpi.activeQuotes}  tone="blue" />
              <Kpi label="Outstanding"     value={state.kpi.outstanding}   tone="rose" dot={state.kpi.outstanding > 0} />
            </section>

            {/* Row 2: Revenue trend + Funnel */}
            <section className="v2d-grid-2">
              <RevenueTrendPanel months={state.trendMonths} max={state.trendMax} />
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

            {/* Row 4: Incentive liability + Stale won quotes paired.
                Both are forward-looking risk views — "what we owe" and
                "what won't collect". Stale renders conditionally; when
                missing, liability stretches full-width on its own. */}
            {state.staleQuotes && state.staleQuotes.length > 0 ? (
              <section className="v2d-grid-2">
                <LiabilityPanel data={state.liability} />
                <StalePanel rows={state.staleQuotes} onOpen={(row) => openQuote(row)} />
              </section>
            ) : (
              <section>
                <LiabilityPanel data={state.liability} />
              </section>
            )}

            {/* M1 — Per-rep daily activity strip. One row per sales
                user with today's quote count + follow-ups + payments
                + stale-quote count, each with a "missed" indicator
                when below target. Reps who missed today bubble to the
                top via the load() sort. */}
            {state.repActivity && state.repActivity.length > 0 && (
              <RepActivityPanel rows={state.repActivity} />
            )}

            {/* Row 5: Active campaigns — horizontal grid of cards needs
                the full row width to lay out without wrapping awkwardly. */}
            <ActiveCampaignsPanel rows={state.activeCampaigns} onOpen={(row) => openQuote(row)} />

            {/* Row 6: Recent activity — vertical event feed, full width
                so timestamps + descriptions don't truncate. */}
            <ActivityPanel items={state.activity} onOpen={(item) => openQuote(item)} />

            <div className="v2d-foot">
              v2 · admin · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>

          {/* Mobile bottom nav — CSS hides it above 860px */}
          <nav className="v2d-mnav" style={{ '--cols': 4 }}>
            <div className="v2d-mnav-items">
              <button className={`v2d-mnav-item ${isHome ? 'v2d-mnav-item--active' : ''}`} onClick={() => navigate('/dashboard')}>
                <LayoutDashboard size={16} /> Home
              </button>
              <button className="v2d-mnav-item" onClick={() => navigate('/pending-approvals')}>
                <CheckSquare size={16} /> Approve
                {state.pending.length > 0 && <span className="v2d-mnav-badge">{state.pending.length}</span>}
              </button>
              <button className="v2d-mnav-item" onClick={() => navigate('/quotes')}>
                <FileText size={16} /> Quotes
              </button>
              <button className="v2d-mnav-item" onClick={() => signOut?.()}>
                <LogOut size={16} /> Log out
              </button>
            </div>
          </nav>
        </main>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function Kpi({ label, value, count, tone, dot }) {
  const icon = { green: '₹', blue: '◎', amber: '⏱', rose: '!' }[tone] || '•'
  const iconClass = tone === 'green' ? 'v2d-kpi-ic--green'
                  : tone === 'blue'  ? 'v2d-kpi-ic--blue'
                  : tone === 'amber' ? 'v2d-kpi-ic--amber' : 'v2d-kpi-ic--rose'
  return (
    <div className="v2d-kpi">
      <div className="v2d-kpi-head">
        <div className={`v2d-kpi-ic ${iconClass}`}>{icon}</div>
        <div className="v2d-kpi-l">{label}</div>
      </div>
      <div className="v2d-kpi-v">
        {value !== undefined ? <Money value={value} /> : (count ?? 0)}
      </div>
      {dot && <div className="v2d-kpi-delta"><span className="up">●</span> needs attention</div>}
    </div>
  )
}

function RevenueTrendPanel({ months, max }) {
  return (
    <div className="v2d-panel">
      <div className="v2d-panel-h">
        <div>
          <div className="v2d-panel-t">Revenue trend · last 6 months</div>
          <div className="v2d-panel-s">Approved payments per month</div>
        </div>
      </div>
      <div className="v2d-bars">
        {months.map((m, i) => {
          const h = Math.max(6, Math.round((m.value / max) * 170))
          const isCurrent = i === months.length - 1
          return (
            <div key={m.key} className="v2d-bar-col">
              <div className={`v2d-bar ${isCurrent ? 'is-current' : ''}`} style={{ height: h }}>
                <div className="v2d-bar-v"><Money value={m.value} /></div>
              </div>
              <div className="v2d-bar-m">{m.label}</div>
            </div>
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
        {stages.map(s => (
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
                <div className="v2d-lb-name">
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
  const today = todayISO()
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
                }}>
                  {value} / {target}{hit && ' ✓'}
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
      won:         'Quote marked Won 🎉',
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
