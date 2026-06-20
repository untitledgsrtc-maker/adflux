// src/pages/v2/TeamDashboardV2.jsx
//
// Phase 16 commit 7 — Team Dashboard, ported from
// _design_reference/Leads/lead-voice.jsx (AdminTeamDash).
// Route: /team-dashboard. Privileged users only (admin/co_owner/sales_manager).
//
// Layout (matches design):
//   • Hero strip — purple gradient (Field Activity · Live)
//     5 KPIs: Reps active / Calls today / Voice logs / New leads / Pipeline added
//   • Rep grid — 3 cards per row at desktop, each card shows rep avatar,
//     name + role, live status pill, 3 KPIs (meetings/calls/voice),
//     progress bar (call target %), foot row with city + ₹ won today
//   • Live voice feed — Phase 2 placeholder
//
// Real-data wiring:
//   • Reps from users table where team_role IN sales/agency/sales_manager
//     AND is_active=true
//   • Live status from work_sessions check_in_at today
//   • Per-rep counters from work_sessions.daily_counters today
//   • Calls from call_logs count grouped by user_id today
//   • Won today value from quotes status='won' + payments today (rough)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isSystemClose } from '../../utils/followups'
import { useNavigate } from 'react-router-dom'
import { Users as UsersIcon, MapPin, Mic, Loader2 } from 'lucide-react'
import { Loader } from '@googlemaps/js-api-loader'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { LeadAvatar, Pill } from '../../components/leads/LeadShared'
import { formatCurrency } from '../../utils/formatters'
// Phase 82 — date filter + per-rep follow-up/quote/payment KPIs.
import { PeriodPicker } from '../../components/v2/PeriodPicker'
import AdminPushModal from '../../components/v2/AdminPushModal'
import { presetToday, thisMonth } from '../../utils/period'

// Phase 87.6 — avatar marker helpers. Owner directive 24 May 2026:
// reference Pimpri-Chinchwad map pin with profile pic. Renders the
// rep's profile_image_url inside a coloured ring (freshness band),
// falls back to brand-yellow initials when no pic.
const AVATAR_MARKER_SIZE = 52

function drawInitialsOnCanvas(ctx, name, size) {
  ctx.fillStyle = '#FFE600'
  ctx.fillRect(5, 5, size - 10, size - 10)
  ctx.fillStyle = '#0f172a'
  ctx.font = '700 18px "DM Sans", "Inter", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const initials = (name || 'U')
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  ctx.fillText(initials, size / 2, size / 2 + 1)
}

function buildAvatarMarkerIcon(google, name, profileUrl, color, imageCache) {
  const SIZE = AVATAR_MARKER_SIZE
  const cv = document.createElement('canvas')
  // 2x for hidpi crispness.
  cv.width = SIZE * 2
  cv.height = SIZE * 2
  const ctx = cv.getContext('2d')
  ctx.scale(2, 2)

  // Outer coloured ring = freshness band (green / amber / red).
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  // Thin white separator between ring and avatar (matches reference).
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  // Clip inner circle for avatar / initials.
  ctx.save()
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 7, 0, Math.PI * 2)
  ctx.clip()

  const img = profileUrl ? imageCache[profileUrl] : null
  if (img && img.complete && img.naturalWidth) {
    try {
      ctx.drawImage(img, 7, 7, SIZE - 14, SIZE - 14)
    } catch {
      // CORS-tainted canvas; fall back to initials.
      drawInitialsOnCanvas(ctx, name, SIZE)
    }
  } else {
    drawInitialsOnCanvas(ctx, name, SIZE)
  }
  ctx.restore()

  let url
  try {
    url = cv.toDataURL('image/png')
  } catch {
    // Canvas tainted — rebuild initials-only (clean) and retry.
    const cv2 = document.createElement('canvas')
    cv2.width = SIZE * 2
    cv2.height = SIZE * 2
    const ctx2 = cv2.getContext('2d')
    ctx2.scale(2, 2)
    ctx2.beginPath()
    ctx2.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2)
    ctx2.fillStyle = color
    ctx2.fill()
    ctx2.beginPath()
    ctx2.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 5, 0, Math.PI * 2)
    ctx2.fillStyle = '#ffffff'
    ctx2.fill()
    ctx2.save()
    ctx2.beginPath()
    ctx2.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 7, 0, Math.PI * 2)
    ctx2.clip()
    drawInitialsOnCanvas(ctx2, name, SIZE)
    ctx2.restore()
    url = cv2.toDataURL('image/png')
  }
  return {
    url,
    scaledSize: new google.maps.Size(SIZE, SIZE),
    anchor: new google.maps.Point(SIZE / 2, SIZE / 2),
  }
}

