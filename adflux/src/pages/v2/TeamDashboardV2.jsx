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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users as UsersIcon, MapPin, Mic, Loader2 } from 'lucide-react'
import { Loader } from '@googlemaps/js-api-loader'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { LeadAvatar, Pill } from '../../components/leads/LeadShared'
import { formatCurrency } from '../../utils/formatters'
// Phase 82 — date filter + per-rep follow-up/quote/payment KPIs.
import { PeriodPicker } from '../../components/v2/PeriodPicker'
import { presetToday } from '../../utils/period'

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

      const [repsRes, sesRes, callsRes, newLeadsRes, pipelineRes, voiceRes, pingsRes, policyRes, fuRes, quoteSentRes, quoteWonRes, paymentsRes, actGeoRes] = await Promise.all([
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
          .select('user_id, check_in_at, daily_counters')
          .eq('work_date', today),
        // Phase 83 — fetch outcome so we can split TOTAL vs
        // CONNECTED per rep. Outcome enum: 'connected', 'no_answer',
        // 'busy', 'wrong_number', 'callback_requested',
        // 'not_interested', 'sales_ready', 'already_client'. Anything
        // other than 'connected' means no human conversation, so the
        // KPI ratio uses connected-only.
        supabase.from('call_logs')
          .select('user_id, outcome')
          .gte('call_at', startOfDay)
          .lt ('call_at', endOfDay),
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

        // Phase 82 — follow_ups in the window, grouped client-side
        // by assigned_to into pending + done counts. Owner: "daily
        // followup / done".
        supabase.from('follow_ups')
          .select('assigned_to, is_done, follow_up_date, done_at')
          .gte('follow_up_date', period.startIso)
          .lt ('follow_up_date', period.endIso),
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
        // Phase 89.1 — geo-tagged lead activities in the period
        // window for blue lead pins on the live field map.
        // Meeting / site_visit only — calls + notes don't earn a
        // location pin since the rep isn't physically there.
        // Joined to leads(name, company) for InfoWindow content.
        supabase.from('lead_activities')
          .select('id, created_at, created_by, activity_type, outcome, gps_lat, gps_lng, lead:lead_id(id, name, company)')
          .in('activity_type', ['meeting', 'site_visit'])
          .not('gps_lat', 'is', null)
          .not('gps_lng', 'is', null)
          .gte('created_at', startOfDay)
          .lt ('created_at', endOfDay)
          .order('created_at', { ascending: false }),
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
      const fuMap = {}
      ;(fuRes.data || []).forEach((r) => {
        if (!r.assigned_to) return
        const e = fuMap[r.assigned_to] || { pending: 0, done: 0 }
        if (r.is_done) e.done += 1
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

      // Phase 89.1 — geo-tagged lead activities populate blue
      // lead pins on the field map. Coerced to numbers + filtered
      // to drop malformed rows (defensive: PostgREST nests join
      // result as `lead`, may be null if FK orphaned).
      const geoRows = (actGeoRes?.data || [])
        .filter(a => Number.isFinite(Number(a.gps_lat))
                  && Number.isFinite(Number(a.gps_lng))
                  && a.lead?.id)
        .map(a => ({
          id:        a.id,
          lat:       Number(a.gps_lat),
          lng:       Number(a.gps_lng),
          created_at: a.created_at,
          created_by: a.created_by,
          activity_type: a.activity_type,
          outcome:   a.outcome,
          lead_id:   a.lead.id,
          lead_name: a.lead.name || '',
          lead_company: a.lead.company || '',
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
    })()

    return () => {
      cancelled = true
      mapRef.current = null
      markersRef.current = {}
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

    for (const r of reps) {
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
        existing.__iw?.setContent(
          `<strong>${r.name}</strong><br/>${r.team_role || ''}<br/>${Math.round(ageMin)} min ago`
        )
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
        const iw = new google.maps.InfoWindow({
          content: `<strong>${r.name}</strong><br/>${r.team_role || ''}<br/>${Math.round(ageMin)} min ago`,
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
  }, [latestPingByUser, reps, iconBump])

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
    const iconFor = (o) => ({
      path:         google.maps.SymbolPath.CIRCLE,
      scale:        8,
      fillColor:    colorForOutcome(o),
      fillOpacity:  0.9,
      strokeColor:  '#0f172a',
      strokeWeight: 2,
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
      const heading = a.lead_company || a.lead_name || 'Lead'
      const sub = a.lead_company && a.lead_name ? esc(a.lead_name) : ''
      const kind = a.activity_type === 'site_visit' ? 'Site visit' : 'Meeting'
      const outcomeBit = a.outcome
        ? ` · <span style="text-transform:capitalize">${esc(a.outcome)}</span>`
        : ''
      const html = `
        <div style="font-family:'DM Sans',sans-serif;min-width:180px">
          <div style="font-weight:700;font-size:13px;color:#0f172a">${esc(heading)}</div>
          ${sub ? `<div style="font-size:11px;color:#475569;margin-top:2px">${sub}</div>` : ''}
          <div style="font-size:11px;color:#475569;margin-top:6px">${kind} · ${esc(repName)} · ${timeStr}${outcomeBit}</div>
          <a href="/leads/${esc(a.lead_id)}" style="display:inline-block;margin-top:8px;font-size:11px;color:#1d4ed8;text-decoration:none;font-weight:600">Open lead →</a>
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
  }, [leadActivitiesGeo, reps])

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

  const sessionByUser = useMemo(() => {
    const m = new Map()
    sessions.forEach(s => m.set(s.user_id, s))
    return m
  }, [sessions])

  // Phase 84 — "live" matches the new 4-state badge:
  //   checked-in + GPS ping within 90 min + not checked-out.
  // 90 min covers a rep on a long meeting / lunch / desk-bound TC
  // without flipping to "idle" too aggressively.
  const live = useMemo(() => {
    const now = Date.now()
    return reps.filter(r => {
      const s = sessionByUser.get(r.id)
      if (!s?.check_in_at) return false
      if (s.check_out_at || s.auto_checked_out) return false
      const p = latestPingByUser[r.id]
      if (!p?.captured_at) return false
      return (now - new Date(p.captured_at).getTime()) / 60000 <= 90
    }).length
  }, [reps, sessionByUser, latestPingByUser])

  const totalCallsToday = useMemo(() => {
    return Object.values(callsByUser).reduce((s, n) => s + n, 0)
  }, [callsByUser])

  // Phase 31E — total voice logs across the team, today.
  const totalVoiceToday = useMemo(() => {
    return Object.values(voiceByUser).reduce((s, n) => s + n, 0)
  }, [voiceByUser])

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
          <HeroStat label="Voice logs"        value={totalVoiceToday}              delta={totalVoiceToday > 0 ? 'recorded today' : 'none yet today'}  acc />
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
          // Phase 84 — 4-state status badge.
          // Was: isLive = !!check_in_at (anyone who tapped check-in
          // today, regardless of subsequent activity → misleading
          // green "in field" pill on reps who went dark 10 h ago).
          // New rule:
          //   • DONE       check_out_at set OR auto_checked_out
          //   • OFF        no check_in_at today
          //   • IN FIELD   check_in_at set AND GPS ping ≤ 90 min
          //   • IDLE       check_in_at set AND GPS ping > 90 min OR
          //                no ping today
          //   (Phase 84 tune: 30 min → 90 min so long meetings, lunch,
          //    or desk-bound TC reps don't flip to amber too fast.)
          const _ping     = latestPingByUser[r.id]
          const _pingMins = _ping
            ? Math.floor((Date.now() - new Date(_ping.captured_at).getTime()) / 60000)
            : Infinity
          let statusKind, statusLabel
          if (sess?.check_out_at || sess?.auto_checked_out) {
            statusKind  = 'done'
            statusLabel = 'done'
          } else if (!sess?.check_in_at) {
            statusKind  = 'off'
            statusLabel = 'off'
          } else if (_pingMins <= 90) {
            statusKind  = 'in_field'
            statusLabel = 'in field'
          } else {
            statusKind  = 'idle'
            statusLabel = 'idle'
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
            ? Math.round((connHere / callsTarget) * 100)
            : 0
          const cls = callPct >= 80 ? '' : callPct >= 50 ? 'warn' : 'dng'
          return (
            <div
              className={`lead-rep-card ${isLive ? 'live' : ''}`}
              key={r.id}
              onClick={() => navigate(`/admin/gps/${r.id}`)}
              style={{ cursor: 'pointer' }}
              title={`Open ${r.name}'s full day`}
            >
              <div className="lead-rep-head">
                <LeadAvatar name={r.name} userId={r.id} />
                <div>
                  <div className="lead-rep-name">{r.name}</div>
                  <div className="lead-rep-meta">
                    {r.team_role}{r.city ? ` · ${r.city}` : ''}
                  </div>
                </div>
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
                <div className="lead-rep-kpi" title="Connected / target · total tel-taps">
                  <div className={`num ${callPct >= 80 ? 'suc' : callPct >= 50 ? '' : 'dng'}`}>
                    {connHere}/{callsTarget}
                  </div>
                  <div className="lbl">
                    Calls
                    {' '}<span style={{ color: 'var(--v2-ink-2, #94a3b8)', fontSize: 9 }}>
                      · {callsHere} total
                    </span>
                  </div>
                </div>
                <div className="lead-rep-kpi">
                  {/* Phase 31E — wired to voiceByUser instead of literal 0. */}
                  <div className={`num ${(voiceByUser[r.id] || 0) > 0 ? 'acc' : ''}`}>
                    {voiceByUser[r.id] || 0}
                  </div>
                  <div className="lbl">Voice</div>
                </div>
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
                return (
                  <div className="lead-rep-kpis" style={{ marginTop: 6 }}>
                    <div className="lead-rep-kpi">
                      <div className={`num ${fuCls}`}>{fuDone}/{fuDone + fuPending}</div>
                      <div className="lbl">F-up</div>
                    </div>
                    <div className="lead-rep-kpi">
                      <div className={`num ${qCls}`}>{qChase}</div>
                      <div className="lbl">Quote chase</div>
                    </div>
                    <div className="lead-rep-kpi">
                      <div className={`num ${pCls}`}>{pChase}</div>
                      <div className="lbl">Pay chase</div>
                    </div>
                  </div>
                )
              })()}
              {/* Phase 62.9 (20 May 2026) — GPS / Online / Push status
                  pills per rep. Color-banded so admin spots any rep
                  with a broken signal at-a-glance. Green = healthy,
                  red = OFF / stale.
                    GPS    — fresh ping in last 30 min
                    Online — push_subscriptions.last_seen_at < 3h ago
                    Push   — push_subscriptions row exists
                  Rule of thumb: if all three are red, the rep's
                  phone is likely off or out of signal area. */}
              {(() => {
                const ping = latestPingByUser[r.id]
                const pingMins = ping
                  ? Math.floor((Date.now() - new Date(ping.captured_at).getTime()) / 60000)
                  : Infinity
                const gpsOn = pingMins <= 30
                const push = pushByUser[r.id]
                const pushOn = !!push?.has_sub
                const lastSeenMins = push?.last_seen_at
                  ? Math.floor((Date.now() - new Date(push.last_seen_at).getTime()) / 60000)
                  : Infinity
                const onlineOk = lastSeenMins <= 180   // 3h
                const pill = (label, ok) => (
                  <span
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
                    {pill('Push',   pushOn)}
                  </div>
                )
              })()}
              <div className="lead-rep-progress">
                <span className={cls} style={{ width: `${Math.min(callPct, 100)}%` }} />
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
