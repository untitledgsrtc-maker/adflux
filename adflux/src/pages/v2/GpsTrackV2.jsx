// src/pages/v2/GpsTrackV2.jsx
//
// Phase 30F — admin view of a rep's day on the map.
//
// Owner spec (7 May 2026): "in admin dashboard it should show 1 day
// map lines and how many km he drove the bike".
//
// Route: /admin/gps/:userId/:date  (date = YYYY-MM-DD)
// If date is omitted, defaults to today.
//
// We render with Leaflet via CDN to avoid pulling another bundle. The
// Leaflet CSS/JS are injected on first mount; subsequent visits hit
// cache. Tile source: OSM (free, no key needed for low traffic).
//
// Distance: Haversine summed across consecutive pings. iOS PWA
// foreground-only caveat acknowledged in §SQL phase30f comment.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin, ChevronDown, ChevronUp } from 'lucide-react'
// Phase 32K (10 May 2026) — owner reported map STILL failed after
// Phase 32A's CDN failover ("Map library failed to load: undefined").
// Both unpkg and cdnjs were failing for him — likely network /
// firewall / corporate-proxy interference. Leaflet now bundled via
// npm so it ships in the Vite chunk; no CDN dependency at runtime.
// Adds ~40KB gzip to the GpsTrack chunk only (lazy-loaded).
import { Loader } from '@googlemaps/js-api-loader'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatDate } from '../../utils/formatters'

// Phase 34Z.6 — haversine + summariseTrack live in src/utils/
// gpsDistance.js so /work uses the same filter rules.
import { summariseTrack, cleanTrack, detectStops, coverageHours } from '../../utils/gpsDistance'

// Phase 93.6 (25 May 2026) — "I'm here · auto-check-in" companion
// rows are auto-stamped by LogMeetingModal whenever a rep saves a
// meeting from the lead detail page. They share activity_type=
// 'meeting' + GPS coords with the real meeting row, so a naive
// filter doubles every meeting count. Owner reported Kirti = 3
// real meetings → KPI showed 6.
//
// Helper excludes these companion rows from any meeting-count or
// map-pin reckoning so the visible total matches what the rep
// actually logged.
const isAutoCheckinRow = (a) =>
  (a?.notes || '').startsWith("I'm here · auto-check-in")

// Phase 103.E.2 — scheduled FUTURE meetings (PostCallOutcomeModal logs
// "Meeting scheduled · <date>" as activity_type='meeting') are booked
// appointments, NOT done meetings. Exclude from every done-meeting
// reckoning, same as auto-check-in companion rows. The server-side
// counter (lead_activity_bump_counter / recompute_daily_meetings) does
// the same — keep these in lockstep.
const isScheduledMeetingRow = (a) =>
  (a?.notes || '').startsWith('Meeting scheduled')

// Phase 93.7 (25 May 2026) — owner directive: "only unique meeting
// can be count in KPI, revisit dont count in KPi". Second/third
// visit to the SAME lead on the same day adds 0 to the KPI.
// Walk-ins (lead_id NULL) each count as unique (no lead to dedupe).
// Map pins still render every visit — only the headline count is
// dedupe'd.
const uniqueMeetingCount = (activities, requireGps = false) => {
  if (!Array.isArray(activities)) return 0
  const seen = new Set()
  for (const a of activities) {
    if (a.activity_type !== 'meeting' && a.activity_type !== 'site_visit') continue
    if (isAutoCheckinRow(a)) continue
    if (isScheduledMeetingRow(a)) continue
    if (requireGps && (!a.gps_lat || !a.gps_lng)) continue
    // Phase 127 — the activities SELECT aliases the lead as
    // lead:lead_id(...) → the row carries a.lead.id, NOT a flat
    // a.lead_id. Reading only a.lead_id made EVERY meeting fall to the
    // walk-in branch → the lead-dedup never ran → revisits inflated the
    // headline (kirti showed 2 for one twice-visited lead). Read the
    // nested id first, keep the flat + walk-in fallbacks.
    const key = a.lead?.id || a.lead_id || `walkin_${a.id}`
    seen.add(key)
  }
  return seen.size
}

// Phase 70.7 (22 May 2026) — dark Google Maps style that matches the
// v2 chrome but keeps road network legible. Previous palette had
// roads only ~30% lighter than ground; new palette lifts roads to
// ~70% lighter so streets stand out clearly against the dark
// background. Locality / arterial labels also bumped for readability.
const DARK_MAP_STYLE = [
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
]