export default function TeamDashboardV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  // Phase 61 (19 May 2026) — Bug 2 fix. Prior gate checked
  // `profile.role IN ('admin','co_owner','sales_manager')` but
  // `sales_manager` is a `team_role` value, not a `role` value.
  // Jubin (role='sales' + team_role='sales_manager') and Renuka
  // (role='telecaller' + team_role='sales_manager') were both
  // BLOCKED from a page they're supposed to access. Now accepts
  // either signal.
  const isPrivileged =
    ['admin', 'co_owner'].includes(profile?.role)
    || profile?.team_role === 'sales_manager'

  const [reps, setReps] = useState([])
  const [sessions, setSessions] = useState([])
  // Phase 103.E — admin compose-push target ({ id, name }) or null.
  // Set by clicking a rep card's Push pill; opens AdminPushModal.
  const [pushTarget, setPushTarget] = useState(null)
  // Phase 83 — split calls KPI into total + connected. owner caught
  // Rima showing 336 calls on /team-dashboard (Phase 82): that was
  // the raw call_logs row count — every tel-tap, including no-answer
  // rows from Phase 54 F2 audit defaults. The X/target ratio should
  // only count CONNECTED (outcome='connected'). Total stays visible
  // as a smaller secondary number.
  const [callsByUser, setCallsByUser] = useState({})           // total per rep (any outcome)
  const [connectedByUser, setConnectedByUser] = useState({})   // outcome='connected' per rep
  // Phase 31E — owner reported (9 May 2026) Voice Logs hero stat showed
  // "0 · counts coming · live". The voice_logs table has been live
  // since Phase 20 — placeholder copy was just stale. Wire actual
  // counts the same way callsByUser is wired.
  const [voiceByUser, setVoiceByUser] = useState({})
  // Phase 34U — latest GPS ping per rep (today only). Used to show
  // "📍 last seen N min ago" on each rep card instead of just the
  // static profile city. Owner reported the static city read as
  // "live location not fetched in dashboard".
  const [latestPingByUser, setLatestPingByUser] = useState({})
  // Phase 73 — per-rep daily_targets row (Phase 49 table). Maps
  // user_id → { min_calls, min_qualified_weekly }.
  const [policyByUser, setPolicyByUser] = useState({})
  // Phase 62.9 (20 May 2026) — owner directive: show GPS / Internet /
  // Push status pills per rep card, color-coded red when OFF, so
  // admin can spot any rep with a broken signal at-a-glance.
  // pushByUser maps user_id → {has_sub, last_seen_at}.
  const [pushByUser, setPushByUser] = useState({})
  // Phase 102.H.2 (2026-05-29) — gpsOffByUser maps user_id → true
  // when the rep's phone reported an OPEN gps_off_events row
  // (toggled_on_at IS NULL). Used to flip the GPS pill to OFF
  // immediately when the phone reports Location toggled off,
  // bypassing the ping-freshness threshold (which only sees stale
  // last-ping, not real-time off state).
  const [gpsOffByUser, setGpsOffByUser] = useState({})

  // Phase 102.J (2026-05-29) — extracted gpsOff loader so the realtime
  // subscription (below) can refetch on every gps_off_events change
  // without re-running the whole page-load effect.
  const loadGpsOff = useCallback(async () => {
    try {
      const { data: gpsRows } = await supabase
        .from('gps_off_events')
        .select('user_id, toggled_off_at')
        .is('toggled_on_at', null)
      // Phase 102.L (2026-05-31) — store the LATEST open off-event
      // timestamp per user (not a bare boolean). The pill compares it
      // against the last ping: a ping NEWER than the off-event proves
      // GPS came back, so the unclosed row is stale (close event leaked
      // when app was backgrounded). Confirmed live: Dixita had 3 open
      // rows from 23 May while pinging 31 May — the boolean veto kept
      // her pill red for 8 days.
      const gm = {}
      ;(gpsRows || []).forEach((r) => {
        const t = new Date(r.toggled_off_at).getTime()
        if (!gm[r.user_id] || t > gm[r.user_id]) gm[r.user_id] = t
      })
      setGpsOffByUser(gm)
    } catch (e) {
      console.warn('[team-dashboard] gps_off load failed:', e?.message || e)
    }
  }, [])
  // Phase 70.2 (22 May 2026) — live admin map. mapRef holds the
  // Leaflet instance; markersRef indexes Leaflet circle markers by
  // user_id so Realtime INSERT events can move existing markers
  // instead of re-rendering all.
  const mapContainerRef = useRef(null)
  const mapRef          = useRef(null)
  const markersRef      = useRef({})
  // Phase 87.6 — cache of pre-loaded HTMLImageElements keyed by
  // profile_image_url so canvas drawImage doesn't async-block the
  // marker effect. iconBump bumps when a new image finishes loading
  // to force the marker effect to re-run with the now-cached image.
  const imageCacheRef   = useRef({})
  const [iconBump, setIconBump] = useState(0)
  // Phase 89.1 — lead pins on the live field map. Activities with
  // GPS coords during the period window (meeting / site_visit)
  // surface as blue pins so admin sees where the team actually went
  // even on quiet days with zero rep pings. Owner directive 23 May
  // 2026: "i want pin lead and person whne they are in field".
  const [leadActivitiesGeo, setLeadActivitiesGeo] = useState([])
  const leadMarkersRef = useRef({})
  const [newLeadsToday, setNewLeadsToday] = useState(0)
  const [pipelineToday, setPipelineToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Phase 82 — date filter. Initially today; PeriodPicker can flip
  // to any month / quick preset / custom range. All KPIs honour
  // this window (calls / voice / new leads / pipeline + the new
  // follow-up / quote-chase / payment-chase counts).
  const [period, setPeriod] = useState(() => presetToday())
  // Phase 82 — new per-rep maps:
  //   followUpsByUser    {user_id: {pending, done}}
  //   quoteChaseByUser   {user_id: count of status='sent' quotes
  //                         created_by rep AND updated >3d ago}
  //   paymentChaseByUser {user_id: count of status='won' quotes
  //                         created_by rep with balance > 0}
  const [followUpsByUser,    setFollowUpsByUser]    = useState({})
  const [quoteChaseByUser,   setQuoteChaseByUser]   = useState({})
  const [paymentChaseByUser, setPaymentChaseByUser] = useState({})
  // Phase 93.4 (24 May 2026) — owner: "telecaller blank box put
  // overdue past followup". TCs don't deal with quotes/payments, so
  // the Quote Chase + Pay Chase tiles render 0 for them. Replace
  // those with a meaningful metric: count of follow_ups whose
  // follow_up_date is in the past AND not done.
  const [overdueFuByUser,    setOverdueFuByUser]    = useState({})
  // Phase 112.3 (2026-06-04) — telecaller-card fill: positive-outcome
  // calls today + open callbacks due in the next 2 days. Shown only on
  // TC cards (fill the 2 cells freed by hiding Meet + Quote/Pay-chase).
  const [qualifiedByUser,    setQualifiedByUser]    = useState({})
  const [callbacksDueByUser, setCallbacksDueByUser] = useState({})
  // Phase 112.5 (2026-06-04) — per-rep monthly quote production, this
  // CALENDAR month (independent of the date filter above). Owner wants
  // "total quote this month / won this month" visible per employee.
  const [monthQuotesByUser,  setMonthQuotesByUser]  = useState({})
  const [monthWonByUser,     setMonthWonByUser]     = useState({})
  // Phase 112.7 — ₹ value alongside the counts, for the header capsules.
  const [monthQuoteAmtByUser, setMonthQuoteAmtByUser] = useState({})
  const [monthWonAmtByUser,   setMonthWonAmtByUser]   = useState({})
  // Phase 89.10 — flag that flips true once the Google Map mounts.
  // Marker render effects depend on mapRef.current + map.__google
  // both being non-null; refs don't trigger React re-runs, so
  // without this flag the marker effect can fire BEFORE map is
  // ready, return early, and then never re-run because
  // leadActivitiesGeo + reps already settled. Owner reported pins
  // never appearing on /team-dashboard despite live data showing
  // 7 GPS-tagged meetings in the query response.
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    if (!isPrivileged) return
    async function load() {
      setLoading(true); setError('')
      // Phase 82 — query window comes from PeriodPicker. Default
      // `presetToday()` ⇒ startIso = today, endIso = tomorrow
      // (exclusive). The legacy variables below are kept so the rest
      // of the function reads the same as before.
      const startOfDay = `${period.startIso}T00:00:00`
      const endOfDay   = `${period.endIso}T00:00:00`
      // work_sessions row is per-date; for multi-day ranges fall
      // back to the period start (admin can still see the day card).
      // Single-day periods (today/yesterday) work identically to
      // the pre-Phase-82 code path.
      const today = period.startIso
      // Phase 128.2 — callbacks-due overdue floor (-7d), matching the TC
      // page's own window so admin + TC read the same number.
      const cbFloor = (() => {
        const d = new Date(`${today}T00:00:00`)
        d.setDate(d.getDate() - 7)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()
      // Phase 112.5 — current calendar month window for the per-rep
      // "quotes this month / won this month" line. Independent of the
      // date filter (always the live month).
      const monthStartIso = thisMonth().startIso
      const monthEndIso   = thisMonth().endIso

      const [repsRes, sesRes, callsRes, newLeadsRes, pipelineRes, voiceRes, pingsRes, policyRes, fuRes, quoteSentRes, quoteWonRes, paymentsRes, overdueFuRes, actGeoRes, qualifiedRes, callbacksRes, monthQuotesRes, monthWonRes] = await Promise.all([
        // Phase 32F — agency excluded from Team Live grid. Owner spec
        // (10 May 2026): agency = external commission partner, not
        // an employee. They don't have GPS / attendance / morning
        // plan, so Team Live (a 'where are my reps right now' view)
        // doesn't apply. Reps shown here are the in-house field team.
        // Phase 56-fix (19 May 2026): added 'telecaller' to the
        // team_role filter. TC also pings GPS, logs calls, and
        // counts against daily targets — owner reported Dhara not
        // appearing in /team-dashboard despite live pings + 26 calls.
        supabase.from('users')
          .select('id, name, team_role, city, daily_targets, is_active, profile_image_url')
          .in('team_role', ['sales', 'sales_manager', 'telecaller'])
          .eq('is_active', true)
          .order('name'),
        supabase.from('work_sessions')
          // Phase 93.23 (26 May 2026) — added check_out_at +
          // auto_checked_out + check_out_source. Without these the
          // status logic at line ~1066 always read undefined and
          // fell through to 'in field' regardless of whether the
          // rep was checked out (Phase 92c auto_cron at 20:00 IST
          // stamped check_out_at correctly; dashboard never saw it).
          .select('user_id, check_in_at, check_out_at, auto_checked_out, check_out_source, daily_counters')
          .eq('work_date', today),
        // Phase 83 — fetch outcome so we can split TOTAL vs
        // CONNECTED per rep. Outcome enum: 'connected', 'no_answer',
        // 'busy', 'wrong_number', 'callback_requested',
        // 'not_interested', 'sales_ready', 'already_client'. Anything
        // other than 'connected' means no human conversation, so the
        // KPI ratio uses connected-only.
        // Phase 76.2.2 (2026-05-23) — owner directive: only count
        // calls with duration_seconds >= 10 toward the daily KPI.
        // Excludes misdials / ringing-hangups / immediate-cuts so the
        // /team-dashboard per-rep count matches what the rep sees on
        // their own /telecaller or /work hero. NULL durations also
        // excluded (Postgres .gte semantics) until Phase 65 60-second
        // auto-patch fills the field.
        // Phase 93.1 — also exclude direction='missed' so the count
        // matches GpsTrack's "qualified" bucket. Missed-inbound rows
        // are not outbound qualified calls; previous query counted any
        // duration_seconds≥10 regardless of direction and overstated
        // by the count of missed-inbound rows whose duration somehow
        // landed ≥10 (legacy patch paths). Use .or() so legacy rows
        // with direction=NULL (pre-Phase-56l) still count.
        // Phase 93.24 (26 May 2026) — owner: "we count all calles in
        // teleicaller and field sales but actuall it shudl be lead
        // calles only. ex. nikhil has done 0 calles to client but its
        // showing 46 calls". callHistoryIngest writes EVERY native
        // outgoing call to call_logs, with lead_id NULL when the
        // phone doesn't match any lead. Filter to lead-tied calls
        // only so the KPI reflects sales activity, not personal calls.
        supabase.from('call_logs')
          .select('user_id, outcome')
          .gte('call_at', startOfDay)
          .lt ('call_at', endOfDay)
          .gte('duration_seconds', 10)
          .or('direction.is.null,direction.neq.missed')
          .not('lead_id', 'is', null),
        supabase.from('leads')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startOfDay)
          .lt ('created_at', endOfDay),
        // Phase 18 — only count won quotes for "pipeline added today",
        // not every quote created. Drafts/sent/lost shouldn't inflate the
        // headline number. Owner saw ₹2.7Cr because every quote created
        // today was being summed regardless of status.
        supabase.from('quotes')
          .select('total_amount, status')
          .eq('status', 'won')
          .gte('created_at', startOfDay)
          .lt ('created_at', endOfDay),
        // Phase 31E — voice_logs counted per rep for today.
        supabase.from('voice_logs')
          .select('user_id')
          .gte('created_at', startOfDay)
          .lt ('created_at', endOfDay),
        // Phase 34U — pull every GPS ping captured today; we'll pick
        // the latest per user client-side.
        supabase.from('gps_pings')
          .select('user_id, lat, lng, captured_at, accuracy_m')
          .gte('captured_at', startOfDay)
          .lt ('captured_at', endOfDay)
          .order('captured_at', { ascending: false }),
        // Phase 73 — daily_targets row per user (active).
        supabase.from('daily_targets')
          .select('user_id, min_calls, min_qualified_weekly')
          .is('effective_to', null),

        // Phase 82 — follow_ups grouped client-side by assigned_to into
        // pending + done counts. Owner: "daily followup / done".
        // Phase 128.2 (TC truth pass) — axis swap to match the evening
        // report: DONE = closed in the window (done_at, any due-date) so
        // clearing overdue items finally shows as today's work; PENDING =
        // still-open rows dated in the window. Old shape counted rows
        // merely DATED in the window (a row done last week inflated done;
        // 10 overdue cleared today showed nothing).
        // Phase 133 — also pull done_note so the DONE count excludes
        // system auto-closes (heals, cadence cancels, payment auto-close).
        // A one-time heal stamps done_at=now() on backlog rows; without
        // this they inflate "Today F-up done" (Rima read 241 — ~142 of
        // them were the Phase 131 cleanup, not her work).
        supabase.from('follow_ups')
          .select('assigned_to, is_done, follow_up_date, done_at, done_note')
          .or(`and(is_done.eq.true,done_at.gte.${startOfDay},done_at.lt.${endOfDay}),and(is_done.eq.false,follow_up_date.gte.${period.startIso},follow_up_date.lt.${period.endIso})`),
        // Phase 82 — quote-chase: status='sent' quotes whose latest
        // touch is stale. Owner: "daily quote followup". Fetched as
        // a broad list; we filter client-side to status='sent' AND
        // updated_at > 3d ago. (DB has no last_chase_at column.)
        supabase.from('quotes')
          .select('id, created_by, status, updated_at, total_amount')
          .eq('status', 'sent'),
        // Phase 82 — payment-chase: status='won' quotes. Joined to
        // payments client-side to compute (total_amount − received)
        // and count rows where balance > 0. Owner: "daily payment
        // follow up".
        supabase.from('quotes')
          .select('id, created_by, status, total_amount')
          .eq('status', 'won'),
        // Phase 82 — sum approved payments per quote_id. Joins
        // with the won-quotes list above to produce per-rep
        // unsettled-quote counts.
        supabase.from('payments')
          .select('quote_id, amount_received, approval_status'),
        // Phase 93.4 — overdue follow-ups (not gated by period filter;
        // overdue is always-now). Pulled separately from fuRes which
        // is window-gated. Pending only.
        supabase.from('follow_ups')
          .select('assigned_to')
          .lt('follow_up_date', today)
          .eq('is_done', false),

        // Phase 89.1 + 89.6 + 89.8 + 89.9 — geo-tagged meeting /
        // site_visit activities as permanent pins on the live
        // field map. Owner directive 23 May 2026.
        //
        // Phase 89.9 — removed server-side .not('gps_lat','is',null)
        // because PostgREST IS-NULL filters were yielding zero
        // rows in production despite GpsTrackV2 (which doesn't
        // filter on null) returning matching activities. Cause is
        // probably a supabase-js serialization quirk on the
        // (col, 'is', null) negation. Move the null check to the
        // client-side .filter() instead — same result, no risk
        // of misencoding.
        //
        // FK embed `lead:lead_id(...)` may resolve null on RLS
        // edge cases — handled client-side via optional chaining
        // in the row transform.
        supabase.from('lead_activities')
          .select('id, created_at, created_by, activity_type, outcome, gps_lat, gps_lng, lead:lead_id(id, name, company)')
          .in('activity_type', ['meeting', 'site_visit'])
          .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(500),

        // Phase 112.3 — TC "Qualified today": positive-outcome calls in
        // the period, grouped client-side by created_by. Read only on
        // TC cards.
        supabase.from('lead_activities')
          .select('created_by')
          .eq('activity_type', 'call')
          .eq('outcome', 'positive')
          .gte('created_at', startOfDay)
          .lt ('created_at', endOfDay),
        // Phase 112.3 + 113.6 — TC "Callbacks due": open callbacks that are
        // actually DUE — follow_up_date <= today (today + overdue), NOT a
        // forward window. The old today..today+2 window counted TOMORROW's
        // callbacks as "due", which massively inflated it (Rima: 101 of 104
        // were scheduled for tomorrow; real due-today was 3). Grouped by
        // assigned_to, counted DISTINCT lead (Phase 113.5). Read only on TC.
        // Phase 128.2 — -7d floor so the count matches the TC page's own
        // overdue window (one definition both sides; ancient overdue rows
        // are a data-hygiene problem, not "due now").
        supabase.from('follow_ups')
          .select('assigned_to, lead_id, id')
          .eq('is_done', false)
          .gte('follow_up_date', cbFloor)
          .lte('follow_up_date', today),

        // Phase 112.5/.7 — quotes CREATED this calendar month, per
        // created_by (count + total value).
        supabase.from('quotes')
          .select('created_by, total_amount')
          .gte('created_at', monthStartIso)
          .lt ('created_at', monthEndIso),
        // Phase 112.5/.7 — quotes WON this calendar month, per created_by
        // (count + value). won-date proxied by updated_at (no won_at, §33).
        supabase.from('quotes')
          .select('created_by, total_amount')
          .eq('status', 'won')
          .gte('updated_at', monthStartIso)
          .lt ('updated_at', monthEndIso),
      ])
      if (repsRes.error || sesRes.error) {
        setError(repsRes.error?.message || sesRes.error?.message || 'Load failed')
      }
      setReps(repsRes.data || [])
      setSessions(sesRes.data || [])
      // Build calls-by-user map. Phase 83 — split total + connected.
      const byUser = {}
      const connByUser = {}
      ;(callsRes.data || []).forEach(r => {
        if (!r.user_id) return
        byUser[r.user_id] = (byUser[r.user_id] || 0) + 1
        if (r.outcome === 'connected') {
          connByUser[r.user_id] = (connByUser[r.user_id] || 0) + 1
        }
      })
      setCallsByUser(byUser)
      setConnectedByUser(connByUser)
      // Phase 31E — same shape as callsByUser: row-per-log, count by user_id.
      const voiceMap = {}
      ;(voiceRes.data || []).forEach(r => {
        if (!r.user_id) return
        voiceMap[r.user_id] = (voiceMap[r.user_id] || 0) + 1
      })
      setVoiceByUser(voiceMap)
      // Phase 34U — pick the latest ping per rep (rows already
      // ordered desc by captured_at, so the FIRST ping seen wins).
      const pingMap = {}
      ;(pingsRes.data || []).forEach((p) => {
        if (!p.user_id) return
        if (!pingMap[p.user_id]) pingMap[p.user_id] = p
      })
      setLatestPingByUser(pingMap)
      // Phase 73 — index policy rows by user_id for O(1) lookup per
      // rep card. Defaults absorbed at the render site (50 for TC,
      // 20 for sales).
      const polMap = {}
      ;(policyRes?.data || []).forEach((p) => {
        if (p.user_id) polMap[p.user_id] = p
      })
      setPolicyByUser(polMap)
      setNewLeadsToday(newLeadsRes.count || 0)
      setPipelineToday((pipelineRes.data || []).reduce((s, q) => s + (Number(q.total_amount) || 0), 0))

      // Phase 82 — tally follow-ups per assigned_to in this window.
      //   pending = is_done=false
      //   done    = is_done=true (regardless of done_at; the
      //             period filter already constrained follow_up_date
      //             to the window so all rows here belong to it)
      // Phase 133 — a row closed by a SYSTEM auto-close (heal, cadence
      // cancel, pause-close, payment auto-close) is not rep work. Its
      // done_note carries the marker; exclude it from the DONE count so
      // "Today F-up done" = follow-ups the rep actually closed.
      const fuMap = {}
      ;(fuRes.data || []).forEach((r) => {
        if (!r.assigned_to) return
        const e = fuMap[r.assigned_to] || { pending: 0, done: 0 }
        if (r.is_done) { if (!isSystemClose(r.done_note)) e.done += 1 }
        else           e.pending += 1
        fuMap[r.assigned_to] = e
      })
      setFollowUpsByUser(fuMap)

      // Phase 82 — quote-chase: status='sent' quotes whose latest
      // updated_at is older than 3 days from period.endIso. These
      // are the "you sent it, nobody chased — go follow up" quotes.
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000
      const cutoff      = new Date(period.endIso).getTime() - threeDaysMs
      const qcMap = {}
      ;(quoteSentRes.data || []).forEach((q) => {
        if (!q.created_by) return
        const stamp = q.updated_at ? new Date(q.updated_at).getTime() : 0
        if (stamp > 0 && stamp < cutoff) {
          qcMap[q.created_by] = (qcMap[q.created_by] || 0) + 1
        }
      })
      setQuoteChaseByUser(qcMap)

      // Phase 82 — payment-chase: status='won' quotes whose summed
      // approved payments < total_amount. Index payments by
      // quote_id, then iterate won quotes counting unsettled ones
      // per created_by.
      const paidByQuote = {}
      ;(paymentsRes.data || []).forEach((p) => {
        if (!p.quote_id) return
        if (p.approval_status && p.approval_status !== 'approved') return
        paidByQuote[p.quote_id] = (paidByQuote[p.quote_id] || 0) + (Number(p.amount_received) || 0)
      })
      const pcMap = {}
      ;(quoteWonRes.data || []).forEach((q) => {
        if (!q.created_by) return
        const total = Number(q.total_amount) || 0
        const paid  = paidByQuote[q.id] || 0
        if (total > 0 && paid < total) {
          pcMap[q.created_by] = (pcMap[q.created_by] || 0) + 1
        }
      })
      setPaymentChaseByUser(pcMap)

      // Phase 93.4 — overdue follow-ups (per assigned_to). Used to
      // replace empty Quote Chase tile for TC reps.
      const odMap = {}
      ;(overdueFuRes?.data || []).forEach((r) => {
        if (!r.assigned_to) return
        odMap[r.assigned_to] = (odMap[r.assigned_to] || 0) + 1
      })
      setOverdueFuByUser(odMap)

      // Phase 112.3 — TC qualified (positive calls today) per created_by.
      const qualMap = {}
      ;(qualifiedRes?.data || []).forEach((a) => {
        if (!a.created_by) return
        qualMap[a.created_by] = (qualMap[a.created_by] || 0) + 1
      })
      setQualifiedByUser(qualMap)

      // Phase 112.3 — TC callbacks due (open follow_ups next 2 days) per
      // assigned_to.
      // Phase 113.5 — count DISTINCT lead per rep, not raw follow_up rows.
      // One lead can stack many open callbacks (every "call back later"
      // spawns a fresh follow_up without closing the old one), so counting
      // rows inflated the number badly (Rima showed 95). One lead = one
      // callback due.
      const cbSets = {}
      ;(callbacksRes?.data || []).forEach((r) => {
        if (!r.assigned_to) return
        if (!cbSets[r.assigned_to]) cbSets[r.assigned_to] = new Set()
        cbSets[r.assigned_to].add(r.lead_id || r.id)
      })
      const cbMap = {}
      Object.keys(cbSets).forEach((k) => { cbMap[k] = cbSets[k].size })
      setCallbacksDueByUser(cbMap)

      // Phase 112.5/.7 — per-rep monthly quote count + ₹ value.
      const mqMap = {}, mqAmt = {}
      ;(monthQuotesRes?.data || []).forEach((q) => {
        if (!q.created_by) return
        mqMap[q.created_by] = (mqMap[q.created_by] || 0) + 1
        mqAmt[q.created_by] = (mqAmt[q.created_by] || 0) + (Number(q.total_amount) || 0)
      })
      setMonthQuotesByUser(mqMap)
      setMonthQuoteAmtByUser(mqAmt)

      const mwMap = {}, mwAmt = {}
      ;(monthWonRes?.data || []).forEach((q) => {
        if (!q.created_by) return
        mwMap[q.created_by] = (mwMap[q.created_by] || 0) + 1
        mwAmt[q.created_by] = (mwAmt[q.created_by] || 0) + (Number(q.total_amount) || 0)
      })
      setMonthWonByUser(mwMap)
      setMonthWonAmtByUser(mwAmt)

      // Phase 62.9 — load push subscriptions per rep. Used to render
      // the "Push on/off" + "Online" status pills below the KPI row.
      // Last-seen-at acts as a proxy for whether the device has been
      // reachable recently (3h+ stale = treat as offline).
      try {
        const { data: pushRows } = await supabase
          .from('push_subscriptions')
          .select('user_id, last_seen_at')
          .order('last_seen_at', { ascending: false })
        const pm = {}
        ;(pushRows || []).forEach((r) => {
          // Keep the freshest row per user.
          if (!pm[r.user_id]) {
            pm[r.user_id] = { has_sub: true, last_seen_at: r.last_seen_at }
          }
        })
        setPushByUser(pm)
      } catch (e) {
        // Defensive — RLS hiccup shouldn't break the page render.
        console.warn('[team-dashboard] push load failed:', e?.message || e)
      }

      // Phase 102.H.2 (2026-05-29) — load OPEN gps_off_events per rep.
      // Rep's APK shim writes a row when phone Location toggles off
      // (or on foreground probe at app launch via Phase 102.H.1) and
      // closes it (sets toggled_on_at) when Location toggles back on.
      // An open row = phone is currently reporting GPS OFF. Used to
      // override the ping-freshness GPS pill below.
      // Phase 102.J — body extracted to loadGpsOff useCallback so the
      // realtime subscription below can refetch independently.
      await loadGpsOff()

      // Phase 89.1 + 89.8 — geo-tagged lead activities populate
      // pins on the field map. Coerced to numbers + filtered to
      // drop malformed rows. Phase 89.8 — `lead` embed may be
      // null on unlinked field-walk-in meetings AND on rare RLS
      // race conditions. Don't reject those — show them as
      // generic "Field visit" pins without the Open lead link.
      // Phase 89.10 — explicit null check BEFORE Number()
      // because Number(null)===0 (not NaN), so the old isFinite
      // filter let null-GPS rows through and plotted pins at
      // (0,0). Live audit confirmed 2 of 9 returned rows had
      // null lat/lng.
      const geoRows = (actGeoRes?.data || [])
        .filter(a => a.gps_lat != null && a.gps_lng != null
                  && Number.isFinite(Number(a.gps_lat))
                  && Number.isFinite(Number(a.gps_lng)))
        .map(a => ({
          id:        a.id,
          lat:       Number(a.gps_lat),
          lng:       Number(a.gps_lng),
          created_at: a.created_at,
          created_by: a.created_by,
          activity_type: a.activity_type,
          outcome:   a.outcome,
          lead_id:   a.lead?.id || null,
          lead_name: a.lead?.name || '',
          lead_company: a.lead?.company || '',
        }))
      setLeadActivitiesGeo(geoRows)

      setLoading(false)
    }
    load()
    // Phase 82 — re-run on period change so PeriodPicker drives the
    // whole grid (calls, voice, follow-ups, chase counts, pipeline).
  }, [isPrivileged, period.startIso, period.endIso])

  // Phase 70.2 (22 May 2026) — initialize Leaflet map once + subscribe
  // to Supabase Realtime for gps_pings INSERT. Owner directive: "live
  // track admin dashboard via Supabase Realtime channel" + "rep dots
  // refresh every 5 min". With Realtime, dots actually refresh on
  // every new ping (~5-min cadence on rep side); admin sees live
  // movement as it happens. No polling required.
  //
  // Phase 70.2 fix (22 May 2026 same-day) — depend on `loading` AND
  // `isPrivileged`. The container ref doesn't attach until the
  // loading=false branch of the JSX renders. Initial run with
  // loading=true bailed (ref.current was null) and tile fetch never
  // fired. Re-runs when loading flips false so the map mounts as soon
  // as the container is in the DOM. Includes a 50ms timeout so layout
  // settles + invalidateSize after attach to force tile load.
  // Phase 70.3 (22 May 2026) — Google Maps JS API. Owner: "we paid
  // for Google Maps API, use it". Free tier 10K map loads/month
  // covers our usage. Realtime channel updates marker positions in
  // place via google.maps.Marker.setPosition(); no re-render of all
  // markers needed.
  useEffect(() => {
    if (!isPrivileged) return
    if (loading) return
    if (mapRef.current) return  // already mounted

    const MAPS_KEY = import.meta.env.VITE_GOOGLE_ROADS_KEY || ''
    if (!MAPS_KEY) return  // silent — page still works without map

    let cancelled = false
    ;(async () => {
      const loader = new Loader({
        apiKey: MAPS_KEY,
        version: 'weekly',
        // Phase 70.6.1 — geometry library must match GpsTrackV2's Loader
        // call. @googlemaps/js-api-loader is a singleton; mismatched
        // libraries on second mount throw "Loader must not be called
        // again with different options".
        libraries: ['geometry'],
      })
      const google = await loader.load()
      if (cancelled) return
      if (!mapContainerRef.current) return
      if (mapRef.current) return

      const map = new google.maps.Map(mapContainerRef.current, {
        center: { lat: 22.3072, lng: 73.1812 },  // Vadodara
        zoom: 12,
        // Phase 70.7 — lightened road palette so streets read clearly
        // against the dark canvas. Same DARK_MAP_STYLE shape used by
        // GpsTrackV2; duplicated here to avoid a cross-module import
        // from a page file.
        styles: [
          { elementType: 'geometry',            stylers: [{ color: '#1d2129' }] },
          { elementType: 'labels.text.stroke',  stylers: [{ color: '#1d2129' }] },
          { elementType: 'labels.text.fill',    stylers: [{ color: '#e2e8f0' }] },
          { featureType: 'administrative',      elementType: 'geometry', stylers: [{ color: '#334155' }] },
          { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#f1f5f9' }] },
          { featureType: 'poi',                 elementType: 'labels',   stylers: [{ visibility: 'off' }] },
          { featureType: 'road',                elementType: 'geometry', stylers: [{ color: '#64748b' }] },
          { featureType: 'road',                elementType: 'geometry.stroke', stylers: [{ color: '#475569' }] },
          { featureType: 'road',                elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }] },
          { featureType: 'road.arterial',       elementType: 'geometry', stylers: [{ color: '#94a3b8' }] },
          { featureType: 'road.highway',        elementType: 'geometry', stylers: [{ color: '#cbd5e1' }] },
          { featureType: 'road.highway',        elementType: 'geometry.stroke', stylers: [{ color: '#64748b' }] },
          { featureType: 'road.local',          elementType: 'geometry', stylers: [{ color: '#475569' }] },
          { featureType: 'transit',             elementType: 'labels',   stylers: [{ visibility: 'off' }] },
          { featureType: 'water',               elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
          { featureType: 'water',               elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
        ],
        disableDefaultUI: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
      mapRef.current = map
      // Stash google reference on map so the markers effect can use it.
      map.__google = google
      // Phase 89.10 — flip ready flag so marker effects re-run
      // now that map is mountable.
      setMapReady(true)
    })()

    return () => {
      cancelled = true
      mapRef.current = null
      markersRef.current = {}
      setMapReady(false)
    }
  }, [isPrivileged, loading])

  // Phase 87.6 — pre-load every rep's profile_image_url into an
  // HTMLImageElement cache so the marker-icon canvas can draw the
  // pic synchronously. Owner directive 24 May 2026: live field map
  // shows faces, not coloured dots. Avatars are cross-origin loaded
  // from the public user-avatars bucket; canvas needs CORS-safe
  // images to call toDataURL without tainting.
  useEffect(() => {
    const cache = imageCacheRef.current
    const urls = Array.from(new Set(
      reps.map(r => r.profile_image_url).filter(u => u && !cache[u])
    ))
    if (!urls.length) return
    let cancelled = false
    Promise.all(urls.map(url => new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.referrerPolicy = 'no-referrer'
      img.onload = () => resolve({ url, img })
      img.onerror = () => resolve({ url, img: null })
      img.src = url
    }))).then(results => {
      if (cancelled) return
      let added = 0
      results.forEach(({ url, img }) => {
        if (img && img.naturalWidth > 0) {
          cache[url] = img
          added += 1
        }
      })
      if (added > 0) setIconBump(n => n + 1)
    })
    return () => { cancelled = true }
  }, [reps])

  // Phase 70.3 + 87.6 — Render / update Google Maps markers whenever
  // latestPingByUser changes. Marker = circular profile-pic avatar
  // (Phase 87.6) inside a coloured freshness ring:
  //   green  = ping within last 5 min
  //   amber  = 5–30 min stale
  //   red    = 30+ min stale
  // Initials in brand yellow are used when no profile pic on file.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const google = map.__google
    if (!google) return
    const now = Date.now()
    const seenIds = new Set()
    const bounds = new google.maps.LatLngBounds()
    let anyPinned = false

    // Phase 103.D.3 — the live field map shows WORKING reps only:
    // checked in today AND not checked out. A signed-in-but-not-checked-
    // in rep still pings (more so since the 103.D.1 watcher re-arm made
    // pings reliable), but the map should reflect who's actually on the
    // clock — not every phone that's online.
    const checkedInIds = new Set(
      (sessions || [])
        .filter(s => s.check_in_at && !s.check_out_at && !s.auto_checked_out)
        .map(s => s.user_id)
    )

    for (const r of reps) {
      if (!checkedInIds.has(r.id)) continue
      const ping = latestPingByUser[r.id]
      if (!ping || !ping.lat || !ping.lng) continue
      const ageMs = ping.captured_at
        ? now - new Date(ping.captured_at).getTime()
        : Infinity
      const ageMin = ageMs / 60_000
      const color = ageMin <= 5 ? '#10B981'
                  : ageMin <= 30 ? '#F59E0B'
                  : '#EF4444'
      seenIds.add(r.id)
      const pos = { lat: Number(ping.lat), lng: Number(ping.lng) }
      bounds.extend(pos)
      anyPinned = true

      // Cache key avoids rebuilding the canvas every effect tick.
      // Rebuild only when the ring colour band changes OR the
      // profile pic URL changes OR a new image just finished loading.
      const iconKey = `${r.id}|${r.profile_image_url || ''}|${color}`

      const existing = markersRef.current[r.id]
      if (existing) {
        existing.setPosition(pos)
        if (existing.__iconKey !== iconKey) {
          existing.setIcon(buildAvatarMarkerIcon(
            google, r.name, r.profile_image_url, color, imageCacheRef.current,
          ))
          existing.__iconKey = iconKey
        }
        // Phase 89.5 — brand-aligned popup. Light text on dark
        // chrome (v2.css .gm-style-iw-c override) + esc()'d
        // user-supplied fields so a malicious name can't XSS the
        // admin browser (Phase 85.2 pattern carried over).
        const escStr = (v) => String(v ?? '')
          .replace(/&/g,  '&amp;')
          .replace(/</g,  '&lt;')
          .replace(/>/g,  '&gt;')
          .replace(/"/g,  '&quot;')
          .replace(/'/g,  '&#39;')
        const repPopupHtml = `<div style="font-family:'DM Sans','Inter',sans-serif;min-width:160px;">`
          + `<div style="font-weight:700;font-size:14px;color:#f5f7fb;border-bottom:2px solid #FFE600;padding-bottom:3px;display:inline-block;">${escStr(r.name)}</div>`
          + `<div style="font-size:11px;color:#98a4bf;margin-top:6px;text-transform:capitalize;">${escStr(r.team_role || '')}</div>`
          + `<div style="font-size:11px;color:#cbd5e1;margin-top:4px;">${Math.round(ageMin)} min ago</div>`
          + `</div>`
        existing.__iw?.setContent(repPopupHtml)
      } else {
        const m = new google.maps.Marker({
          position: pos,
          map,
          // Anchor at centre + slight vertical bump so the avatar
          // sits over the geo-point not above it.
          icon: buildAvatarMarkerIcon(
            google, r.name, r.profile_image_url, color, imageCacheRef.current,
          ),
          title: r.name,
        })
        m.__iconKey = iconKey
        // Phase 89.5 — same brand popup as the setContent branch.
        const escStr = (v) => String(v ?? '')
          .replace(/&/g,  '&amp;')
          .replace(/</g,  '&lt;')
          .replace(/>/g,  '&gt;')
          .replace(/"/g,  '&quot;')
          .replace(/'/g,  '&#39;')
        const repPopupHtml = `<div style="font-family:'DM Sans','Inter',sans-serif;min-width:160px;">`
          + `<div style="font-weight:700;font-size:14px;color:#f5f7fb;border-bottom:2px solid #FFE600;padding-bottom:3px;display:inline-block;">${escStr(r.name)}</div>`
          + `<div style="font-size:11px;color:#98a4bf;margin-top:6px;text-transform:capitalize;">${escStr(r.team_role || '')}</div>`
          + `<div style="font-size:11px;color:#cbd5e1;margin-top:4px;">${Math.round(ageMin)} min ago</div>`
          + `</div>`
        const iw = new google.maps.InfoWindow({
          content: repPopupHtml,
        })
        m.addListener('click', () => iw.open({ anchor: m, map }))
        m.__iw = iw
        markersRef.current[r.id] = m
      }
    }

    // Remove markers for reps with no ping today (cleanup).
    for (const uid of Object.keys(markersRef.current)) {
      if (!seenIds.has(uid)) {
        try { markersRef.current[uid].setMap(null) } catch { /* */ }
        delete markersRef.current[uid]
      }
    }

    // Fit map to all visible markers on first render only.
    if (anyPinned && !map.__teamDashboardFitDone) {
      try {
        map.fitBounds(bounds, 60)
        map.__teamDashboardFitDone = true
      } catch { /* swallow */ }
    }
  }, [latestPingByUser, reps, iconBump, mapReady, sessions])

  // Phase 89.1 — Lead pins from geo-tagged activities. Blue
  // map pins where the team met clients in the selected period.
  // InfoWindow shows company/name + rep + time + outcome chip.
  // Reuses the same map ref; separate marker dict keyed by
  // activity id so reps + leads coexist without overwriting.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const google = map.__google
    if (!google) return
    const seen = new Set()
    const repNameById = new Map(reps.map(r => [r.id, r.name]))
    // Phase 89.4 — pin colour tracks meeting outcome. Owner-locked
    // meeting outcome set is 3 states (LogMeetingModal Phase 33A):
    // positive / neutral / negative. Default blue covers rows where
    // outcome wasn't logged (legacy pre-89.4 data).
    const colorForOutcome = (o) => {
      switch (o) {
        case 'positive': return '#10B981'
        case 'neutral':  return '#F59E0B'
        case 'negative': return '#EF4444'
        default:         return '#3B82F6'
      }
    }
    // Phase 89.9 — owner directive 23 May 2026: use the teardrop
    // PIN_PATH from GpsTrackV2 (Phase 70.10 brand pin shape) so
    // Team Dashboard meeting pins look the same as the rep-day
    // map. Small circles were invisible; teardrops are tall enough
    // to read at Gujarat-wide zoom.
    const PIN_PATH = 'M 0,0 c -4.5,-7.5 -10.5,-14.25 -10.5,-19.5 a 10.5,10.5 0 1,1 21,0 c 0,5.25 -6,12 -10.5,19.5 z m 0,-26.25 a 3.75,3.75 0 1,0 0,7.5 a 3.75,3.75 0 1,0 0,-7.5 z'
    const iconFor = (o) => ({
      path:         PIN_PATH,
      fillColor:    colorForOutcome(o),
      fillOpacity:  1,
      strokeColor:  '#0f172a',
      strokeWeight: 1.5,
      scale:        1.4,
      anchor:       new google.maps.Point(0, 0),
      labelOrigin:  new google.maps.Point(0, -20),
    })
    const esc = (v) => String(v ?? '')
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;')
    for (const a of leadActivitiesGeo) {
      seen.add(a.id)
      const pos = { lat: a.lat, lng: a.lng }
      const repName = repNameById.get(a.created_by) || '—'
      const timeStr = new Date(a.created_at).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
      // Phase 89.8 — unlinked field meetings (no lead_id) show
      // as "Field visit" with no deep link.
      const heading = a.lead_company || a.lead_name || (a.lead_id ? 'Lead' : 'Field visit')
      const sub = a.lead_company && a.lead_name ? esc(a.lead_name) : ''
      const kind = a.activity_type === 'site_visit' ? 'Site visit' : 'Meeting'
      // Phase 89.5 — colour outcome pill to match pin colour band.
      const outcomeColor = a.outcome === 'positive' ? '#34d399'
                         : a.outcome === 'negative' ? '#f87171'
                         : a.outcome === 'neutral'  ? '#fbbf24'
                         : '#98a4bf'
      const outcomeBit = a.outcome
        ? ` · <span style="text-transform:capitalize;color:${outcomeColor};font-weight:700">${esc(a.outcome)}</span>`
        : ''
      // Phase 89.5 — brand palette on dark InfoWindow chrome.
      // Phase 89.8 — hide "Open lead →" link when activity is
      // unlinked (lead_id null), avoids broken /leads/ navigation.
      const html = `
        <div style="font-family:'DM Sans','Inter',sans-serif;min-width:180px;">
          <div style="font-size:9.5px;color:#98a4bf;letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">${kind} · ${timeStr}${outcomeBit}</div>
          <div style="font-weight:700;font-size:14px;color:#f5f7fb;border-bottom:2px solid #FFE600;padding-bottom:3px;display:inline-block;">${esc(heading)}</div>
          ${sub ? `<div style="font-size:11px;color:#98a4bf;margin-top:6px;">${sub}</div>` : ''}
          <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">${esc(repName)}</div>
          ${a.lead_id ? `<a href="/leads/${esc(a.lead_id)}" style="display:inline-block;margin-top:10px;font-size:11px;color:#FFE600;text-decoration:none;font-weight:700;letter-spacing:.04em;">Open lead →</a>` : ''}
        </div>
      `
      const existing = leadMarkersRef.current[a.id]
      if (existing) {
        existing.setPosition(pos)
        // Phase 89.4 — outcome may flip after the pin first rendered
        // (rep logs result later). Reset icon so the colour band
        // tracks the current outcome on every effect re-run.
        existing.setIcon(iconFor(a.outcome))
        existing.__iw?.setContent(html)
      } else {
        const m = new google.maps.Marker({
          position: pos,
          map,
          icon: iconFor(a.outcome),
          title: heading,
          zIndex: 1,  // Below rep avatar pins.
        })
        const iw = new google.maps.InfoWindow({ content: html })
        m.addListener('click', () => iw.open({ anchor: m, map }))
        m.__iw = iw
        leadMarkersRef.current[a.id] = m
      }
    }
    // Cleanup stale markers (activity removed / date changed).
    for (const id of Object.keys(leadMarkersRef.current)) {
      if (!seen.has(id)) {
        try { leadMarkersRef.current[id].setMap(null) } catch { /* */ }
        delete leadMarkersRef.current[id]
      }
    }
  }, [leadActivitiesGeo, reps, mapReady])

  // Phase 70.2 — Supabase Realtime subscription on gps_pings INSERT.
  // Updates latestPingByUser in-place so the marker effect re-runs.
  useEffect(() => {
    if (!isPrivileged) return
    const channel = supabase
      .channel('team-live-gps')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'gps_pings' },
        (payload) => {
          const p = payload?.new
          if (!p?.user_id) return
          setLatestPingByUser(prev => {
            const cur = prev[p.user_id]
            if (cur && new Date(cur.captured_at) >= new Date(p.captured_at)) {
              // older event arriving out-of-order; keep newer
              return prev
            }
            return { ...prev, [p.user_id]: p }
          })
        }
      )
      .subscribe()

    return () => {
      try { supabase.removeChannel(channel) } catch { /* */ }
    }
  }, [isPrivileged])

  // Phase 102.J (2026-05-29) — Supabase Realtime subscription on
  // gps_off_events INSERT + UPDATE. When a rep's phone toggles
  // Location, nativeTracking writes a row server-side; this channel
  // pushes to every admin browser within ~1s and refetches
  // gpsOffByUser so the GPS pill flips RED / GREEN live without a
  // page reload. SQL prerequisite (paste-once):
  //   ALTER PUBLICATION supabase_realtime ADD TABLE public.gps_off_events;
  useEffect(() => {
    if (!isPrivileged) return
    const ch = supabase
      .channel('team-gps-off-events')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gps_off_events' },
        () => { loadGpsOff() },
      )
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch { /* */ } }
  }, [isPrivileged, loadGpsOff])

  const sessionByUser = useMemo(() => {
    const m = new Map()
    sessions.forEach(s => m.set(s.user_id, s))
    return m
  }, [sessions])

  // Phase 112.2 (2026-06-04) — "Reps active now" now matches the card
  // pill rule EXACTLY: checked-in + not checked-out. The old 90-min
  // GPS-ping gate (Phase 84) was REMOVED from the card pill in Phase
  // 88.7 (owner directive: "checked in + not checked out = in field,
  // period") but left here, so the hero under-counted vs the green
  // "in field" cards (8 cards in field, hero said 3 — the 5 diff had
  // GPS off / no recent ping). GPS freshness still shows on each card's
  // GPS pill + the map ring colour; it no longer hides reps from the
  // headcount. Now `live` == number of green "in field" cards, and the
  // "X not checked-in" subtitle is finally truthful.
  const live = useMemo(() => {
    return reps.filter(r => {
      const s = sessionByUser.get(r.id)
      if (!s?.check_in_at) return false
      if (s.check_out_at || s.auto_checked_out) return false
      return true
    }).length
  }, [reps, sessionByUser])

  const totalCallsToday = useMemo(() => {
    return Object.values(callsByUser).reduce((s, n) => s + n, 0)
  }, [callsByUser])

  // Phase 31E — total voice logs across the team, today.

  if (!isPrivileged) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          Team Dashboard is admin / sales-manager only.
        </div>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Loading team dashboard…</div>
        </div>
      </div>
    )
  }

  const niceTime = new Date().toLocaleString('en-IN', {
    weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <div className="lead-root">
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">
            Field force · {reps.length} active reps · live
          </div>
          <div className="lead-page-title">Team Dashboard</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Phase 82 — date filter at top of /team-dashboard. All
              KPIs (calls, voice, new leads, pipeline, follow-ups,
              quote-chase, payment-chase) reload when this changes. */}
          <PeriodPicker period={period} onChange={setPeriod} />
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/leads')}>
            <UsersIcon size={14} /> Reassign queue
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13,
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Hero strip — purple gradient (overriding the default teal) */}
      <div
        className="lead-hero-strip"
        style={{
          background: 'radial-gradient(700px 220px at 100% 0%, rgba(192,132,252,.22), transparent 60%), linear-gradient(120deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)',
          borderColor: '#4338ca',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>
            <span className="lead-live-dot" />&nbsp;&nbsp;Field activity · live
          </div>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{niceTime} IST</span>
        </div>
        <div className="lead-hero-stats">
          <HeroStat label="Reps active now"   value={`${live} / ${reps.length}`}   delta={`${reps.length - live} not checked-in`} down={live < reps.length} />
          <HeroStat label="Calls today"       value={totalCallsToday}             delta="from call_logs"                          up={totalCallsToday > 0} />
          <HeroStat label="New leads added"   value={newLeadsToday}                delta="today"                                   up={newLeadsToday > 0} />
          <HeroStat label="Won today"         value={formatLakh(pipelineToday)}    delta="status=won"                              up={pipelineToday > 0} />
        </div>
      </div>

      {/* Phase 70.2 (22 May 2026) — live admin map. Each rep with a
          ping today shows as a colored dot. Green = ping <5min, amber
          = 5-30min stale, red = 30min+ stale. Marker popups show name
          + role + age. Realtime subscription updates dots as new
          pings arrive — no manual refresh needed. */}
      <div className="lead-card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
        <div className="lead-card-head" style={{ padding: '12px 16px' }}>
          <div>
            <div className="lead-card-title">Live field map</div>
            <div className="lead-card-sub">
              Updates as reps ping in. Tap a dot to see who.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#10B981', marginRight: 4 }} />fresh</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#F59E0B', marginRight: 4 }} />5-30min</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#EF4444', marginRight: 4 }} />stale</span>
          </div>
        </div>
        <div
          ref={mapContainerRef}
          style={{ width: '100%', height: 360 }}
        />
      </div>

      {/* Rep grid */}
      <div className="lead-team-grid">
        {reps.map(r => {
          const sess = sessionByUser.get(r.id)
          // Phase 84 + 88.7 — status driven by check-in, not ping age.
          // Owner directive 23 May 2026: 'kirti has checked in but
          // its not shoijn in fiedl' — Phase 84's 90-min ping gate
          // flipped sales reps to 'idle' once GPS background pings
          // stopped (app backgrounded, network drop, screen off), even
          // though they were actively working. Owner perspective:
          // rep checked in + not checked out = in field. Period.
          //
          // Ping freshness now drives ONLY the map pin colour band
          // (Phase 87.6 green/amber/red ring). Status pill drops the
          // ping-age gate entirely.
          //
          // New rule:
          //   • DONE       check_out_at set OR auto_checked_out
          //   • OFF        no check_in_at today
          //   • IN FIELD   check_in_at set, not checked out
          //   (IDLE state retired — was misleading.)
          let statusKind, statusLabel
          if (sess?.check_out_at || sess?.auto_checked_out) {
            statusKind  = 'done'
            statusLabel = 'done'
          } else if (!sess?.check_in_at) {
            statusKind  = 'off'
            statusLabel = 'off'
          } else {
            statusKind  = 'in_field'
            statusLabel = 'in field'
          }
          const isLive = statusKind === 'in_field'
          const counters = sess?.daily_counters || {}
          // Phase 73 — role-aware target. TC reads min_calls from
          // daily_targets table (default 50). Sales falls back to
          // users.daily_targets JSONB (default 20).
          const isTC = r.team_role === 'telecaller'
          const policy = policyByUser[r.id]
          const usersJsonbTargets = r.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
          const callsHere = callsByUser[r.id] || 0           // total tel-taps
          const connHere  = connectedByUser[r.id] || 0       // outcome='connected' only
          const callsTarget = policy?.min_calls
            ? Number(policy.min_calls)
            : (isTC ? 50 : (usersJsonbTargets.calls || 20))
          const meetingsTarget = isTC ? 0 : (usersJsonbTargets.meetings || 5)
          // Phase 83 — KPI ratio uses CONNECTED vs target (owner:
          // "in kpi we must count connected calls only"). Total is
          // still shown as a small subscript so admin can read the
          // connect rate at a glance.
          const callPct = callsTarget > 0
            ? Math.round((callsHere / callsTarget) * 100)
            : 0
          // Phase 112.4 (2026-06-04) — role-aware "work line" + 2nd tile.
          // Field sales don't make calls, so the call-% progress bar sat
          // at 0 ("not going ahead") and the Calls tile read 0/20. Sales
          // now tracks LEADS (2nd tile) + MEETINGS (the bar) — their real
          // day. TC keeps Calls + call-% bar (calls ARE their job).
          const leadsHere    = Number(counters.new_leads || 0)
          const leadsTarget  = isTC ? 0 : (usersJsonbTargets.new_leads || 10)
          const meetingsHere = Number(counters.meetings || 0)
          const meetPct = meetingsTarget > 0
            ? Math.round((meetingsHere / meetingsTarget) * 100)
            : 0
          const barPct = isTC ? callPct : meetPct
          const barCls = barPct >= 80 ? '' : barPct >= 50 ? 'warn' : 'dng'
          return (
            <div
              className={`lead-rep-card ${isLive ? 'live' : ''}`}
              key={r.id}
              onClick={() => navigate(`/admin/gps/${r.id}`)}
              style={{ cursor: 'pointer' }}
              title={`Open ${r.name}'s full day`}
            >
              <div className="lead-rep-head">
                <LeadAvatar name={r.name} userId={r.id} imageUrl={r.profile_image_url} />
                <div>
                  <div className="lead-rep-name">{r.name}</div>
                  <div className="lead-rep-meta">
                    {r.team_role}{r.city ? ` · ${r.city}` : ''}
                  </div>
                </div>
                {/* Phase 112.7 — month quote / won VALUE capsules at the
                    marked spot (right of name, left of the status pill).
                    Compact ₹ in the pill; full ₹ on hover. */}
                {(() => {
                  const mq  = monthQuotesByUser[r.id]   || 0
                  const mqA = monthQuoteAmtByUser[r.id] || 0
                  const mw  = monthWonByUser[r.id]      || 0
                  const mwA = monthWonAmtByUser[r.id]   || 0
                  const chip = (color, bg) => ({
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
                    border: `1px solid ${color}`, background: bg, color,
                  })
                  return (
                    <div style={{
                      marginLeft: 'auto', display: 'flex', gap: 6,
                      alignItems: 'center', flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                    }}>
                      <span
                        style={chip('var(--blue, #3B82F6)', 'rgba(59,130,246,0.12)')}
                        title={`${mq} quote${mq === 1 ? '' : 's'} this month · ${formatCurrency(mqA)}`}
                      >
                        {mq} quote{mq === 1 ? '' : 's'} · {formatLakh(mqA)}
                      </span>
                      <span
                        style={chip('var(--success, #10B981)', 'rgba(16,185,129,0.12)')}
                        title={`${mw} won this month · ${formatCurrency(mwA)}`}
                      >
                        {mw} won · {formatLakh(mwA)}
                      </span>
                    </div>
                  )
                })()}
                <div className="lead-rep-status">
                  {statusKind === 'in_field' && (
                    <Pill tone="success" title="Checked in + GPS ping within last 90 min">
                      <span className="lead-live-dot" style={{ marginRight: 5, width: 6, height: 6 }} />
                      in field
                    </Pill>
                  )}
                  {statusKind === 'idle' && (
                    <Pill tone="warning" title="Checked in but no GPS ping in last 90 min">
                      idle
                    </Pill>
                  )}
                  {statusKind === 'done' && (
                    <Pill title="Checked out for the day">done</Pill>
                  )}
                  {statusKind === 'off' && (
                    <Pill title="Not checked in today">off</Pill>
                  )}
                </div>
              </div>
              <div className="lead-rep-kpis">
                {/* Phase 73 — Meet tile hidden for TC (they don't do
                    field meetings; their target is call-only). Sales
                    reps still see Meet against their personal target. */}
                {!isTC && (
                  <div className="lead-rep-kpi">
                    <div className={`num ${counters.meetings >= meetingsTarget ? 'suc' : counters.meetings === 0 ? 'dng' : ''}`}>
                      {counters.meetings || 0}/{meetingsTarget || 0}
                    </div>
                    <div className="lbl">Meet</div>
                  </div>
                )}
                {/* Phase 112.4 — TC: Calls (connected/target · total).
                    Sales: Leads today / target (field reps don't call). */}
                {isTC ? (
                  <div className="lead-rep-kpi" title=">=10s calls / target · connected">
                    {/* Phase 128.2 — owner rule (section-49): the calls-toward-50
                        metric is >=10s calls (callsHere), NOT connected. Was
                        showing connHere (connected) per the older Phase 83
                        directive; aligned to the rep hero + the report (both
                        already >=10s). Connected moves to the subtitle. */}
                    <div className={`num ${callPct >= 80 ? 'suc' : callPct >= 50 ? '' : 'dng'}`}>
                      {callsHere}/{callsTarget}
                    </div>
                    <div className="lbl">
                      Calls
                      {' '}<span style={{ color: 'var(--v2-ink-2, #94a3b8)', fontSize: 9 }}>
                        · {connHere} connected
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="lead-rep-kpi"
                    title="New leads / target — tap to open this rep's leads"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); navigate(`/leads?rep=${r.id}`) }}
                  >
                    <div className={`num ${leadsHere >= leadsTarget ? 'suc' : leadsHere === 0 ? 'dng' : ''}`}>
                      {leadsHere}/{leadsTarget}
                    </div>
                    <div className="lbl">Leads</div>
                  </div>
                )}
                {/* Phase 112.1 (2026-06-04) — Voice tile dropped per
                    owner directive ("i dont need voice in dashboard").
                    Overdue F-up now shows for ALL reps (was TC-only,
                    Phase 93.5), so row 1 = Meet · Calls · Overdue F-up
                    (sales) / Calls · Overdue F-up (TC, Meet hidden).
                    overdueFuByUser is computed role-agnostically above
                    — no new query. */}
                {(() => {
                  const overdueFu = overdueFuByUser[r.id] || 0
                  const odCls = overdueFu === 0 ? '' : overdueFu >= 5 ? 'dng' : 'warn'
                  return (
                    <div
                      className="lead-rep-kpi"
                      title="Follow-ups past due — tap to open this rep's follow-ups"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/follow-ups?rep=${r.id}`) }}
                    >
                      <div className={`num ${odCls}`}>{overdueFu}</div>
                      <div className="lbl">Overdue F-up</div>
                    </div>
                  )
                })()}
                {/* Phase 112.3 — TC-only: Qualified (positive calls
                    today) fills the cell freed by the hidden Meet tile. */}
                {isTC && (() => {
                  const q = qualifiedByUser[r.id] || 0
                  return (
                    <div
                      className="lead-rep-kpi"
                      title="Positive-outcome calls today — tap for this rep's working leads"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/leads?rep=${r.id}&stage=working`) }}
                    >
                      <div className={`num ${q > 0 ? 'suc' : ''}`}>{q}</div>
                      <div className="lbl">Qualified</div>
                    </div>
                  )
                })()}
              </div>
              {/* Phase 82 — three new KPI tiles per rep card:
                    F-up   pending/done follow_ups in the window
                    Quote  status='sent' & >3d no update (chase me)
                    Pay    status='won' with unsettled balance
                  Color rules:
                    F-up   green if no pending, amber if 1-3, rose 4+
                    Quote  amber if any, rose if 5+
                    Pay    amber if any, rose if 3+
              */}
              {(() => {
                const fu        = followUpsByUser[r.id] || { pending: 0, done: 0 }
                const fuPending = fu.pending
                const fuDone    = fu.done
                const fuCls     = fuPending === 0 ? 'suc' : fuPending <= 3 ? 'warn' : 'dng'
                const qChase    = quoteChaseByUser[r.id] || 0
                const qCls      = qChase === 0 ? '' : qChase >= 5 ? 'dng' : 'warn'
                const pChase    = paymentChaseByUser[r.id] || 0
                const pCls      = pChase === 0 ? '' : pChase >= 3 ? 'dng' : 'warn'
                // Phase 93.5 — TC tiles. Phase 93.4 split Quote/Pay
                // chase → Overdue F-up + Connect rate for TCs. Phase
                // 93.5 (owner directive 25 May 2026) moved Overdue
                // F-up to row 1 beside Voice. Row 2 now holds F-up +
                // Connect rate only. Non-TC rows keep F-up + Quote
                // chase + Pay chase.
                const connectRate = callsHere > 0
                  ? Math.round((connHere / callsHere) * 100)
                  : 0
                const crCls = callsHere === 0 ? '' :
                              connectRate >= 30 ? 'suc' :
                              connectRate >= 15 ? 'warn' : 'dng'
                return (
                  <div className="lead-rep-kpis" style={{ marginTop: 6 }}>
                    <div
                      className="lead-rep-kpi"
                      title="Follow-ups closed in this period / closed + still open due — matches the evening report"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/follow-ups?rep=${r.id}`) }}
                    >
                      <div className={`num ${fuCls}`}>{fuDone}/{fuDone + fuPending}</div>
                      <div className="lbl">Today F-up</div>
                    </div>
                    {isTC ? (
                      <>
                        <div
                          className="lead-rep-kpi"
                          title="Tap for this rep's full call breakdown"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/admin/gps/${r.id}`) }}
                        >
                          <div className={`num ${crCls}`}>{callsHere > 0 ? `${connectRate}%` : '—'}</div>
                          <div className="lbl">Connect rate</div>
                        </div>
                        {/* Phase 112.3 / 128.2 — TC-only: Callbacks due
                            (today + overdue last 7d, one per lead). */}
                        <div
                          className="lead-rep-kpi"
                          title="Callbacks due — today + overdue (last 7 days), one per lead"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/follow-ups?rep=${r.id}`) }}
                        >
                          <div className={`num ${(callbacksDueByUser[r.id] || 0) > 0 ? 'acc' : ''}`}>
                            {callbacksDueByUser[r.id] || 0}
                          </div>
                          <div className="lbl">Callbacks due</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className="lead-rep-kpi"
                          title="Sent quotes going stale — tap for this rep's sent quotes"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/quotes?rep=${r.id}&status=sent`) }}
                        >
                          <div className={`num ${qCls}`}>{qChase}</div>
                          <div className="lbl">Quote chase</div>
                        </div>
                        <div
                          className="lead-rep-kpi"
                          title="Won quotes not fully paid — tap for this rep's won quotes"
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/quotes?rep=${r.id}&status=won`) }}
                        >
                          <div className={`num ${pCls}`}>{pChase}</div>
                          <div className="lbl">Pay chase</div>
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}
              {/* Phase 62.9 (20 May 2026) + Phase 90.2 (2026-05-25
                  threshold relax) + Phase 102.H.2 (2026-05-29 — open
                  gps_off_event override + 60min stale threshold).
                  GPS / Online / Push status pills per rep. Color-
                  banded so admin spots any rep with a broken signal
                  at-a-glance. Green = healthy, red = OFF / stale.
                    GPS    — no open gps_off_event AND ping in last
                              60 min (was ≤ 12h)
                    Online — push_subscriptions.last_seen_at < 24h ago
                    Push   — push_subscriptions row exists
                  Phase 102.H.2 — owner reported pill stayed green
                  when rep's phone Location was off 13 min. The
                  Phase 90.2 12h window was too loose. Phase 102.H.1
                  shim writes a foreground_probe row when phone is
                  off at launch + a native_receiver row on toggle;
                  open row trumps ping freshness here. */}
              {(() => {
                const ping = latestPingByUser[r.id]
                const pingMins = ping
                  ? Math.floor((Date.now() - new Date(ping.captured_at).getTime()) / 60000)
                  : Infinity
                // Phase 102.L (2026-05-31) — TIMESTAMP comparison, not
                // boolean veto. A ping NEWER than the open off-event
                // proves GPS is back on (the ping itself requires GPS),
                // so the unclosed row is stale (close event leaked when
                // the app was backgrounded — confirmed: Dixita had 3
                // open rows from 23 May while pinging 31 May).
                //   GPS ON  = fresh ping (≤60 min) AND ping newer than
                //             the latest open off-event.
                //   GPS OFF = no ping in 60 min, OR the off-event is
                //             newer than the last ping (genuinely went
                //             off after last movement).
                // Self-heals leaked rows. TA/DA payable unchanged —
                // Phase 68 compute_daily_ta does NOT join gps_off_events;
                // this is display-only.
                const offAtMs    = gpsOffByUser[r.id] || 0   // ms epoch or 0
                const lastPingMs = ping ? new Date(ping.captured_at).getTime() : 0
                const gpsOn = pingMins <= 60 && lastPingMs > offAtMs
                const push = pushByUser[r.id]
                const pushOn = !!push?.has_sub
                const lastSeenMins = push?.last_seen_at
                  ? Math.floor((Date.now() - new Date(push.last_seen_at).getTime()) / 60000)
                  : Infinity
                // Phase 110c (2026-06-02) — a CHECKED-OUT rep is not "online".
                // Mirror the live-count rule (~line 1017) so the ONLINE pill
                // agrees with the "done" badge. Owner: a rep who ended the day
                // must not read ONLINE while a stale push-heartbeat lingers.
                const _sess = sessionByUser.get(r.id)
                const _checkedOut = !!(_sess?.check_out_at || _sess?.auto_checked_out)
                const onlineOk = lastSeenMins <= 1440 && !_checkedOut // 24h + not checked out
                const pill = (label, ok, onClick) => (
                  <span
                    onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
                    role={onClick ? 'button' : undefined}
                    title={onClick ? `Send a push notification to ${r.name}` : undefined}
                    style={{
                      display:      'inline-flex',
                      alignItems:   'center',
                      gap:          4,
                      padding:      '3px 8px',
                      borderRadius: 999,
                      fontSize:     10,
                      fontWeight:   600,
                      letterSpacing:'.04em',
                      textTransform:'uppercase',
                      border:       `1px solid ${ok ? 'var(--success, #10B981)' : 'var(--danger, #EF4444)'}`,
                      background:   ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.14)',
                      color:        ok ? 'var(--success, #10B981)' : 'var(--danger, #EF4444)',
                      cursor:       onClick ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: ok ? 'var(--success, #10B981)' : 'var(--danger, #EF4444)',
                    }} />
                    {label} {ok ? 'on' : 'off'}
                  </span>
                )
                return (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display:    'flex',
                      flexWrap:   'wrap',
                      gap:        6,
                      marginTop:  6, marginBottom: 4,
                    }}
                    title="GPS / Online / Push status — red if rep's phone signal is broken"
                  >
                    {pill('GPS',    gpsOn)}
                    {pill('Online', onlineOk)}
                    {pill('Push',   pushOn, () => setPushTarget({ id: r.id, name: r.name }))}
                  </div>
                )
              })()}
              {/* Phase 112.4 — "work line" = meetings progress for sales
                  (was call-% → stuck at 0 for field reps), calls for TC. */}
              <div className="lead-rep-progress">
                <span className={barCls} style={{ width: `${Math.min(barPct, 100)}%` }} />
              </div>
              <div className="lead-rep-foot">
                <MapPin size={11} />
                {/* Phase 34U — live GPS readout. Falls back to the
                    static profile city when no ping was captured
                    today. */}
                <span>
                  {(() => {
                    const ping = latestPingByUser[r.id]
                    if (!ping) return r.city || '—'
                    const minsAgo = Math.max(0, Math.floor((Date.now() - new Date(ping.captured_at).getTime()) / 60000))
                    const fresh = minsAgo <= 10
                    const ago = minsAgo < 1
                      ? 'just now'
                      : minsAgo < 60
                        ? `${minsAgo} min ago`
                        : `${Math.floor(minsAgo / 60)}h ago`
                    return (
                      <>
                        <span style={{ color: fresh ? 'var(--success, #10B981)' : 'var(--text-muted, #94a3b8)' }}>
                          {fresh ? '● live' : '○'} {ago}
                        </span>
                        {r.city && <span style={{ color: 'var(--text-subtle, #64748b)', marginLeft: 6 }}>· {r.city}</span>}
                      </>
                    )
                  })()}
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {counters.new_leads ? <>Leads today: <b>{counters.new_leads}</b></> : null}
                  {/* Phase 31Z — owner couldn't find the GPS map view
                      because no UI surface linked to it. Each rep card
                      now has a "View track" link to /admin/gps/:userId
                      (defaults to today's date in GpsTrackV2). */}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/admin/gps/${r.id}`) }}
                    style={{
                      background: 'transparent', border: 0,
                      color: 'var(--accent, #FFE600)',
                      fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', padding: 0,
                      textDecoration: 'underline',
                    }}
                    title="View today's GPS track on a map"
                  >
                    View track →
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ height: 16 }} />

      {/* Live voice feed — Phase 21a: voice is live (Phase 20). The
          live-streaming roll-up of voice_logs across the team is a
          Sprint C item once we have meaningful volume. For now this
          card just confirms the feature is deployed. */}
      <div className="lead-card">
        <div className="lead-card-head">
          <div>
            <div className="lead-card-title">
              <span className="voice-pill" style={{ marginRight: 8 }}>
                <Mic size={10} style={{ marginRight: 4 }} /> live
              </span>
              Live voice feed · all reps
            </div>
            <div className="lead-card-sub">
              Auto-classified · transcripts on each lead's timeline
            </div>
          </div>
        </div>
        <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
          Voice logging is deployed. Reps record from any lead detail page or <b style={{ color: 'var(--text)' }}>/voice</b>. Whisper transcribes, Claude classifies (call/whatsapp/meeting · positive/neutral/negative), and the result lands as a lead activity. A roll-up of recent voice logs across the whole team will surface here once usage builds up.
        </div>
      </div>
      {/* Phase 103.E — admin compose-push to a rep (opened from the Push pill) */}
      <AdminPushModal target={pushTarget} onClose={() => setPushTarget(null)} />
    </div>
  )
}

/* ─── Helpers ─── */
function HeroStat({ label, value, delta, up, down, acc }) {
  return (
    <div className="lead-hero-stat">
      <div className="lbl">{label}</div>
      <div className={`val ${acc ? 'acc' : ''}`}>{value}</div>
      <div className={`delta ${up ? 'up' : down ? 'down' : ''}`}>{delta}</div>
    </div>
  )
}

function formatLakh(n) {
  const x = Number(n) || 0
  if (x >= 10000000) return `₹${(x / 10000000).toFixed(1)}Cr`
  if (x >= 100000)   return `₹${(x / 100000).toFixed(1)}L`
  if (x >= 1000)     return `₹${(x / 1000).toFixed(0)}K`
  return `₹${x}`
}