// Phase 103.D.6 — fetch ALL of the day's pings, paged past the
// PostgREST 1000-row cap. The native foreground service (Phase 103.D.3)
// writes ~1 fix/20s → a full workday is ~1,400-1,900 pings, so a single
// request silently truncated the track to the morning (Dixita 10.7km
// drive showed 3.6km). Pages of 1000 via .range() until a short page.
// Returns { data, error } so it slots into the existing Promise.all.
async function fetchAllPings(userId, start, end) {
  const PAGE = 1000
  let all = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase.from('gps_pings')
      .select('id, captured_at, lat, lng, accuracy_m, source')
      .eq('user_id', userId)
      .gte('captured_at', start)
      .lte('captured_at', end)
      .order('captured_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return { data: all, error: null }
}

export default function GpsTrackV2() {
  const navigate = useNavigate()
  const { userId, date } = useParams()
  const targetDate = date || new Date().toISOString().slice(0, 10)
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner', 'hr', 'accounts'].includes(profile?.role) // +hr 2026-08-03: attendance/GPS view (RLS hides sales — calls/activities blank for HR). +accounts 2026-09-01 (§275): open a day's route from the TA table to verify km before approving.
  // Phase 194 — a per-user team viewer (can_view_team_dashboard) can open a
  // rep's route activity from the dashboard drill-down. Kept SEPARATE from
  // isPrivileged: her own RLS is own-only, so she loads the rep's day-track via
  // the gated team_rep_daytrack RPC (below), never the admin client-side reads.
  const canViewTeam = profile?.can_view_team_dashboard === true

  const [pings, setPings]   = useState([])
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  // Phase 32E — rep-day view from owner request: clicking a rep card
  // on Team Live should show the FULL day (map + activities + counters
  // + voice logs), not just GPS. Loading those alongside.
  const [session, setSession] = useState(null)
  const [activities, setActivities] = useState([])
  const [voiceLogs, setVoiceLogs] = useState([])
  // Phase 84.5 — surface GPS-off events from Phase 76.1 inline in
  // the activity timeline. Owner directive 23 May 2026: "when rep
  // turn off gps put it in activity log also". Same data feeds
  // Phase 76 DaySummaryCard.
  const [gpsOffEvents, setGpsOffEvents] = useState([])
  const [networkOffEvents, setNetworkOffEvents] = useState([])  // Phase 228 — internet-off log
  // Phase 76.2.2 (2026-05-23) — live call_logs breakdown for this
  // rep+day. Owner directive: show total / missed (0 or null) /
  // short (1-9s) / qualified (>=10s) as separate KPI buckets so
  // admin can see WHY Rima's qualified count is 145 (because 374
  // misdials + 31 shorts get filtered). Replaces the stale
  // work_sessions.daily_counters.calls JSONB which the Phase 32M
  // trigger bumps on every lead_activities call/whatsapp insert
  // without any duration filter.
  const [callBreakdown, setCallBreakdown] = useState({
    total: 0, missed: 0, noAnswer: 0, short: 0, qualified: 0, connectedQualified: 0,
  })
  // Phase 90.2 — full call rows for the per-call history table.
  // Owner: "i cant see my called of that particular person, should
  // we get it in dashboard when we open that perosn traking page?".
  const [callRows, setCallRows] = useState([])
  // Phase 124 — server daily_ta.km_traveled = the TA-PAID km (compute_daily_ta
  // per-ping trigger; the SAME number the evening report + the payout use).
  // Shown as the headline DISTANCE so the admin sees exactly what the rep is
  // paid. The client summariseTrack (stats) still drives the route line + the
  // ping / low-accuracy diagnostics, but no longer the headline number — it
  // diverged on weak-GPS days (rep saw 51 km, admin 33, payout 32.6).
  const [taKm, setTaKm] = useState(null)
  const mapRef     = useRef(null)
  const containerRef = useRef(null)
  // Phase 70.10 — view-mode toggle: all (route + stops + meetings),
  // route-only (no meeting pins), meetings-only (no route polyline +
  // no GPS stop pins, just blue meeting pins so admin counts where
  // rep met clients today).
  const [viewMode, setViewMode] = useState('all')

  // Fetch the rep + their pings + their day-activity for the date.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      const start = `${targetDate}T00:00:00`
      const end   = `${targetDate}T23:59:59`
      // Phase 194 — a flagged viewer (own-only RLS) reads the whole rep day-track
      // through ONE gated RPC, mapped into the same *Res shapes; every line after
      // is untouched. Admin keeps the exact Promise.all (else) — byte-unchanged.
      let userRes, pingsRes, sessionRes, actsRes, voiceRes, gpsOffRes, callRowsRes, networkOffRes
      if (!isPrivileged && canViewTeam) {
        const { data: b, error: bErr } = await supabase.rpc('team_rep_daytrack', {
          p_user_id: userId, p_start: start, p_end: end, p_date: targetDate,
        })
        if (bErr) { if (!cancelled) { setError(bErr.message); setLoading(false) } return }
        userRes     = { data: b?.user || null, error: null }
        pingsRes    = { data: b?.pings || [], error: null }
        sessionRes  = { data: b?.session || null, error: null }
        actsRes     = { data: b?.activities || [], error: null }
        voiceRes    = { data: b?.voice || [], error: null }
        gpsOffRes   = { data: b?.gps_off || [], error: null }
        callRowsRes = { data: b?.calls || [], error: null }
        networkOffRes = { data: b?.network_off || [], error: null }  // Phase 228 (empty until RPC surfaces it)
        setTaKm(b?.ta_km ?? null)
      } else {
      ;[userRes, pingsRes, sessionRes, actsRes, voiceRes, gpsOffRes, callRowsRes, networkOffRes] = await Promise.all([
        supabase.from('users').select('id, name, role, team_role, city').eq('id', userId).maybeSingle(),
        fetchAllPings(userId, start, end),  // Phase 103.D.6 — paged past 1000-row cap
        // Phase 32E — work_sessions row gives check-in/out times,
        // morning plan, counters. One row per (user_id, work_date).
        supabase.from('work_sessions')
          .select('check_in_at, check_out_at, daily_counters, planned_meetings, morning_plan_text, evening_summary')
          .eq('user_id', userId)
          .eq('work_date', targetDate)
          .maybeSingle(),
        // Phase 32E — every lead activity created by this rep on this
        // date. created_at filtered to the IST day window so the
        // timeline matches the chosen date.
        supabase.from('lead_activities')
          .select('id, created_at, activity_type, outcome, notes, next_action, gps_lat, gps_lng, lead:lead_id(id, name, company)')
          .eq('created_by', userId)
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: false })
          .limit(50),
        // Phase 32E — voice logs filed by this rep that day.
        supabase.from('voice_logs')
          .select('id, created_at, transcript, language_detected, status, classified, lead:lead_id(id, name, company)')
          .eq('user_id', userId)
          .gte('created_at', start)
          .lte('created_at', end)
          .order('created_at', { ascending: false })
          .limit(20),
        // Phase 84.5 — GPS-off events for this rep+day (Phase 76.1).
        supabase.from('gps_off_events')
          .select('id, toggled_off_at, toggled_on_at, duration_seconds, source')
          .eq('user_id', userId)
          .gte('toggled_off_at', start)
          .lte('toggled_off_at', end)
          .order('toggled_off_at', { ascending: false }),
        // Phase 76.2.2 + Phase 90.2 — fetch every call_logs row for
        // this rep+day. Need duration + outcome + direction +
        // client_phone + lead embed for the per-call history table
        // below. Cap at 2000 (sanity limit).
        supabase.from('call_logs')
          .select('id, call_at, duration_seconds, outcome, direction, client_phone, notes, lead:lead_id(id, name, company)')
          .eq('user_id', userId)
          .gte('call_at', start)
          .lte('call_at', end)
          .order('call_at', { ascending: false })
          .limit(2000),
        // Phase 228 — internet-off events for this rep+day (Phase 76.1),
        // mirrors the gps_off_events query above. Native NetworkWatcher writes
        // a row on each internet drop/regain.
        supabase.from('network_off_events')
          .select('id, lost_at, regained_at, duration_seconds, source')
          .eq('user_id', userId)
          .gte('lost_at', start)
          .lte('lost_at', end)
          .order('lost_at', { ascending: false }),
      ])
      }
      if (cancelled) return
      if (userRes.error)  { setError(userRes.error.message);  setLoading(false); return }
      if (pingsRes.error) { setError(pingsRes.error.message); setLoading(false); return }
      setUser(userRes.data || null)
      setPings(pingsRes.data || [])
      setSession(sessionRes.data || null)
      setActivities(actsRes.data || [])
      setVoiceLogs(voiceRes.data || [])
      setGpsOffEvents(gpsOffRes?.data || [])
      setNetworkOffEvents(networkOffRes?.data || [])
      // Phase 76.2.2 — bucket the call rows. NULL duration goes to
      // missed (likely Phase 65 hasn't patched yet; treat as not-yet-
      // qualified). Zero duration also missed (no ring picked up).
      // 1-9s shorts (rep cut early). >=10s qualified. Connected
      // means rep saved the outcome modal with positive/neutral/
      // negative — a real conversation.
      const rows = callRowsRes?.data || []
      // Phase 90.2 — split missed (incoming/no-pickup) from no-answer
      // (outgoing/no-connect). Uses Phase 56l `direction` column.
      // Buckets:
      //   missed       direction='missed'        (inbound rep didn't pick)
      //   noAnswer     direction='outgoing' AND (duration=0 or NULL)
      //                  AND outcome NOT 'connected' (rep called, no pickup)
      //   short        direction='outgoing' AND 0 < duration < 10
      //   qualified    duration >= 10
      //   connectedQualified  qualified AND outcome='connected'
      const breakdown = {
        total: rows.length, missed: 0, noAnswer: 0, short: 0,
        qualified: 0, connectedQualified: 0, qualifiedOther: 0, unverifiedConnected: 0,
      }
      for (const r of rows) {
        const d = r.duration_seconds
        const dir = r.direction || 'outgoing'
        if (dir === 'missed') {
          breakdown.missed += 1
        } else if (d == null || d === 0) {
          breakdown.noAnswer += 1
        } else if (d < 10) {
          breakdown.short += 1
        } else {
          // Phase 119 — a >=10s call only counts as QUALIFIED WORK when
          // it's tied to a lead. Unknown numbers (lead_id NULL — the
          // rep's personal / device-scanned calls) go to qualifiedOther:
          // they stay visible but never inflate the work KPI. Mayur
          // 52->3, Abhinav 16->0, kirti 8->0. Matches useDaySummary,
          // which already counts lead-tied calls only.
          if (r.lead?.id) {
            breakdown.qualified += 1
            if (r.outcome === 'connected') breakdown.connectedQualified += 1
          } else {
            breakdown.qualifiedOther += 1
          }
        }
        // Phase 120 — fraud signal. A lead call the rep MARKED 'connected'
        // but with no >=10s proof (NULL/short duration) = claimed a
        // conversation the data can't back (Kirti-style fake logging).
        // Counted independently of the duration buckets above. Post-116 a
        // real call gets a timer duration, so a NULL here means no real
        // call happened.
        if (r.lead?.id && r.outcome === 'connected'
            && (r.duration_seconds == null || r.duration_seconds < 10)) {
          breakdown.unverifiedConnected += 1
        }
      }
      setCallBreakdown(breakdown)
      setCallRows(rows)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [userId, targetDate])

  // Phase 124 — fetch the authoritative km (server daily_ta.km_traveled) for
  // the headline. Same filter as useDaySummary: user_id + ta_date. Separate
  // effect so it never blocks the ping/map load; maybeSingle → null when the
  // day has no daily_ta row (headline falls back to the client km below).
  useEffect(() => {
    if (!userId) return
    if (!isPrivileged) return   // Phase 194 — viewer gets ta_km from the gated bundle
    let cancelled = false
    ;(async () => {
      const { data, error: e } = await supabase.from('daily_ta')
        .select('km_traveled')
        .eq('user_id', userId)
        .eq('ta_date', targetDate)
        .maybeSingle()
      if (cancelled) return
      if (!e) setTaKm(data?.km_traveled ?? null)
    })()
    return () => { cancelled = true }
  }, [userId, targetDate])

  // Total km driven, computed via filtered Haversine sum.
  //
  // Phase 34I — owner reported Kevin's 13 May actual 200-300 km drive
  // showed up as 1,300 km on this page. Root cause: this page summed
  // RAW haversine between every consecutive ping with NO filter, so:
  //   * Low-accuracy pings (cell-tower fallback indoors, ±500 m) get
  //     counted as if the rep teleported 500 m every 5 min.
  //   * GPS drift while parked (10-30 m / poll) accumulates over a
  //     full day to tens of kilometres of fake "movement".
  //   * Any single bad-fix outlier ping creates a huge spike (rep
  //     jumps from Vadodara to Anand and back in 2 min).
  //
  // Same filter thresholds as Phase 33H TA module SQL
  // (compute_daily_ta) so map display agrees with TA payouts:
  //
  //   * Discard pings with accuracy_m > 100 m (bad GPS fix).
  //   * Discard segments shorter than 30 m (drift at standstill).
  //   * Discard segments implying speed > 200 km/h (bad data /
  //     impossible bike trip).
  //   * Daily total cap at 600 km — sanity ceiling. Anything past
  //     that almost certainly = bad data.
  //
  // Raw km is exposed in the stats object too so the rep-day page
  // can show "filtered 215 km · raw 1,303 km" if needed for audit.
  const stats = useMemo(() => {
    // Phase 34Z.6 — distance logic lives in src/utils/gpsDistance.js
    // now (same function /work uses for the rep-side km chip), so
    // both views always agree. first/last captured_at stays here
    // because only this page renders them.
    const base = summariseTrack(pings)
    return {
      ...base,
      first: pings[0]?.captured_at,
      last:  pings[pings.length - 1]?.captured_at,
    }
  }, [pings])

  // Phase 179 — GPS coverage (display-only honesty metric). How much of the
  // shift the phone actually streamed GPS. End = check_out_at, or now() while the
  // shift is open. Reads pings + the work_sessions row already fetched — no query,
  // ZERO effect on km/payout (which stay on server daily_ta).
  const coverage = useMemo(
    () => coverageHours(pings, session?.check_in_at, session?.check_out_at),
    [pings, session],
  )

  // Phase 124 — the headline DISTANCE = the server daily_ta km (TA-paid),
  // falling back to the client filtered km only when daily_ta has no row
  // for this date. stats.km / stats.pings / kmRaw stay for the diagnostics.
  const displayKm = taKm != null ? Number(taKm).toFixed(1) : stats.km

  // Render the Leaflet map once pings load. Phase 32K — direct L
  // import; no CDN wrap, no failover, no error path needed.
  useEffect(() => {
    if (loading) return
    if (!containerRef.current) return
    if (pings.length === 0) return
    // Clean up any earlier map on this node (StrictMode double-mounts).
    if (mapRef.current) {
      mapRef.current = null
    }
    // Wrap async work inside a self-invoking async fn — useEffect
    // can't return a Promise directly.
    ;(async () => {
    try {
      // Phase 61.3 (19 May 2026) — owner reported the map showed
      // clusters of dots and a noisy polyline instead of a clean
      // route. Three changes:
      //   1. Polyline now uses cleanTrack() — drops accuracy outliers
      //      + sub-30m drift + speed spikes. Visualization matches
      //      the km math.
      //   2. Drop the 394 yellow interval-ping circles. Only
      //      check-in (green) + check-out (red) markers remain.
      //   3. Numbered stop markers (1, 2, 3, ...) at every place
      //      the rep stayed >= 10 minutes within an 80m radius —
      //      mirrors the reference design owner showed.
      // Phase 169 — loose clean for the LINE only (fuller drive; owner: jitter
      // OK). The km headline still reads server daily_ta (strict) — untouched.
      const cleaned = cleanTrack(pings, { accM: 200, speedKmh: 250 })
      const stops   = detectStops(pings, { radiusM: 80, minMinutes: 10 })

      // Phase 70.3 (22 May 2026) — swap Leaflet+OSM tiles for Google
      // Maps JS API. Owner: "we paid for Google Maps API, use it".
      // Free tier 10K map loads/month covers our usage. Roads API
      // snap still applies; result rendered as google.maps.Polyline
      // on top of the Google tiles.
      const MAPS_KEY = import.meta.env.VITE_GOOGLE_ROADS_KEY || ''
      if (!MAPS_KEY) {
        setError('Google Maps key missing — set VITE_GOOGLE_ROADS_KEY in Vercel env.')
        return
      }
      const loader = new Loader({
        apiKey: MAPS_KEY,
        version: 'weekly',
        // Phase 70.6 — geometry library needed for decodePath() to
        // render the Directions API encoded polyline.
        libraries: ['geometry'],
      })
      const google = await loader.load()

      const center = cleaned.length > 0
        ? { lat: Number(cleaned[0].lat), lng: Number(cleaned[0].lng) }
        : { lat: Number(pings[0].lat), lng: Number(pings[0].lng) }
      const map = new google.maps.Map(containerRef.current, {
        center,
        zoom: 13,
        // Phase 70.7 (22 May 2026) — lightened dark style so streets
        // read clearly against the dark canvas. Previous palette had
        // roads at #334155 which was almost the same value as the
        // ground (#1d2129) — owner reported "map tiles too dark, road
        // network barely visible".
        styles: DARK_MAP_STYLE,
        disableDefaultUI: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
      mapRef.current = map

      const bounds = new google.maps.LatLngBounds()

      // Phase 70.7 — raw cleaned polyline is the fallback. Drawn at low
      // opacity so the user has SOMETHING visible until the Directions
      // API result lands. Once Directions returns a real road-following
      // polyline, the raw line is removed (rawLine.setMap(null)).
      // Phase 70.10 — only render route polyline + stops in 'all' or
      // 'route' view modes. 'meetings' hides them.
      const showRoute = viewMode === 'all' || viewMode === 'route'
      const showMeetings = viewMode === 'all' || viewMode === 'meetings'
      let rawLine = null
      if (showRoute && cleaned.length >= 2) {
        const path = cleaned.map(p => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
        }))
        path.forEach(pt => bounds.extend(pt))
        rawLine = new google.maps.Polyline({
          path,
          strokeColor:    '#FFE600',
          strokeOpacity:  0.45,
          strokeWeight:   3,
          map,
        })
        map.fitBounds(bounds, 60)

        // Phase 70.6 (22 May 2026) — owner reported "still direct line".
        // Real cause: 46 raw pings cluster at 2-3 spots (rep had GPS at
        // checkin + parked + checkout, missed in-vehicle travel pings).
        // Roads API snapToRoads can't reconstruct a 7km route from 2
        // distinct geographic points; interpolate=true only works for
        // points along the same road.
        //
        // Switch to Directions API via a server-side proxy
        // (/api/directions). Server proxy avoids the Chrome
        // referrer-policy block that hits client-side Roads API calls
        // restricted by Websites referers. Server key is stored in
        // Vercel env as ROADS_KEY_SERVER (no VITE_ prefix → never in
        // client bundle).
        //
        // Strategy:
        //   • origin      = first raw ping (check-in)
        //   • destination = last raw ping (check-out)
        //   • waypoints   = up to 8 intermediate stop centroids (from
        //                   detectStops) so the route hits where the
        //                   rep actually parked, not just start→end
        //
        // Directions API returns the encoded polyline; we decode via
        // google.maps.geometry.encoding.decodePath().
        const ACC_LOOSE = 200
        const sortedRaw = pings
          .filter(p => {
            const a = Number(p.accuracy_m)
            return !Number.isFinite(a) || a <= ACC_LOOSE
          })
          .slice()
          .sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at))

        if (sortedRaw.length >= 2) {
          const origin = sortedRaw[0]
          const dest   = sortedRaw[sortedRaw.length - 1]
          const wayPts = (stops || [])
            .slice(0, 8)
            .map(s => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`)
            .join('|')
          const qs = new URLSearchParams({
            origin:      `${Number(origin.lat).toFixed(6)},${Number(origin.lng).toFixed(6)}`,
            destination: `${Number(dest.lat).toFixed(6)},${Number(dest.lng).toFixed(6)}`,
            mode:        'driving',
          })
          if (wayPts) qs.set('waypoints', wayPts)

          // Need google.maps.geometry to decode polyline.
          const geometry = await google.maps.importLibrary
            ? await google.maps.importLibrary('geometry')
            : null
          // (older API: geometry library loaded via `libraries: ['geometry']`
          // in Loader. We add it below if importLibrary not available.)

          // Phase 85.3.1 — drop the JWT bearer header that Phase 85.3
          // added. /api/directions is now guarded same-origin +
          // rate-limit instead, which keeps Google billing safe
          // without depending on a still-valid Supabase session.
          // Symptom that motivated the revert: expired PWA session
          // → getSession() returned null → silent bail → only the
          // raw 2-3 point line painted, owner saw "straight line".
          fetch(`/api/directions?${qs.toString()}`)
            .then(r => r.ok ? r.json() : null)
            .then(json => {
              if (!mapRef.current) return
              if (!json?.polyline) return
              let decoded = null
              try {
                if (geometry?.encoding?.decodePath) {
                  decoded = geometry.encoding.decodePath(json.polyline)
                } else if (google.maps.geometry?.encoding?.decodePath) {
                  decoded = google.maps.geometry.encoding.decodePath(json.polyline)
                }
              } catch (_) { /* fall through */ }
              if (!decoded || decoded.length < 2) return
              new google.maps.Polyline({
                path: decoded,
                strokeColor:   '#FFE600',
                strokeOpacity: 1,
                strokeWeight:  6,
                map: mapRef.current,
              })
              // Phase 70.7 — remove the raw fallback line now that the
              // road-snapped polyline is on the map.
              if (rawLine) {
                try { rawLine.setMap(null) } catch { /* swallow */ }
              }
            })
            .catch(() => { /* raw line stays as fallback */ })
        }
      } else if (cleaned.length === 1) {
        map.setCenter(center)
        map.setZoom(14)
      }

      // Check-in + check-out markers.
      const first = pings[0]
      const last  = pings[pings.length - 1]
      // Phase 70.10 (22 May 2026) — Material "place" pin shape with an
      // inner hole (even-odd fill rule) so the inside reads white on
      // light tiles. Brand-aligned: dark navy stroke matches --v2-bg-0.
      // Owner: "pin not aligned with our brand".
      const PIN_PATH = 'M 0,0 c -4.5,-7.5 -10.5,-14.25 -10.5,-19.5 a 10.5,10.5 0 1,1 21,0 c 0,5.25 -6,12 -10.5,19.5 z m 0,-26.25 a 3.75,3.75 0 1,0 0,7.5 a 3.75,3.75 0 1,0 0,-7.5 z'
      const pinIcon = (color) => ({
        path:           PIN_PATH,
        fillColor:      color,
        fillOpacity:    1,
        strokeColor:    '#0f172a',
        strokeWeight:   1.5,
        scale:          1.4,
        anchor:         new google.maps.Point(0, 0),
        labelOrigin:    new google.maps.Point(0, -20),
      })
      // Phase 121 — round dot for check-in / check-out / stops, so the
      // teardrop PIN is reserved for MEETINGS only (owner: "i am unable
      // to find which is lead pin or checkin/checkout"). Meetings now pop
      // as the only teardrops on the map. scale = circle radius (px);
      // labelOrigin centred so a stop number sits inside the dot.
      const circleIcon = (color, scale = 8) => ({
        path:           google.maps.SymbolPath.CIRCLE,
        fillColor:      color,
        fillOpacity:    1,
        strokeColor:    '#0f172a',
        strokeWeight:   1.5,
        scale,
        anchor:         new google.maps.Point(0, 0),
        labelOrigin:    new google.maps.Point(0, 0),
      })
      if (first) {
        const m1 = new google.maps.Marker({
          position: { lat: Number(first.lat), lng: Number(first.lng) },
          map,
          icon: circleIcon('#10B981', 12),   // Phase 121 — check-in = round dot (bigger than stop)
        })
        const iw1 = new google.maps.InfoWindow({
          // Phase 89.5 — light text for dark InfoWindow chrome.
          content: `<div style="font-family:'DM Sans','Inter',sans-serif;color:#f5f7fb;font-size:13px;"><b style="color:#10B981">Check-in</b><br/><span style="color:#cbd5e1">${new Date(first.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></div>`,
        })
        m1.addListener('click', () => iw1.open({ anchor: m1, map }))
      }
      if (last && last !== first) {
        const m2 = new google.maps.Marker({
          position: { lat: Number(last.lat), lng: Number(last.lng) },
          map,
          icon: circleIcon('#EF4444', 12),   // Phase 121 — check-out = round dot (bigger than stop)
        })
        const iw2 = new google.maps.InfoWindow({
          // Phase 89.5 — light text for dark InfoWindow chrome.
          content: `<div style="font-family:'DM Sans','Inter',sans-serif;color:#f5f7fb;font-size:13px;"><b style="color:#EF4444">Check-out</b><br/><span style="color:#cbd5e1">${new Date(last.captured_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></div>`,
        })
        m2.addListener('click', () => iw2.open({ anchor: m2, map }))
      }

      // Phase 70.8 (22 May 2026) — owner directive: punched meetings
      // show on the day-track map with a blue pin + lead name.
      //
      // Phase 84.2 (23 May 2026) — owner reported "did 3 meetings but
      // map shows only 1 pin". Root cause: the old filter required
      // `a.lead?.id`. Meetings logged from a voice note + meetings
      // saved without a linked lead were dropped entirely. New rule:
      // require GPS coords only. Unlinked meetings render with a
      // grey pin + "(no lead)" caption so admin sees the activity
      // count match the timeline.
      const meetingActs = showMeetings
        ? (activities || []).filter(a =>
            (a.activity_type === 'meeting' || a.activity_type === 'site_visit')
            && Number.isFinite(Number(a.gps_lat))
            && Number.isFinite(Number(a.gps_lng))
            && !isAutoCheckinRow(a) // Phase 93.6 — drop companion rows
          )
        : []
      for (const a of meetingActs) {
        const hasLead  = !!a.lead?.id
        // Phase 89.4 — pin colour tracks the meeting outcome so admin
        // can read the field map at a glance. Owner-locked meeting
        // outcome model is the 3-state set from LogMeetingModal
        // (Phase 33A): positive / neutral / negative. No callback
        // here — that's a call-only outcome. Default blue covers
        // legacy rows where outcome was never written.
        const pinColor = (() => {
          if (!hasLead) return '#94A3B8'  // unlinked meeting stays slate
          switch (a.outcome) {
            case 'positive': return '#10B981'
            case 'neutral':  return '#F59E0B'
            case 'negative': return '#EF4444'
            default:         return '#3B82F6'  // pre-Phase-89.4 / outcome missing
          }
        })()
        const m = new google.maps.Marker({
          position: { lat: Number(a.gps_lat), lng: Number(a.gps_lng) },
          map,
          icon: pinIcon(pinColor),
        })
        // Phase 85.2 — escape user-supplied fields before HTML
        // string-concat. Audit caught XSS: lead.company / lead.name
        // were injected unescaped into the InfoWindow content. A
        // lead named `<img src=x onerror=alert(1)>` (possible via
        // CSV import) would execute JS in the admin browser on
        // pin click. Notes had partial escape; lead name + outcome
        // chip CSS branches were also unescaped.
        const esc = (v) => String(v ?? '')
          .replace(/&/g,  '&amp;')
          .replace(/</g,  '&lt;')
          .replace(/>/g,  '&gt;')
          .replace(/"/g,  '&quot;')
          .replace(/'/g,  '&#39;')
        const rawLeadName = hasLead ? (a.lead.company || a.lead.name || 'Lead') : '(unlinked meeting)'
        const leadName    = esc(rawLeadName)
        // leadHref built from UUID `a.lead.id` (PG-validated UUID, safe)
        const leadHref  = hasLead ? `/leads/${a.lead.id}` : null
        const timeLabel = esc(new Date(a.created_at).toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit',
          timeZone: 'Asia/Kolkata',
        }))
        const typeChip  = a.activity_type === 'site_visit' ? 'Site visit' : 'Meeting'
        const outcome   = a.outcome === 'positive' || a.outcome === 'negative' || a.outcome === 'neutral'
          ? a.outcome
          : null  // whitelist — never inject arbitrary outcome strings
        // Phase 89.5 — brand palette on the InfoWindow content.
        // The Google chrome is now dark (v2.css .gm-style-iw-c
        // override), so inline text colours flip to the light end
        // of the v2 ink ladder.
        const outcomeChip = outcome
          ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${outcome==='positive'?'rgba(16,185,129,.18)':outcome==='negative'?'rgba(239,68,68,.18)':'rgba(245,158,11,.18)'};color:${outcome==='positive'?'#34d399':outcome==='negative'?'#f87171':'#fbbf24'};">${esc(outcome)}</span>`
          : ''

        const linkHtml = hasLead
          ? `<a href="${esc(leadHref)}" data-lead-id="${esc(a.lead.id)}" style="color:#f5f7fb;font-weight:700;font-size:14px;text-decoration:none;border-bottom:2px solid #FFE600;padding-bottom:2px;display:inline-block;">${leadName}</a>`
          : `<span style="color:#98a4bf;font-weight:600;font-size:13px;">${leadName}</span>`

        const noteHtml = a.notes
          ? `<div style="margin-top:8px;font-size:11px;color:#cbd5e1;line-height:1.4;max-width:240px;">${esc(a.notes).slice(0, 600)}</div>`
          : ''

        const iw = new google.maps.InfoWindow({
          content:
            `<div style="font-family:'DM Sans','Inter',-apple-system,BlinkMacSystemFont,sans-serif;min-width:200px;max-width:260px;">`
          + `<div style="font-size:9.5px;color:#98a4bf;letter-spacing:.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">${typeChip} · ${timeLabel} IST${outcomeChip}</div>`
          + linkHtml
          + noteHtml
          + `</div>`,
        })
        if (hasLead) {
          // Intercept the link click so we use React Router navigation
          // (avoids full-page reload).
          iw.addListener('domready', () => {
            const link = document.querySelector(`a[data-lead-id="${a.lead.id}"]`)
            if (link) {
              link.addEventListener('click', (ev) => {
                ev.preventDefault()
                navigate(leadHref)
              })
            }
          })
        }
        m.addListener('click', () => iw.open({ anchor: m, map }))
      }

      // Numbered stop pins — same teardrop shape; label sits inside
      // the pin head via labelOrigin. Hidden in 'meetings' view.
      const stopsToShow = showRoute ? stops : []
      for (const s of stopsToShow) {
        const m = new google.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map,
          label: {
            text: String(s.id),
            color: '#ffffff',
            fontWeight: '700',
            fontSize: '12px',
          },
          icon: circleIcon('#64748b', 9),   // Phase 121 — stop = round slate dot (smaller than check-in/out)
        })
        const iw = new google.maps.InfoWindow({
          // Phase 89.5 — light text for dark InfoWindow chrome.
          content:
            `<div style="font-family:'DM Sans','Inter',sans-serif;color:#f5f7fb;font-size:13px;">` +
            `<b style="color:#FFE600">Stop ${s.id}</b><br/>` +
            `<span style="color:#cbd5e1">${new Date(s.started_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} ` +
            `– ${new Date(s.ended_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span><br/>` +
            `<small style="color:#98a4bf">${s.minutes} min dwell</small></div>`,
        })
        m.addListener('click', () => iw.open({ anchor: m, map }))
      }
    } catch (e) {
      setError('Map render failed: ' + (e?.message || String(e)))
    }
    })()
    // Google Maps doesn't expose a .remove() like Leaflet; clearing
    // mapRef is enough — React unmounts the container and GC handles
    // the rest.
    return () => {
      mapRef.current = null
    }
  }, [loading, pings, activities, viewMode])

  if (!isPrivileged && !canViewTeam) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        Admin / co-owner access only.
      </div>
    )
  }

  return (
    <div className="lead-root" style={{ padding: 16 }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontSize: 12, marginBottom: 12, cursor: 'pointer',
        }}
      >
        <ArrowLeft size={12} /> Back
      </button>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 16,
        alignItems: 'flex-start', marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
            Rep day track
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>
            {user?.name || '—'}
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
              {user?.team_role || user?.role || ''}
              {user?.city ? ` · ${user.city}` : ''}
            </span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            {formatDate(targetDate)}
            {/* Phase 90.2 — date picker. Owner: "when we enter in
                traking of person not showing date filter inside".
                Lets admin scroll back through past days without
                touching the URL. Capped at 90 days back to keep
                queries fast. */}
            <input
              type="date"
              value={targetDate}
              max={new Date().toISOString().slice(0, 10)}
              min={new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              onChange={(e) => {
                const next = e.target.value
                if (next) navigate(`/admin/gps/${userId}/${next}`)
              }}
              style={{
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 8,
                padding: '4px 8px', fontSize: 12, fontFamily: 'inherit',
                colorScheme: 'dark',
              }}
            />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
            Distance
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--accent, #FFE600)' }}>
            {displayKm} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>km</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {stats.pings} pings
            {stats.pings !== stats.usablePings && ` · ${stats.pings - stats.usablePings} low-accuracy dropped`}
          </div>
          {/* Phase 34I — show raw vs filtered so owner can audit
              drift. Hidden unless they diverge by 10%+. */}
          {stats.kmRaw && Math.abs(Number(stats.kmRaw) - Number(stats.km)) > Number(stats.km) * 0.1 && (
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
              raw {stats.kmRaw} km · {stats.droppedSegs} drift/spike segments dropped
              {stats.capped ? ' · capped at 600 km' : ''}
            </div>
          )}
          {/* Phase 179 — GPS coverage. A low % means the phone stopped sending GPS
              during the shift (dark windows) — the km is low because tracking was
              off, not because the rep didn't move. Display-only; never feeds km. */}
          {coverage.shiftH > 0.15 && (
            <div style={{
              fontSize: 11, marginTop: 4, fontWeight: 600,
              color: coverage.pct >= 80 ? 'var(--success)'
                : coverage.pct >= 50 ? 'var(--warning)' : 'var(--danger)',
            }}>
              GPS tracked {coverage.trackedH.toFixed(1)}h of {coverage.shiftH.toFixed(1)}h shift ({coverage.pct}%)
              {coverage.pct < 60 ? ' — km undercounts while GPS is off' : ''}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: 'var(--danger-soft)', border: '1px solid var(--danger)',
          color: 'var(--danger)', borderRadius: 8, padding: '10px 14px',
          fontSize: 13, marginBottom: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading track…
        </div>
      ) : pings.length === 0 ? (
        <div style={{
          padding: 48, textAlign: 'center', color: 'var(--text-muted)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12,
        }}>
          <MapPin size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>No GPS pings recorded for {formatDate(targetDate)}.</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            The rep may have been off the /work tab or denied location permission.
          </div>
        </div>
      ) : (
        <>
          {/* Phase 70.10 — view-mode toggle. 3-way chip group: All /
              Route only / Meetings only. Lets admin focus the map on
              just where the rep met clients (Meetings only) without
              the noisy GPS route + stop pins. */}
          <div style={{
            display: 'inline-flex', gap: 4, marginBottom: 10,
            padding: 4, background: 'var(--v2-bg-2)',
            border: '1px solid var(--v2-line)',
            borderRadius: 10,
          }}>
            {[
              { key: 'all',      label: 'All' },
              { key: 'route',    label: 'Route only' },
              { key: 'meetings', label: `Meetings · ${uniqueMeetingCount(activities, true)}` },
            ].map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setViewMode(opt.key)}
                style={{
                  background: viewMode === opt.key ? 'var(--accent, #FFE600)' : 'transparent',
                  color:      viewMode === opt.key ? 'var(--accent-fg, #0f172a)' : 'var(--text)',
                  border:     'none',
                  padding:    '6px 14px',
                  borderRadius: 8,
                  fontSize:   12,
                  fontWeight: 600,
                  cursor:     'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Phase 84.2 — explain when KPI counts diverge from map pins.
              If counters.meetings > meetings-with-GPS coords, there's
              at least one meeting logged without a captured location.
              Banner saves the admin from thinking pins are missing. */}
          {(() => {
            const meetingTotalToday = activities.filter(a => (a.activity_type === 'meeting' || a.activity_type === 'site_visit') && !isAutoCheckinRow(a) && !isScheduledMeetingRow(a)).length
            const meetingWithGps    = activities.filter(a => (a.activity_type === 'meeting' || a.activity_type === 'site_visit') && a.gps_lat && a.gps_lng && !isAutoCheckinRow(a) && !isScheduledMeetingRow(a)).length
            const noGpsCount        = meetingTotalToday - meetingWithGps
            if (noGpsCount <= 0) return null
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', marginBottom: 10,
                background: 'var(--warning-soft, rgba(245,158,11,.12))',
                border: '1px solid var(--warning, #F59E0B)',
                borderRadius: 8,
                fontSize: 12, color: 'var(--warning, #F59E0B)',
              }}>
                <span>
                  <b>{noGpsCount}</b> meeting{noGpsCount === 1 ? '' : 's'} logged without GPS. Map shows {meetingWithGps} of {meetingTotalToday} on the map; the rest appear only in the activity timeline below.
                </span>
              </div>
            )
          })()}

          <div
            ref={containerRef}
            style={{
              width: '100%', height: '60vh', minHeight: 420,
              borderRadius: 12, overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          />
          <div style={{
            display: 'flex', gap: 16, marginTop: 12, fontSize: 12,
            color: 'var(--text-muted)', flexWrap: 'wrap',
          }}>
            <span><span style={{ color: '#10B981' }}>●</span> Check-in {stats.first ? new Date(stats.first).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <span><span style={{ color: '#EF4444' }}>●</span> Check-out {stats.last ? new Date(stats.last).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
            <span><span style={{ color: '#64748b' }}>●</span> Stop (parked ≥10 min)</span>
            <span><span style={{ color: '#F59E0B' }}>●</span> Interval pings (every ~5 min while /work was open)</span>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Teardrop pin = meeting (colour = outcome)</span>
          </div>
        </>
      )}

      {/* Phase 32E — rep-day view extras: counters + activity timeline +
          voice logs. Owner directive: clicking a rep card on Team Live
          should give the FULL day picture, not just the GPS map. */}
      {!loading && (
        <RepDaySections
          session={session}
          activities={activities}
          voiceLogs={voiceLogs}
          gpsOffEvents={gpsOffEvents}
          networkOffEvents={networkOffEvents}
          callBreakdown={callBreakdown}
          callRows={callRows}
          navigate={navigate}
        />
      )}
    </div>
  )
}

/* Phase 32E — extracted into a sub-component so the main render
   stays readable. Renders three stacked sections: today's counters
   from work_sessions.daily_counters, the lead-activities timeline
   (scoped to this rep + this day), and voice logs filed today. */
// Phase 117 — one collapsible call-history table for a given set of rows.
// Used twice: "Lead calls" (rows tied to a saved lead) and "Unknown
// numbers" (rows the rep dialled with no lead_id). In the unknown group
// the number renders as a tap-to-call tel: link so the owner can reach
// out / decide to add it as a lead.
function CallHistorySection({ title, sub, rows, navigate, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!rows || rows.length === 0) return null
  return (
    <div className="lead-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="lead-card-head"
        style={{
          width: '100%', background: 'transparent', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '14px 16px',
          color: 'inherit', textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <div>
          <div className="lead-card-title">{title}</div>
          <div className="lead-card-sub">{open ? 'Tap to hide' : sub}</div>
        </div>
        {open
          ? <ChevronUp size={18} strokeWidth={1.6} style={{ color: 'var(--text-muted)' }} />
          : <ChevronDown size={18} strokeWidth={1.6} style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Direction', 'Lead / phone', 'Duration', 'Outcome', 'Note'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 12px',
                    fontSize: 10, letterSpacing: '.12em',
                    textTransform: 'uppercase', color: 'var(--text-muted)',
                    fontWeight: 700,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const dir = c.direction || 'outgoing'
                const dirColor = dir === 'missed'   ? 'var(--danger)'
                               : dir === 'incoming' ? 'var(--blue)'
                               : 'var(--text-muted)'
                const d = c.duration_seconds
                const durStr = d == null ? '—'
                              : d === 0    ? '0s'
                              : d < 60     ? `${d}s`
                              : `${Math.floor(d/60)}m ${d%60}s`
                const qualified = d != null && d >= 10
                const isTapAudit = (c.notes || '').startsWith('tel-tap audit')
                  && (c.duration_seconds == null || c.duration_seconds === 0)
                const hasLead = !!c.lead?.id
                const dialable = (c.client_phone || '').replace(/[^0-9+]/g, '')
                return (
                  <tr
                    key={c.id}
                    onClick={() => hasLead && navigate(`/leads/${c.lead.id}`)}
                    style={{
                      borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.04))',
                      cursor: hasLead ? 'pointer' : 'default',
                      opacity: isTapAudit ? 0.45 : 1,
                    }}
                  >
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                      {new Date(c.call_at).toLocaleTimeString('en-IN', {
                        hour: '2-digit', minute: '2-digit', hour12: false,
                        timeZone: 'Asia/Kolkata',
                      })}
                    </td>
                    <td style={{ padding: '8px 12px', color: dirColor, textTransform: 'capitalize', fontWeight: 600 }}>
                      {dir}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {hasLead
                        ? (c.lead.company || c.lead.name || '—')
                        : (dialable
                            ? <a
                                href={`tel:${dialable}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: 600 }}
                              >{c.client_phone}</a>
                            : '—')}
                    </td>
                    <td style={{
                      padding: '8px 12px', whiteSpace: 'nowrap',
                      color: qualified ? 'var(--success)' : 'var(--text-muted)',
                      fontWeight: qualified ? 600 : 400,
                    }}>
                      {durStr}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
                      {c.outcome || '—'}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-subtle)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.notes || ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RepDaySections({ session, activities, voiceLogs, gpsOffEvents = [], networkOffEvents = [], callBreakdown = { total: 0, missed: 0, noAnswer: 0, short: 0, qualified: 0, connectedQualified: 0 }, callRows = [], navigate }) {
  const counters = session?.daily_counters || {}
  const checkIn  = session?.check_in_at
  const checkOut = session?.check_out_at
  // Phase 90.3 — owner: "i need hid and open opron — if i arrow
  // down only open call history". Collapsed by default; click
  // header → toggle. Saves vertical space (39+ rows pushed timeline
  // below the fold).
  // Phase 117 — call-history open state moved into CallHistorySection
  // (one per group: Lead calls + Unknown numbers).
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
      {/* Counters strip */}
      {(checkIn || activities.length > 0) && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}>
          <RepDayStat label="Check-in"  value={checkIn  ? new Date(checkIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'} />
          <RepDayStat label="Check-out" value={checkOut ? new Date(checkOut).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Open'} tone={checkOut ? '' : 'warn'} />
          {/* Phase 84.3 — Meetings KPI now derived from the SAME
              filter that drives the blue map pins (activity_type
              meeting/site_visit + GPS coords). counters.meetings
              was reading from work_sessions.daily_counters which
              also bumped on check-in / interval pings / other
              non-meeting taps — owner reported KPI=3 with only 1
              location pin. The blue-pin count is the truth. */}
          <RepDayStat label="Meetings" value={uniqueMeetingCount(activities, true)} />
          {/* Phase 76.2.2 — single Qualified KPI in the strip (matches
              the 10s rule applied everywhere else). Full breakdown
              rendered as its own card below the strip so admin can
              see WHY qualified count is lower than total (misdials +
              shorts get filtered). */}
          <RepDayStat label="New leads" value={counters.new_leads || 0} />
          {/* Phase 121.1 — dropped "Qualified calls" (repeats in the Call
              breakdown below) + "Voice notes" (redundant) per owner. */}
        </div>
      )}

      {/* Phase 76.2.2 — Call breakdown card. Owner directive
          2026-05-23: KPI = qualified (>=10s) but admin should also
          see total / missed / short so the gap is explainable.
          Connected-qualified is "real conversation" (rep saved
          PostCallOutcomeModal with positive/neutral/negative). */}
      {callBreakdown.total > 0 && (
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Call breakdown — today</div>
              <div className="lead-card-sub">
                Qualified = lead call ≥ 10 sec. "Other ≥10s" = real calls to numbers not saved as leads (not counted as work).
              </div>
            </div>
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 10, padding: 16,
          }}>
            <RepDayStat label="Total tel-taps"   value={callBreakdown.total} />
            {/* Phase 90.2 — split missed (inbound, rep didn't pick)
                from no-answer (rep called, no pickup). Was one
                combined tile. */}
            <RepDayStat label="Missed (inbound)" value={callBreakdown.missed}
                        tone={callBreakdown.missed > 0 ? 'danger' : ''} />
            <RepDayStat label="No answer (outbound)" value={callBreakdown.noAnswer}
                        tone={callBreakdown.noAnswer > 0 ? 'danger' : ''} />
            <RepDayStat label="Below 10 sec"      value={callBreakdown.short}
                        tone={callBreakdown.short > 0 ? 'warn' : ''} />
            <RepDayStat label="Qualified (lead ≥10s)"  value={callBreakdown.qualified}
                        tone={callBreakdown.qualified > 0 ? 'success' : ''} />
            <RepDayStat label="Connected of qualified" value={callBreakdown.connectedQualified}
                        tone={callBreakdown.connectedQualified > 0 ? 'success' : ''} />
            <RepDayStat label="Other ≥10s (non-lead)" value={callBreakdown.qualifiedOther || 0}
                        tone={callBreakdown.qualifiedOther > 0 ? 'warn' : ''} />
            <RepDayStat label="Unverified connected" value={callBreakdown.unverifiedConnected || 0}
                        tone={callBreakdown.unverifiedConnected > 0 ? 'danger' : ''} />
          </div>
        </div>
      )}

      {/* Phase 90.2 — Per-call history table. Owner: "i cant see my
          called of that particular person, should we get it in
          dashboard when we open that perosn traking page?". Lists
          every call_logs row for this rep+day.
          Phase 90.3 — collapsible. Header is a button; chevron
          toggles. Closed by default to keep page short. */}
      {callRows.length > 0 && (() => {
        // Phase 117 — split the day's calls into (1) calls tied to a saved
        // lead and (2) unknown numbers the rep dialled that aren't in the
        // system, so the owner can chase / add the unknowns. The unknown
        // section defaults open and its numbers are tap-to-call links.
        const leadCalls    = callRows.filter(c => c.lead?.id)
        const unknownCalls = callRows.filter(c => !c.lead?.id)
        return (
          <>
            <CallHistorySection
              title={`Lead calls · ${leadCalls.length}`}
              sub="Tap to show calls tied to a saved lead"
              rows={leadCalls}
              navigate={navigate}
            />
            <CallHistorySection
              title={`Unknown numbers · ${unknownCalls.length}`}
              sub="Numbers dialled but NOT saved as leads — tap a number to call"
              rows={unknownCalls}
              navigate={navigate}
            />
          </>
        )
      })()}

      {/* Activity timeline — Phase 84.5 merges gps_off_events inline. */}
      {(() => {
        function fmtDur(s) {
          if (s == null || !Number.isFinite(s) || s <= 0) return '—'
          const m = Math.floor(s / 60), sec = Math.floor(s % 60)
          if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
          if (m > 0)   return `${m}m ${sec}s`
          return `${sec}s`
        }
        const tl = [
          ...activities.map(a => ({
            kind: 'activity',
            ts:   new Date(a.created_at).getTime(),
            raw:  a,
          })),
          ...gpsOffEvents.map(e => ({
            kind: 'gps_off',
            ts:   new Date(e.toggled_off_at).getTime(),
            raw:  e,
          })),
          ...networkOffEvents.map(e => ({
            kind: 'network_off',
            ts:   new Date(e.lost_at).getTime(),
            raw:  e,
          })),
        ].sort((a, b) => b.ts - a.ts)

        return (
          <div className="lead-card">
            <div className="lead-card-head">
              <div>
                <div className="lead-card-title">Activity timeline · {tl.length}</div>
                <div className="lead-card-sub">
                  Calls · WhatsApp · meetings · notes · GPS-off · internet-off events
                </div>
              </div>
            </div>
            {tl.length === 0 ? (
              <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                No activities logged on this date.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {tl.map(item => {
                  if (item.kind === 'gps_off') {
                    const e = item.raw
                    const t  = new Date(e.toggled_off_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                    const onT = e.toggled_on_at
                      ? new Date(e.toggled_on_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                      : null
                    return (
                      <div
                        key={`gpsoff-${e.id}`}
                        style={{
                          padding: '10px 14px',
                          borderTop: '1px solid var(--border)',
                          background: 'var(--danger-soft, rgba(239,68,68,.08))',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 11,
                            color: 'var(--text-muted)', minWidth: 44,
                          }}>{t}</span>
                          <span style={{
                            fontWeight: 700,
                            color: 'var(--danger, #EF4444)',
                            letterSpacing: '.04em',
                            textTransform: 'uppercase',
                            fontSize: 12,
                          }}>GPS turned off</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            duration {fmtDur(e.duration_seconds)}
                            {onT ? ` · back on at ${onT}` : ' · still off'}
                          </span>
                        </div>
                      </div>
                    )
                  }
                  if (item.kind === 'network_off') {
                    const e = item.raw
                    const t  = new Date(e.lost_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                    const onT = e.regained_at
                      ? new Date(e.regained_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                      : null
                    return (
                      <div
                        key={`netoff-${e.id}`}
                        style={{
                          padding: '10px 14px',
                          borderTop: '1px solid var(--border)',
                          background: 'var(--warning-soft, rgba(245,158,11,.08))',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 11,
                            color: 'var(--text-muted)', minWidth: 44,
                          }}>{t}</span>
                          <span style={{
                            fontWeight: 700,
                            color: 'var(--warning, #F59E0B)',
                            letterSpacing: '.04em',
                            textTransform: 'uppercase',
                            fontSize: 12,
                          }}>Internet off</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            duration {fmtDur(e.duration_seconds)}
                            {onT ? ` · back on at ${onT}` : ' · still off'}
                          </span>
                        </div>
                      </div>
                    )
                  }
                  // activity
                  const a = item.raw
                  const t = new Date(a.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <div
                      key={a.id}
                      onClick={() => a.lead?.id && navigate(`/leads/${a.lead.id}`)}
                      style={{
                        cursor: a.lead?.id ? 'pointer' : 'default',
                        padding: '10px 14px',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 11,
                          color: 'var(--text-muted)', minWidth: 44,
                        }}>{t}</span>
                        <span style={{
                          fontWeight: 700, color: 'var(--text)',
                          textTransform: 'capitalize',
                        }}>{a.activity_type}</span>
                        {a.outcome && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '.08em',
                            textTransform: 'uppercase',
                            color: a.outcome === 'positive' ? 'var(--success)'
                                  : a.outcome === 'negative' ? 'var(--danger)' : 'var(--text-muted)',
                          }}>{a.outcome}</span>
                        )}
                        <span style={{ color: 'var(--text-muted)' }}>
                          → {a.lead?.company || a.lead?.name || '—'}
                        </span>
                      </div>
                      {a.notes && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 52, lineHeight: 1.5 }}>
                          {a.notes.slice(0, 200)}{a.notes.length > 200 ? '…' : ''}
                        </div>
                      )}
                      {a.next_action && (
                        <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, marginLeft: 52 }}>
                          Next: {a.next_action}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* Voice logs */}
      {voiceLogs.length > 0 && (
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Voice notes · {voiceLogs.length}</div>
              <div className="lead-card-sub">Recordings filed today</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {voiceLogs.map(v => {
              const t = new Date(v.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
              const lang = v.language_detected ? String(v.language_detected).toUpperCase() : ''
              const snippet = (v.transcript || '').trim().slice(0, 160)
              return (
                <div
                  key={v.id}
                  onClick={() => v.lead?.id && navigate(`/leads/${v.lead.id}`)}
                  style={{
                    cursor: v.lead?.id ? 'pointer' : 'default',
                    padding: '10px 14px',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11,
                      color: 'var(--text-muted)', minWidth: 44,
                    }}>{t}</span>
                    {lang && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.08em',
                        color: 'var(--accent)',
                        background: 'var(--accent-soft)',
                        padding: '1px 6px', borderRadius: 999,
                      }}>{lang}</span>
                    )}
                    <span style={{ color: 'var(--text-muted)' }}>
                      → {v.lead?.company || v.lead?.name || '—'}
                    </span>
                  </div>
                  {snippet && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginLeft: 52, lineHeight: 1.5 }}>
                      {snippet}{v.transcript && v.transcript.length > 160 ? '…' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Morning plan reference */}
      {session?.morning_plan_text && (
        <details className="lead-card" style={{ padding: '10px 14px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Morning plan
          </summary>
          <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {session.morning_plan_text}
          </div>
        </details>
      )}
    </div>
  )
}

function RepDayStat({ label, value, tone }) {
  // Phase 76.2.2 — extended tone palette for the call breakdown card.
  // success = green (good outcome), danger = red (bad bucket), warn
  // = amber (caution). All read from design-system tokens.
  const color = tone === 'warn'    ? 'var(--warning)'
              : tone === 'success' ? 'var(--success)'
              : tone === 'danger'  ? 'var(--danger)'
              : 'var(--text)'
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border-strong, #475569)',
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{
        fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
        color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: 18, color,
      }}>
        {value}
      </div>
    </div>
  )
}
