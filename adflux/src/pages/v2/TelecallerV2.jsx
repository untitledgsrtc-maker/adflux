// src/pages/v2/TelecallerV2.jsx
//
// Phase 16 commit 6 — Telecaller dashboard, ported in-place from
// _design_reference/Leads/lead-modals-mobile.jsx (TelecallerDash).
//
// Layout (matches design):
//   • AI briefing slim card (real signal: hottest idle lead)
//   • Hero "Next call" card — teal gradient, big avatar with heat dot,
//     name + company + phone + city + source + last contact + Call now
//   • 4 KPI cards: Today's calls / Qualified today / Open queue / Pending hand-offs
//   • Two columns: Pending hand-offs (with SLA pill) | Call queue
//
// Real-data wiring:
//   • Queue: leads where telecaller_id = me AND stage NOT IN
//     (Won, Lost, SalesReady, QuoteSent, Negotiating, MeetingScheduled),
//     sorted by heat (hot first) then last_contact_at ascending
//   • Today's calls from call_logs count
//   • Qualified today = leads where qualified_at OR sales_ready_at today
//   • Pending hand-offs = leads I qualified, now SalesReady, sorted by SLA

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Phone, ArrowRight, MapPin, Clock, Plus, Loader2,
  MessageSquare, ChevronRight, ChevronDown, FileText,
  PhoneCall, CheckCircle2, Users, Receipt,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatDate, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, HeatPicker, SegChip, LeadAvatar, Pill,
} from '../../components/leads/LeadShared'
import V2Hero from '../../components/v2/V2Hero'
// Phase 83 — evening day summary card. Additive only; same pattern
// as WorkV2 mount from Phase 76.4. Card has its own 7 PM IST gate +
// role gate so admin / co_owner don't see it.
import DaySummaryCard from '../../components/work/DaySummaryCard'
import MorningGreetGate from '../../components/work/MorningGreetGate'
import EveningWrapBanner from '../../components/work/EveningWrapBanner'
// Phase 113.7 — MissedCallsCard + RepMapPanel mounts removed from the TC
// Today page per owner (declutter). Missed-call rescue was padded by the
// tel-tap audit rows (every Call tap logs a no_answer call_logs row); the
// field map is N/A for a phone rep. Both components stay in use on WorkV2 —
// only the TC imports + mounts are dropped.
// Phase 43.1 — parity with WorkV2 + LeadDetailV2 call chain. Tel-tap
// audit + post-call outcome capture + auto-refresh.
import PostCallOutcomeModal from '../../components/leads/PostCallOutcomeModal'
import PendingOutcomesCard from '../../components/leads/PendingOutcomesCard'
import { logCallAudit } from '../../utils/callAudit'
import { markCallStart } from '../../utils/callTimer'
import { rememberPendingCall, attachPendingActivityId, readPendingCall, clearPendingCall } from '../../utils/pendingCall'
import { dialPhone } from '../../utils/openExternal'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { pushToast } from '../../components/v2/Toast'
// Phase 47.1 — WhatsApp 1-click send.
import WhatsAppSendModal from '../../components/leads/WhatsAppSendModal'
// Phase 113.8 — post-call WhatsApp follow-up prompt (parity with /work).
import WhatsAppPromptModal from '../../components/leads/WhatsAppPromptModal'
// Phase 285 — after >5 calls to one lead, suggest handing it off.
import ReassignSuggestModal from '../../components/leads/ReassignSuggestModal'
import ReassignModal from '../../components/leads/ReassignModal'
import { checkReassignNudge, dismissReassignNudge } from '../../utils/reassignNudge'

function cleanPhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length === 10 ? '91' + d : d
}

// Phase 47.9 — IST today via shared util.
import { istTodayISO, istTodayPlusDays } from '../../utils/istDate'

const HEAT_RANK = { hot: 0, warm: 1, cold: 2 }

// Truth 2 — slaPill() removed with the dead hand-off query (its last
// consumer); the hand-off/SLA tiles were dropped in 113.12.

export default function TelecallerV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [leads, setLeads] = useState([])
  const [callsToday, setCallsToday] = useState(0)
  const [connectedToday, setConnectedToday] = useState(0)
  // Truth 2 — the TRUE active-queue size (head count, not the 50-row page).
  const [queueCount, setQueueCount] = useState(0)
  const [callbacksCount, setCallbacksCount] = useState(0)
  const [loading, setLoading] = useState(true)
  // Phase 43.1 — PostCallOutcomeModal chain state (mirror of WorkV2).
  const [callLead, setCallLead] = useState(null)
  // Phase 237 — bumped after every outcome save so PendingOutcomesCard drops
  // the resolved call from its list.
  const [pendingBump, setPendingBump] = useState(0)
  // Phase 113.5 — synchronous re-entrancy latch on the Call button. A
  // WebView ghost-click fired quickLogCall twice in one tick → 2 call_logs
  // + 2 lead_activities (the §47 dup-lead disease, on calls). callingRef
  // flips before the dial/audit so the second tap bails.
  const callingRef = useRef(false)
  const [postCallOpen, setPostCallOpen] = useState(false)
  const [pendingActivityId, setPendingActivityId] = useState(null)
  // Phase 43.2 + Phase 49 — daily/weekly TC policy targets.
  const [callTarget, setCallTarget] = useState(50)
  const [connectTarget, setConnectTarget] = useState(30)   // %
  const [qualifiedWeeklyTarget, setQualifiedWeeklyTarget] = useState(5)
  const [qualifiedThisWeek, setQualifiedThisWeek] = useState(0)
  // Phase 113.13 — quote-chase + pay-chase (parity with the sales card).
  // TCs close their own deals on the phone, so these now apply.
  const [quoteChase, setQuoteChase] = useState(0)
  const [payChase, setPayChase] = useState(0)
  // Phase 43.3 — upcoming callbacks (this rep's open follow_ups due
  // in the next 48 hours, joined to the lead for name + phone).
  const [callbacks, setCallbacks] = useState([])
  // Phase 47.1 — WhatsApp send modal state.
  const [waLead, setWaLead] = useState(null)
  const [waOpen, setWaOpen] = useState(false)
  // Phase 113.8 — post-call WhatsApp prompt state (mirror of WorkV2).
  const [waPrompt, setWaPrompt] = useState(null)
  // Phase 285 — reassign nudge (>5 calls) + the reassign modal it opens.
  const [reassignSuggest, setReassignSuggest] = useState(null)
  const [reassignLead, setReassignLead] = useState(null)
  // Phase 47.2 — call scripts master + collapsible script panel.
  const [scripts, setScripts] = useState([])
  const [scriptOpen, setScriptOpen] = useState(false)
  // Phase 51 — last quote for the current Next Call lead. Surfaces
  // ref + amount + status + age on the hero so TC can answer "did
  // we already quote them?" without leaving the page.
  const [lastQuote, setLastQuote] = useState(null)
  // Phase 110 — manual checkout for telecallers (was missing entirely;
  // TC could only be closed by the 8 PM cron). Mirrors WorkV2's flow,
  // minus GPS (TC is desk-based).
  const [tcSession, setTcSession]     = useState(null)
  const [checkingOut, setCheckingOut] = useState(false)

  // Phase 71 (21 May 2026) — `silent` flag skips the full-page
  // spinner during background refreshes. Owner reported: "when we do
  // anything in outcome it auto resets in whole page". Root cause:
  // every onSaved callback called load() which set loading=true →
  // queue unmounted → scroll jumped to top → rep lost place.
  // silent=true keeps the DOM mounted, scroll preserved, data still
  // refreshes underneath.
  async function load(silent = false) {
    if (!silent) setLoading(true)
    // Phase 43.4 — IST anchor (was UTC; broke counts before 18:30 IST).
    const today = istTodayISO()
    const startOfDay = `${today}T00:00:00`

    // Phase 47.9 — IST today + today+2d via shared util.
    const todayDateISO = istTodayISO()
    const in2Days = istTodayPlusDays(2)
    const weekAgoISO = istTodayPlusDays(-7)   // Truth 2 — overdue-callback window

    // Phase 49 — week-start anchor for weekly qualified count.
    // Monday 00:00 IST is the week boundary (Indian work week).
    const weekStartISO = (() => {
      const t = new Date(today + 'T00:00:00')
      const dow = t.getDay() // 0=Sun..6=Sat
      const diff = dow === 0 ? -6 : 1 - dow  // back to Monday
      t.setDate(t.getDate() + diff)
      return t.toISOString().slice(0, 10)
    })()

    const [leadsRes, queueCountRes, callsRes, connectedRes, targetRes, callbacksRes, callbacksCountRes, qualifiedWeekRes] = await Promise.all([
      supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .eq('telecaller_id', profile.id)
        // Phase 43.1 — dropped stale `SalesReady` filter string (stage
        // removed in Phase 30A). Active queue = anything not closed
        // or pending sales handoff.
        .not('stage', 'in', '("Won","Lost","QuoteSent","Negotiating","MeetingScheduled")')
        // Truth 2 (deep-audit P0) — was newest-created-first, so a book
        // bigger than 50 silently hid its OLDEST-contacted leads (the ones
        // most needing a call). Oldest contact first = the RIGHT 50 load;
        // never-contacted leads come first (nullsFirst).
        .order('last_contact_at', { ascending: true, nullsFirst: true })
        .limit(50),
      // Truth 2 — the TRUE queue size for the "In queue" tile (the row
      // query above is a 50-row page, not the total).
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('telecaller_id', profile.id)
        .not('stage', 'in', '("Won","Lost","QuoteSent","Negotiating","MeetingScheduled")'),
      // Phase 76.2.2 (2026-05-23) — owner directive: a "call today"
      // only counts when duration_seconds >= 10. Excludes misdials,
      // ringing-hangups, immediate-cuts. NULL durations also excluded
      // (Postgres comparison semantics) — that's intentional: until
      // the Phase 65 60-second auto-patch fills duration, the call
      // doesn't count toward the KPI yet. Counter bumps within 60s
      // of finishing a real connected call.
      // Phase 93.1 — also exclude direction='missed' so the count
      // matches GpsTrack's "qualified" bucket. Was overstating by
      // any missed-inbound row whose duration somehow landed ≥10.
      // .or() preserves NULL-direction rows (pre-Phase-56l).
      // Phase 93.24 — lead-tied calls only. See TeamDashboardV2 note.
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('call_at', startOfDay)
        // Phase 114.1 — REVERTED Phase 114's outcome-OR. Owner rule is
        // firm: a call counts only at duration_seconds >= 10. Counting
        // by outcome inflated Rima to 183 calls / 183 "connected" (100%)
        // because the modal marks almost everything connected AND most
        // rows carry a NULL/short duration. The 49/50 in the day-summary
        // (also >=10s) is the truth. The real Yash/Vishal problem is
        // broken duration CAPTURE (NULL on most rows) — a separate task;
        // do NOT paper over it by loosening this count.
        .gte('duration_seconds', 10)
        .or('direction.is.null,direction.neq.missed')
        .not('lead_id', 'is', null),
      // Phase 43.2 prep — connected-rate KPI. Count tel-tap rows that
      // came back with outcome='connected' (vs no-answer/busy/etc).
      // Phase 76.2.2 — same 10s floor applied here so the ratio stays
      // meaningful (connected/total both gated to "real" calls).
      // Phase 114.1 — reverted Phase 114's floor-drop (see callsToday).
      // Phase 93.1 — same direction!='missed' guard.
      // Phase 93.24 — lead-tied calls only.
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('outcome', 'connected')
        .gte('call_at', startOfDay)
        .gte('duration_seconds', 10)
        .or('direction.is.null,direction.neq.missed')
        .not('lead_id', 'is', null),
      // Truth 2 — the qualified-today + hand-offs queries were DEAD (their
      // tiles dropped in 113.12; data was fetched on every 20s poll and
      // never rendered). Removed — net query count unchanged (two real
      // counts added above/below).
      // Phase 43.2 + Phase 49 — read this rep's full policy row:
      // min_calls + min_connect_pct + min_qualified_weekly.
      supabase
        .from('daily_targets')
        .select('min_calls, min_connect_pct, min_qualified_weekly')
        .eq('user_id', profile.id)
        .is('effective_to', null)
        .maybeSingle(),
      // Phase 43.3 — upcoming callbacks (this rep's open follow_ups
      // due today or tomorrow). Joined to lead for name + phone so
      // the panel renders without extra round-trips.
      // Phase 54 F3 — embed widened so the lead from the first callback
      // can be promoted into the Next Call hero when the active queue
      // is empty. Same field shape `nextCall` uses on the hero render.
      supabase
        .from('follow_ups')
        .select('id, follow_up_date, follow_up_time, note, lead_id, leads(id, name, phone, company, city, segment, stage, source, heat, last_contact_at, do_not_call, wa_opt_out)')
        .eq('assigned_to', profile.id)
        .eq('is_done', false)
        // Truth 2 (deep-audit P1) — was gte(today): a callback that slipped
        // past midnight VANISHED from the page entirely. Window now opens
        // 7 days back so overdue callbacks surface FIRST (date-asc sort),
        // bounded so ancient junk doesn't flood the panel.
        .gte('follow_up_date', weekAgoISO)
        .lte('follow_up_date', in2Days)
        .order('follow_up_date', { ascending: true })
        .order('follow_up_time', { ascending: true, nullsFirst: true })
        .limit(30),
      // Truth 2 — true count for the Callbacks tile (the panel is a page).
      // Phase 128.2 — tile counts what's actually DUE (today + overdue 7d),
      // ONE PER LEAD — same definition as the admin TC card, so both read
      // the same number. lead_id rows, deduped client-side (one lead can
      // stack many open callbacks). The PANEL keeps showing +2d ahead.
      supabase
        .from('follow_ups')
        .select('lead_id, id')
        .eq('assigned_to', profile.id)
        .eq('is_done', false)
        .gte('follow_up_date', weekAgoISO)
        .lte('follow_up_date', todayDateISO)
        .limit(500),
      // Phase 49 — qualified handoffs THIS WEEK. Counts leads this
      // TC flipped to SalesReady (sales_ready_at) since Monday.
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('telecaller_id', profile.id)
        .gte('sales_ready_at', `${weekStartISO}T00:00:00`),
    ])

    setLeads(leadsRes.data || [])
    setQueueCount(queueCountRes?.count || 0)
    setCallsToday(callsRes.count || 0)
    setConnectedToday(connectedRes.count || 0)
    setCallTarget(Number(targetRes?.data?.min_calls) || 50)
    // Phase 49 — connect-rate + weekly-qualified targets + counts.
    setConnectTarget(Number(targetRes?.data?.min_connect_pct) || 30)
    setQualifiedWeeklyTarget(Number(targetRes?.data?.min_qualified_weekly) || 5)
    setQualifiedThisWeek(qualifiedWeekRes?.count || 0)
    setCallbacks(callbacksRes?.data || [])
    // Phase 128.2 — distinct leads with a DUE callback (today + overdue).
    setCallbacksCount(new Set((callbacksCountRes?.data || []).map(r => r.lead_id || r.id)).size)
    // Phase 110 — today's work_session drives the manual-checkout state
    // on the DaySummaryCard (checked-out? busy?).
    const { data: wsRow } = await supabase
      .from('work_sessions')
      .select('check_out_at')
      .eq('user_id', profile.id)
      .eq('work_date', todayDateISO)
      .maybeSingle()
    setTcSession(wsRow || null)

    // Phase 113.13 — quote-chase + pay-chase (parity with the sales card).
    // Computed by the my_chase_counts() RPC (SECURITY DEFINER) so it works
    // for a telecaller too: a TC can't read the payments table directly
    // (payments_sales_read_own is sales-only), so an inline query would
    // over-count pay-chase. The RPC reads server-side, scoped to the caller's
    // own quotes, and returns ONLY the two counts (no financial data).
    ;(async () => {
      const { data } = await supabase.rpc('my_chase_counts')
      const row = Array.isArray(data) ? data[0] : data
      setQuoteChase(row?.quote_chase || 0)
      setPayChase(row?.pay_chase || 0)
    })().catch(() => {})

    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

  // Phase 250 — RESTORE a call the app was killed during.
  //
  // If Android reclaimed the app while the rep was talking, the 1.5s timer and
  // every piece of React state died with it, so the outcome modal never opened
  // and the follow-up was never created. The synchronous localStorage write in
  // quickLogCall survives that, so on the next launch we reopen the modal for
  // that lead. activityId may be null (the insert never left the phone) — the
  // modal inserts in that case rather than patching, so the call is still
  // captured. Runs once, after the queue loads, so callLead can be a real row.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !profile?.id || loading) return
    restoredRef.current = true   // unconditional: this must run exactly ONCE per
                                 // mount. Setting it only when a record exists
                                 // left the check re-running on every load()
                                 // flip (check-in, checkout, ticking a task),
                                 // which could pop the modal mid-flow.
    const p = readPendingCall(profile.id)
    if (!p) return
    ;(async () => {
      let actId = p.activityId || null
      if (!actId) {
        // The insert may have SUCCEEDED server-side and only the follow-up
        // bookkeeping died with the app. Adopt that row instead of inserting a
        // second one: nothing would catch the duplicate (the Phase 68.2 dedupe
        // index keys on notes, which differ between the tap row and the
        // outcome-save row) and compute_daily_score COUNTs both, inflating the
        // TC's score and therefore pay.
        const { data: orphan } = await supabase
          .from('lead_activities')
          .select('id')
          .eq('lead_id', p.leadId)
          .eq('created_by', profile.id)
          .eq('activity_type', 'call')
          .is('outcome', null)
          .gte('created_at', new Date(p.at - 60_000).toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        actId = orphan?.id || null
      }
      // Prefer the freshly-loaded lead row; fall back to the stored snapshot so
      // this still works when the lead has dropped out of today's queue.
      const fromQueue = leads.find(l => l.id === p.leadId)
      setCallLead(fromQueue || { id: p.leadId, name: p.leadName, company: p.leadCompany, phone: p.phone })
      setPendingActivityId(actId)
      setPostCallOpen(true)
    })()
    /* eslint-disable-next-line */
  }, [profile?.id, loading])

  // Phase 110 — manual end-of-day checkout for telecallers. Stamps
  // check_out_at on today's session; the 8 PM cron still auto-closes
  // anyone who forgets. No GPS (TC is desk-based). check_out_source is a
  // best-effort second write so a DB without the Phase 92c column can't
  // break the primary checkout (mirrors WorkV2.doCheckOut).
  async function doCheckOut(source = 'manual') {
    if (checkingOut) return
    // Mirror WorkV2: DaySummaryCard passes 'manual' (button) or
    // 'auto_share' (share-chained). Normalize anything else (e.g. a
    // React event object) to 'manual' so the audit source is accurate.
    const safeSource = (source === 'manual' || source === 'auto_share' || source === 'auto_cron')
      ? source : 'manual'
    setCheckingOut(true)
    const today = istTodayISO()
    const { error } = await supabase
      .from('work_sessions')
      .update({ check_out_at: new Date().toISOString() })
      .eq('user_id', profile.id)
      .eq('work_date', today)
    if (!error) {
      try {
        await supabase.from('work_sessions')
          .update({ check_out_source: safeSource })
          .eq('user_id', profile.id)
          .eq('work_date', today)
      } catch (_) { /* column may not exist yet — primary checkout already landed */ }
    }
    setCheckingOut(false)
    if (error) { pushToast('Could not check out — try again.', 'danger'); return }
    load(true)
  }
  // Phase 43.1 — match sales-frozen contract: auto-refresh queue.
  // Phase 65 — 20s poll so call counters + connect-rate update
  // without waiting for tab-resume.
  useAutoRefresh(() => load(true), { enabled: !!profile?.id, pollSeconds: 20, userId: profile?.id })  // Phase 71 — silent background refresh

  // Phase 47.2 — fetch active call scripts once. Cheap; admin
  // edits don't fire often. Frontend picks the best-match script
  // per lead based on segment.
  useEffect(() => {
    let cancelled = false
    supabase.from('call_scripts')
      .select('id, name, body, segment, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .then(({ data }) => { if (!cancelled) setScripts(data || []) })
    return () => { cancelled = true }
  }, [])

  // Phase 51 — quote → detail route. Govt quotes route to
  // /proposal/:id; private + other media to /quotes/:id
  // (per CLAUDE.md §10 routing rules).
  function quoteHref(q) {
    if (!q) return '/quotes'
    const govt = q.media_type === 'AUTO_HOOD' || q.media_type === 'GSRTC_LED'
    return govt ? `/proposal/${q.id}` : `/quotes/${q.id}`
  }

  // Phase 51 — status chip palette. Uses v2 tokens with hex
  // fallbacks (same pattern as the WhatsApp button on this page).
  function quoteStatusStyle(s) {
    switch (s) {
      case 'won':
        return {
          background: 'var(--v2-green-soft, rgba(34,197,94,.14))',
          color:      'var(--v2-green, #22c55e)',
          border:     '1px solid var(--v2-green, #22c55e)',
        }
      case 'lost':
        return {
          background: 'var(--v2-rose-soft, rgba(244,63,94,.14))',
          color:      'var(--v2-rose, #f43f5e)',
          border:     '1px solid var(--v2-rose, #f43f5e)',
        }
      case 'sent':
      case 'negotiating':
        return {
          background: 'var(--v2-amber-soft, rgba(245,158,11,.14))',
          color:      'var(--v2-amber, #f59e0b)',
          border:     '1px solid var(--v2-amber, #f59e0b)',
        }
      case 'draft':
      default:
        return {
          background: 'rgba(255,255,255,.06)',
          color:      'var(--v2-ink-2, #6a7590)',
          border:     '1px solid var(--v2-line, rgba(255,255,255,.12))',
        }
    }
  }

  // Phase 47.3 — quick-set heat on any lead without leaving the
  // TC page. Optimistic local update + DB write.
  async function updateLeadHeat(leadId, newHeat) {
    if (!leadId) return
    // Optimistic update to the rendered queue so the chip flips
    // before the network round-trip.
    setLeads(curr => curr.map(l => l.id === leadId ? { ...l, heat: newHeat } : l))
    const { error } = await supabase
      .from('leads')
      .update({ heat: newHeat, updated_at: new Date().toISOString() })
      .eq('id', leadId)
    if (error) {
      pushToast(`Could not update heat: ${error.message}`, 'danger')
      load(true)  // Phase 71 — silent rollback, preserve scroll
    }
  }

  // Phase 47.5 — DNC + WhatsApp opt-out enforcement on the TC
  // surface. Both call and WA buttons disable when the lead is
  // flagged. Toast explains why instead of silent no-op.
  function blockedByDNC(lead) {
    if (lead?.do_not_call) {
      pushToast(`${lead.name || 'This lead'} is marked Do Not Call. Open the lead to lift the flag.`, 'danger')
      return true
    }
    return false
  }
  function blockedByWaOptOut(lead) {
    if (lead?.wa_opt_out) {
      pushToast(`${lead.name || 'This lead'} opted out of WhatsApp.`, 'danger')
      return true
    }
    return false
  }

  // Phase 43.1 — quickLogCall mirrors WorkV2:532 chain.
  // tel: link fires immediately on user gesture (iOS Safari requirement),
  // then logCallAudit + lead_activities insert + open modal 1.5s later.
  async function quickLogCall(lead) {
    if (callingRef.current) return   // Phase 113.5 — re-entrancy latch (ghost-click)
    if (!lead?.id || !profile?.id) return
    // Phase 47.5 — DNC gate. Block call entirely if flagged.
    if (blockedByDNC(lead)) return
    const phone = cleanPhone(lead.phone)
    if (!phone) {
      pushToast('No phone on this lead — open the lead and add the mobile number first.', 'danger')
      return
    }
    // Phase 113.5 — latch after validation, before the side effects (dial +
    // audit + activity insert). Auto-release in 2.5s: covers the ghost-click
    // burst + the dialer hand-off; the rep can dial the next lead after.
    callingRef.current = true
    setTimeout(() => { callingRef.current = false }, 2500)
    setCallLead(lead)
    // Phase 250 — SYNCHRONOUS, and it must stay immediately BEFORE dialPhone.
    // Everything after this line can be lost if Android kills the app while the
    // rep is on the call; this localStorage write is the only thing guaranteed
    // to land, and it is what lets the outcome modal come back on next launch.
    rememberPendingCall({
      leadId: lead.id, leadName: lead.name, leadCompany: lead.company,
      phone: lead.phone, userId: profile.id,
    })
    dialPhone(phone)
    logCallAudit(supabase, { userId: profile.id, leadId: lead.id, phone: lead.phone })
    markCallStart(lead.id)   // Phase 116 — arm the time-away duration fallback
    setTimeout(async () => {
      const { data: actRow, error: insErr } = await supabase
        .from('lead_activities')
        .insert([{
          lead_id:       lead.id,
          activity_type: 'call',
          outcome:       null,
          notes:         `Call → ${lead.phone}`,
          created_by:    profile.id,
        }])
        .select('id')
        .single()
      if (insErr) {
        // Phase 113.8 — a same-minute re-tap collides with the Phase 68.2
        // dedupe index (23505): the FIRST tap already logged this call.
        // Don't kill the outcome modal — find that existing row + open the
        // modal on it so the rep can still log the outcome.
        if (insErr.code === '23505' || /duplicate key|uniq_lead_activities/i.test(insErr.message || '')) {
          const { data: existing } = await supabase
            .from('lead_activities')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('created_by', profile.id)
            .eq('activity_type', 'call')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          setPendingActivityId(existing?.id || null)
          setTimeout(() => setPostCallOpen(true), 1500)
          return
        }
        pushToast(`Could not log call: ${insErr.message}`, 'danger')
        return
      }
      setPendingActivityId(actRow?.id || null)
      // Phase 250 — if the insert DID land, record its id so a restored modal
      // patches that row instead of inserting a duplicate call.
      attachPendingActivityId(actRow?.id || null)
      setTimeout(() => setPostCallOpen(true), 1500)

      // Phase 65 (20 May 2026) — auto-patch duration_seconds 60s
      // after tel-tap so LeadCallHistory shows duration even when
      // TC skips PostCallOutcomeModal save.
      const telTapMs = Date.now()
      setTimeout(() => {
        import('../../utils/callLogReader').then(({ fetchAndPatchCallDuration }) => {
          fetchAndPatchCallDuration({
            userId:   profile.id,
            leadId:   lead.id,
            phone:    lead.phone,
            telTapMs,
            activityId: actRow?.id || null,
            onlyIfMissing: true,   // Phase 66 — don't clobber modal-save patch
          }).catch(() => {})
        }).catch(() => {})
      }, 60_000)
    }, 0)
  }

  /* ─── Sort queue by heat (hot first), then oldest contact first ─── */
  const sortedQueue = useMemo(() => {
    const arr = [...leads]
    arr.sort((a, b) => {
      const ha = HEAT_RANK[a.heat] ?? 2
      const hb = HEAT_RANK[b.heat] ?? 2
      if (ha !== hb) return ha - hb
      const la = a.last_contact_at ? new Date(a.last_contact_at).getTime() : 0
      const lb = b.last_contact_at ? new Date(b.last_contact_at).getTime() : 0
      return la - lb // oldest contact first
    })
    return arr
  }, [leads])

  // Phase 54 F3 — when the active queue is empty but the rep has at
  // least one upcoming callback, surface that callback's lead as the
  // Next Call hero so the rep has something actionable on screen.
  // Without this fallback, Dhara opens /telecaller, sees "Queue
  // empty — nice." and has no clear "start here" cue even though 10
  // callbacks are due in the next 48 hours.
  const fallbackFromCallback = (sortedQueue.length === 0 && callbacks.length > 0)
    ? (callbacks[0]?.leads || null)
    : null
  const nextCall = sortedQueue[0] || fallbackFromCallback || null

  // Phase 51 — fetch the latest quote for the current Next Call
  // lead. Single row, cheapest possible (`limit(1)` ordered desc).
  // Re-runs when the hero advances to the next lead in the queue.
  // Placed AFTER `nextCall` declaration (was earlier and triggered
  // TDZ in the minified prod build — Vite hoists const inside the
  // component body, so the dep array tried to read `sortedQueue`
  // before its `useMemo` line ran).
  useEffect(() => {
    let cancelled = false
    const leadId = nextCall?.id
    if (!leadId) {
      setLastQuote(null)
      return
    }
    supabase
      .from('quotes')
      .select('id, quote_number, ref_number, total_amount, status, media_type, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Don't toast — quote backreference is a soft enhancement.
          // Log only.
          console.warn('[tc] last quote fetch failed:', error.message)
          setLastQuote(null)
          return
        }
        setLastQuote(data || null)
      })
    return () => { cancelled = true }
  }, [nextCall?.id])

  // Phase 47.6 — stale leads (no contact 3+ days). Computed
  // client-side from the queue. Surfaces as a banner above the
  // hero when ≥1 stale. Zero new infra (no edge function, no
  // push trigger) — just visual nudge inline.
  const staleLeads = useMemo(() => {
    const threeDays = 3 * 24 * 60 * 60 * 1000
    const now = Date.now()
    return leads.filter(l => {
      if (l.do_not_call) return false  // DNC isn't stale; it's done
      const lastTouch = l.last_contact_at ? new Date(l.last_contact_at).getTime() : 0
      // No contact ever counts as stale too; use created_at floor.
      const baseTs = lastTouch || (l.created_at ? new Date(l.created_at).getTime() : now)
      return (now - baseTs) >= threeDays
    })
  }, [leads])

  // Phase 128.2 — owner: "15 leads idle 3+ days but not able to click on
  // it." Tapping the banner now filters the Call queue to just those
  // leads; tap again to clear. Pure client view-state, no new query.
  const [idleOnly, setIdleOnly] = useState(false)
  // Phase 150 — ref to the Call-queue <details> so tapping the idle banner
  // can OPEN it + scroll to it (it's collapsed by default → "can't open it").
  const queueRef = useRef(null)
  const visibleQueue = useMemo(() => {
    if (!idleOnly) return sortedQueue
    const ids = new Set(staleLeads.map(l => l.id))
    return sortedQueue.filter(l => ids.has(l.id))
  }, [idleOnly, sortedQueue, staleLeads])

  // Phase 47.3 — top hot leads for this TC. Same source as the
  // queue but filtered to heat='hot' + sorted by last-touch
  // oldest-first. Surfaces "must-call NOW" leads above everything.
  const hotLeads = useMemo(() => {
    return leads
      .filter(l => l.heat === 'hot')
      .sort((a, b) => {
        const la = a.last_contact_at ? new Date(a.last_contact_at).getTime() : 0
        const lb = b.last_contact_at ? new Date(b.last_contact_at).getTime() : 0
        return la - lb
      })
      .slice(0, 3)
  }, [leads])

  // Phase 47.2 — pick best-match script for the current lead.
  // 1. segment-specific script first
  // 2. fall back to NULL-segment generic
  const activeScript = useMemo(() => {
    if (!nextCall) return null
    const seg = nextCall.segment || 'PRIVATE'
    return (
      scripts.find(s => s.segment === seg) ||
      scripts.find(s => !s.segment) ||
      null
    )
  }, [nextCall, scripts])

  // Phase 47.2 — render placeholders with lead + rep context.
  function renderScript(body) {
    if (!body || !nextCall) return ''
    return body
      .replaceAll('{name}',         nextCall.name || '')
      .replaceAll('{company}',      nextCall.company || nextCall.name || '')
      .replaceAll('{phone}',        nextCall.phone || '')
      .replaceAll('{city}',         nextCall.city || '')
      .replaceAll('{rep_name}',     profile?.name || '')
      .replaceAll('{company_name}', 'Untitled Advertising')
  }

  if (loading) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{
          textAlign: 'center', padding: 48,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          color: 'var(--text-muted)',
        }}>
          <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: 13 }}>Loading queue…</div>
        </div>
      </div>
    )
  }

  // Phase 43.2 — ring now shows progress toward daily call target
  // (callsToday / callTarget × 100). Connect-rate joins the footer
  // stats so TC can read connect-quality at a glance. Qualified
  // count stays in footer.
  // Truth 2 — true total (head count), not the 50-row page length.
  const queueOpen = queueCount || leads.length
  const callTargetPct = callTarget > 0
    ? Math.round((callsToday / callTarget) * 100)
    : 0
  const connectRatePct = callsToday > 0
    ? Math.round((connectedToday / callsToday) * 100)
    : 0
  return (
    <div className="lead-root">
      {/* Phase 104.2 — incentive forecast card is rendered ONCE by
          V2AppShell (mounts it above <Outlet/> for every non-privileged
          role, incl. TC). Phase 104's body-mount here was a SECOND
          instance sharing realtime topic `incentive-<userId>` →
          "cannot add postgres_changes after subscribe()" crash. Do NOT
          re-add — the shell already shows it at top, same as /work. */}

      {/* Phase 93 — evening wrap-up nag banner. Tap = smooth-scroll
          to DaySummaryCard below. Sits above DaySummaryCard so it
          can't be missed on first scroll. */}
      <EveningWrapBanner />

      {/* Phase 314 — message-first greet gate (see WorkV2 / §198). TC has no
          check-in step, so it shows on open until they greet today. */}
      <MorningGreetGate />

      {/* Phase 83 — evening day summary card. Auto-shows after 7 PM
          IST. Mounted above V2Hero so it's the first thing the TC
          sees when finishing the day. */}
      <DaySummaryCard
        onCheckOut={doCheckOut}
        checkedOut={!!tcSession?.check_out_at}
        checkOutBusy={checkingOut}
      />

      {(queueOpen > 0 || callsToday > 0) && (
        <V2Hero
          eyebrow={`Telecaller · ${profile?.name || 'You'}`}
          value={`${callsToday}/${callTarget}`}
          label={`call${callsToday === 1 ? '' : 's'} today · target ${callTarget}`}
          percent={callTargetPct}
          footerStats={[
            // Phase 104 — hero footer trimmed to connect-rate only; the
            // qualified / in-queue / hand-offs stats moved into the Today
            // tile grid below (sales-style), so they aren't shown twice.
            { label: `${connectRatePct}% connected`, value: connectedToday, tint: connectRatePct >= 30 ? 'var(--v2-green, #10B981)' : 'var(--v2-amber, #F59E0B)' },
          ]}
          accent={callTargetPct >= 100}
        />
      )}
      {/* Page head */}
      <div className="lead-page-head">
        <div>
          <div className="lead-page-eyebrow">Inside-sales · queue</div>
          <div className="lead-page-title">{profile?.name || 'Telecaller'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Phase 93.11 — owner: "1 call today" pill repeated the
              CALLS TODAY tile below. Dropped — single source of truth. */}
          <button className="lead-btn lead-btn-primary" onClick={() => navigate('/leads/new')}>
            <Plus size={14} /> New Lead
          </button>
        </div>
      </div>

      {/* Phase 113.11 — "AI · queue" briefing card removed per owner (not
          needed now; the hero already names the top call). Re-add later if
          wanted. */}

      {/* Phase 47.6 — stale lead alert banner. Renders only when
          ≥1 lead has had no contact for 3+ days. Click → scroll
          into the queue below. No push (notification fatigue);
          visible-when-open is enough. */}
      {staleLeads.length > 0 && (
        <div
          role="button"
          onClick={() => {
            const turningOn = !idleOnly
            setIdleOnly(turningOn)
            // Phase 150 — open the collapsed Call-queue accordion + scroll to
            // it so the idle leads are actually visible (was the "can't open
            // it" gap: tapping filtered a queue that stayed collapsed below).
            if (turningOn && queueRef.current) {
              queueRef.current.open = true
              setTimeout(() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
            }
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', marginBottom: 14,
            background: idleOnly ? 'rgba(245,158,11,.22)' : 'rgba(245,158,11,.10)',
            border: `1px solid rgba(245,158,11,${idleOnly ? '.65' : '.35'})`,
            borderRadius: 10, cursor: 'pointer',
            fontSize: 13, color: 'var(--warning, #F59E0B)',
          }}
        >
          <Clock size={14} />
          <div style={{ flex: 1 }}>
            <strong>{staleLeads.length} lead{staleLeads.length > 1 ? 's' : ''} idle 3+ days.</strong>{' '}
            <span style={{ color: 'var(--v2-ink-2)' }}>
              {idleOnly
                ? 'Showing only idle leads in the queue — tap to show all.'
                : 'Tap here to see just them in the queue below.'}
            </span>
          </div>
          <ChevronDown size={14} strokeWidth={1.6} style={{ transform: idleOnly ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </div>
      )}

      {/* Hero next-call card */}
      {nextCall ? (
        <div className="tc-hero" style={{ marginBottom: 16 }}>
          <div className="tc-hero-head">
            {/* Phase 113.7 — round initial avatar removed per owner
                (cleaner card, less "badge" clutter). */}
            <div>
              <div className="tc-hero-name">{nextCall.name}</div>
              <div className="tc-hero-co">
                {nextCall.company ? `${nextCall.company} · ` : ''}
                {nextCall.segment === 'GOVERNMENT' ? 'Government' : 'Private'}
              </div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <StageChip stage={nextCall.stage} />
              {/* Phase 47.3 — quick heat picker on hero. Tap to
                  open popover, pick → DB updated optimistically. */}
              <span style={{ marginLeft: 6 }}>
                <HeatPicker
                  value={nextCall.heat}
                  onChange={(v) => updateLeadHeat(nextCall.id, v)}
                />
              </span>
            </div>
          </div>
          <div className="tc-hero-meta">
            {nextCall.phone && <span className="it"><Phone size={12} /> {nextCall.phone}</span>}
            {nextCall.city && <span className="it"><MapPin size={12} /> {nextCall.city}</span>}
            {nextCall.source && <span className="it">Source · {nextCall.source}</span>}
            <span className="it" style={{ marginLeft: 'auto' }}>
              <Clock size={12} />{' '}
              {nextCall.last_contact_at ? `${formatRelative(nextCall.last_contact_at)} since last touch` : 'never contacted'}
            </span>
          </div>
          {/* Phase 51 — last-quote backreference. Renders only when
              `quotes.lead_id` resolves a row. Shows ref + amount +
              status chip + age; taps through to detail (govt routes
              to /proposal/:id, others to /quotes/:id per §10). */}
          {lastQuote && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => navigate(quoteHref(lastQuote))}
                style={{
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid rgba(255,255,255,.10)',
                  borderRadius: 10,
                  padding: '7px 12px',
                  color: 'var(--v2-ink-1, var(--text))',
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  flexWrap: 'wrap',
                }}
              >
                <FileText size={14} />
                <span style={{ fontWeight: 600 }}>
                  Last quote · {lastQuote.quote_number || lastQuote.ref_number || lastQuote.id.slice(0, 8)}
                </span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span style={{ fontWeight: 600 }}>{formatCurrency(lastQuote.total_amount || 0)}</span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  ...quoteStatusStyle(lastQuote.status),
                }}>
                  {lastQuote.status || 'draft'}
                </span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 2 }}>
                  · {formatRelative(lastQuote.created_at)}
                </span>
              </button>
            </div>
          )}
          {/* Phase 47.2 — collapsible call script. Renders only when
              a matching script exists. Default collapsed; rep taps
              "Show script" to expand. Script body shown in a fixed-
              width box that scrolls if long, with newlines preserved
              via whiteSpace: pre-wrap. Placeholders rendered with
              current lead context. */}
          {activeScript && (
            <div style={{
              marginTop: 10, marginBottom: 4,
              borderTop: '1px solid rgba(255,255,255,.08)',
              paddingTop: 10,
            }}>
              <button
                type="button"
                onClick={() => setScriptOpen(v => !v)}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--v2-yellow, #FFE600)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  padding: 0, fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {scriptOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {' '}Script · {activeScript.name}
              </button>
              {scriptOpen && (
                <div style={{
                  marginTop: 8,
                  padding: '12px 14px',
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid rgba(255,255,255,.08)',
                  borderRadius: 10,
                  fontSize: 13, lineHeight: 1.55,
                  color: 'var(--v2-ink-1, var(--text))',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 260, overflowY: 'auto',
                }}>
                  {renderScript(activeScript.body)}
                </div>
              )}
            </div>
          )}

          <div className="tc-hero-actions">
            {/* Phase 43.1 — was raw tel: link with no audit / outcome
                capture. Now routes through quickLogCall which fires
                the dialer + logs call_audit + opens
                PostCallOutcomeModal 1.5s later (same chain sales
                reps get via WorkV2). */}
            {nextCall.phone ? (
              <button
                type="button"
                className="tc-call-cta"
                onClick={() => quickLogCall(nextCall)}
              >
                <Phone size={16} /> Call now
              </button>
            ) : (
              <button className="tc-call-cta" onClick={() => navigate(`/leads/${nextCall.id}`)}>
                <Phone size={16} /> Open lead
              </button>
            )}
            {/* Phase 47.1 — WhatsApp 1-click send. Shown only when
                phone present. Same row as Call now. */}
            {nextCall.phone && (
              <button
                type="button"
                className="tc-open-ghost"
                style={{ background: 'var(--v2-green-soft, rgba(16,185,129,.14))', borderColor: 'var(--v2-green, #10B981)', color: 'var(--v2-green, #10B981)' }}
                onClick={() => { if (blockedByWaOptOut(nextCall)) return; setWaLead(nextCall); setWaOpen(true) }}
              >
                <MessageSquare size={14} /> WhatsApp
              </button>
            )}
            <button className="tc-open-ghost" onClick={() => navigate(`/leads/${nextCall.id}`)}>
              Open lead
            </button>
          </div>
        </div>
      ) : (
        <div className="lead-card lead-card-pad" style={{ marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontWeight: 600 }}>Queue empty — nice.</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            New leads assigned to you will appear here.
          </div>
        </div>
      )}

      {/* Phase 43.2 — KPI strip swaps "Today's calls" → "Calls / target"
          and surfaces connect-rate as a separate tile. Connect-rate is
          the real TC KPI (just "calls logged" is gaming-able). */}
      {/* Phase 49 — KPI strip surfaces all 4 TC policies with
          target compare + color (red below, green hit). Owner-
          approved: 50 calls/day · 30% connect · 5 qualified/week
          · 0 SLA breaches. */}
      {/* Phase 104 — Today tile grid. SAME UI as the sales
          TodaySummaryCard (m-card · 3-col · icon + Space-Grotesk number +
          9px label · tint bg/border · 78px min · greyed at 0). 6 TC
          metrics: the qualified / in-queue / hand-offs that moved off the
          hero footer + callbacks + connected + SLA. */}
      <div className="m-card" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6,
        padding: 10, marginBottom: 16,
      }}>
        {[
          // Phase 113.13 — 6 tiles (3x2): Callbacks / Connected / Qualified /
          // In queue / Quote chase / Pay chase. (Hand-offs + SLA dropped in
          // 113.12; Quote/Pay chase added — TCs close their own deals.)
          // Phase 128.2 — count is DUE-only (today + overdue, one per lead);
          // no || fallback: a real 0 must show 0, not the panel's row count.
          { icon: Clock,         tint: 'var(--warning, #F59E0B)', label: 'Callbacks due', n: callbacksCount,  to: '/follow-ups' },
          { icon: PhoneCall,     tint: 'var(--success, #10B981)', label: 'Connected',   n: connectedToday,    to: null },
          { icon: CheckCircle2,  tint: 'var(--blue, #3B82F6)',    label: 'Worked',      n: qualifiedThisWeek, to: null },
          { icon: Users,         tint: 'var(--accent, #FFE600)',  label: 'In queue',    n: queueOpen,         to: '/leads' },
          { icon: FileText,      tint: 'var(--blue, #3B82F6)',    label: 'Quote chase', n: quoteChase,        to: '/quotes' },
          { icon: Receipt,       tint: 'var(--danger, #EF4444)',  label: 'Pay chase',   n: payChase,          to: '/quotes' },
        ].map((c) => {
          const Icon = c.icon
          const empty = !c.n
          const clickable = !!c.to && !empty
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => { if (c.to) navigate(c.to) }}
              disabled={empty}
              style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '12px 6px', borderRadius: 12,
                background: `${c.tint}14`, border: `1px solid ${c.tint}33`,
                cursor: clickable ? 'pointer' : 'default',
                opacity: empty ? 0.5 : 1,
                fontFamily: 'inherit', color: 'inherit', minHeight: 78,
              }}
              title={c.label}
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

      {/* Phase 237 — calls tapped but never given an outcome (mirror of
          /work). Each row opens the same PostCallOutcomeModal below. */}
      <PendingOutcomesCard
        repId={profile?.id}
        refreshKey={pendingBump}
        onResolve={(it) => {
          setCallLead(it.lead)
          setPendingActivityId(it.activityId)
          setPostCallOpen(true)
        }}
      />

      {/* Phase 43.3 — upcoming callbacks panel. Shows the rep's open
          follow_ups due in the next 48 hours. Each row has a Call
          button that fires the same quickLogCall chain. Empty when
          nothing scheduled, so doesn't take space unnecessarily. */}
      {callbacks.length > 0 && (
        <details className="lead-card tc-accordion" style={{ marginBottom: 16 }}>
          <summary className="lead-card-head">
            <div>
              <div className="lead-card-title">Upcoming callbacks</div>
              <div className="lead-card-sub">{callbacksCount} due (today + overdue) · list also shows next 48h</div>
            </div>
            <ChevronDown size={16} strokeWidth={1.6} className="tc-acc-chev" />
          </summary>
          {callbacks.map((cb) => {
            const lead = cb.leads || {}
            const dateLabel = cb.follow_up_date ? formatDate(cb.follow_up_date) : 'today'
            const timeLabel = cb.follow_up_time ? cb.follow_up_time.slice(0, 5) : ''
            return (
              <div
                key={cb.id}
                style={{
                  padding: '12px 18px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.06))',
                }}
              >
                <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/leads/${lead.id}`)}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{lead.name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                    {lead.company || '—'}{cb.note ? ` · ${cb.note.slice(0, 60)}` : ''}
                  </div>
                </div>
                <Pill tone="warn">{dateLabel}{timeLabel ? ` · ${timeLabel}` : ''}</Pill>
                {lead.phone && (
                  <>
                    <button
                      type="button"
                      className="tc-call-cta"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => quickLogCall(lead)}
                    >
                      <Phone size={12} /> Call
                    </button>
                    {/* Phase 47.1 — WhatsApp send on callback row. */}
                    <button
                      type="button"
                      style={{
                        padding: '6px 10px', fontSize: 12,
                        background: 'transparent',
                        border: '1px solid var(--v2-green, #10B981)',
                        color: 'var(--v2-green, #10B981)',
                        borderRadius: 10, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontFamily: 'inherit',
                      }}
                      onClick={() => { if (blockedByWaOptOut(lead)) return; setWaLead(lead); setWaOpen(true) }}
                    >
                      <MessageSquare size={12} /> WhatsApp
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </details>
      )}

      {/* Phase 113.7 — Missed-call rescue + "Today on the map" removed from
          the TC page (owner declutter). Missed-call rescue was padded by
          tel-tap audit rows (every Call tap writes a no_answer call_logs
          row, so it never reflected real missed calls); the field map is
          irrelevant to a phone rep. Both components remain on WorkV2. */}

      {/* Phase 47.3 — Top hot leads card. Renders only when there's
          at least one hot-marked lead in this rep's queue. Rep gets
          a 1-line "must-call" surface above the broader queue. */}
      {hotLeads.length > 0 && (
        <div className="lead-card" style={{ marginBottom: 16 }}>
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Top hot leads</div>
              <div className="lead-card-sub">
                {hotLeads.length} hot · sorted by oldest contact first
              </div>
            </div>
          </div>
          {hotLeads.map((l, i) => (
            <div
              key={l.id}
              onClick={() => navigate(`/leads/${l.id}`)}
              style={{
                padding: '12px 18px',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto auto',
                gap: 10,
                alignItems: 'center',
                borderBottom: i < hotLeads.length - 1
                  ? '1px solid var(--border-soft, rgba(255,255,255,.06))'
                  : 0,
                cursor: 'pointer',
              }}
            >
              <HeatDot heat="hot" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{l.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  {l.company || '—'} · {l.last_contact_at
                    ? `${formatRelative(l.last_contact_at)} since last touch`
                    : 'never contacted'}
                </div>
              </div>
              <span onClick={(e) => e.stopPropagation()}>
                <HeatPicker
                  value={l.heat}
                  onChange={(v) => updateLeadHeat(l.id, v)}
                  compact
                />
              </span>
              {l.phone && (
                <button
                  type="button"
                  className="tc-call-cta"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); quickLogCall(l) }}
                >
                  <Phone size={12} /> Call
                </button>
              )}
              {l.phone && (
                <button
                  type="button"
                  style={{
                    padding: '6px 10px', fontSize: 12,
                    background: 'transparent',
                    border: '1px solid var(--v2-green, #10B981)',
                    color: 'var(--v2-green, #10B981)',
                    borderRadius: 10, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontFamily: 'inherit',
                  }}
                  onClick={(e) => { e.stopPropagation(); if (blockedByWaOptOut(l)) return; setWaLead(l); setWaOpen(true) }}
                >
                  <MessageSquare size={12} /> WA
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Phase 113.12 — "Pending hand-offs" section removed per owner:
          telecallers work + CLOSE leads on the phone themselves (no field-
          sales hand-off step). sales_ready_at is stamped on the first
          New->Working call, so the list was really "leads in progress",
          mislabeled as hand-offs awaiting sales. Call queue stays. */}
      <div style={{ marginTop: 4 }}>

        {/* Call queue */}
        <details ref={queueRef} className="lead-card tc-accordion" style={{ marginBottom: 16 }}>
          <summary className="lead-card-head">
            <div>
              <div className="lead-card-title">Call queue</div>
              <div className="lead-card-sub">
                {idleOnly
                  ? `idle 3+ days only · ${visibleQueue.length} leads`
                  : `showing ${leads.length} of ${queueOpen} · oldest contact first`}
              </div>
            </div>
            <span className="lead-card-link" onClick={(e) => { e.stopPropagation(); e.preventDefault(); navigate('/leads') }}>
              View all <ArrowRight size={11} />
            </span>
            <ChevronDown size={16} strokeWidth={1.6} className="tc-acc-chev" />
          </summary>
          {visibleQueue.length === 0 ? (
            <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {idleOnly ? 'No idle leads in the loaded queue.' : 'Queue empty.'}
            </div>
          ) : (
            visibleQueue.slice(0, idleOnly ? 100 : 12).map((l, i) => (
              <div
                key={l.id}
                onClick={() => navigate(`/leads/${l.id}`)}
                style={{
                  padding: '10px 18px',
                  display: 'grid',
                  // Phase 47.3 — added heat-picker column on the right
                  // before StageChip. 28px slot for the chip.
                  gridTemplateColumns: 'auto 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  borderBottom: i < Math.min(sortedQueue.length, 12) - 1 ? '1px solid var(--border-soft, rgba(255,255,255,.06))' : 0,
                  cursor: 'pointer',
                }}
              >
                <HeatDot heat={l.heat} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{l.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{l.phone || '—'}</div>
                </div>
                {/* Phase 47.3 — quick heat picker per queue row. */}
                <span onClick={(e) => e.stopPropagation()}>
                  <HeatPicker
                    value={l.heat}
                    onChange={(v) => updateLeadHeat(l.id, v)}
                    compact
                  />
                </span>
                <StageChip stage={l.stage} sm />
              </div>
            ))
          )}
        </details>
      </div>

      {/* Phase 43.1 — PostCallOutcomeModal chain. Sales reps already
          get this via WorkV2 + LeadDetailV2; telecaller now gets
          parity. Save closes the modal + reloads the queue so
          callsToday + connectedToday refresh inline. */}
      <PostCallOutcomeModal
        open={postCallOpen}
        lead={callLead}
        pendingActivityId={pendingActivityId}
        onClose={() => {
          setPostCallOpen(false)
          setPendingActivityId(null)
          clearPendingCall()   // Phase 250 — rep chose to skip; don't nag on next launch
        }}
        onSaved={async ({ nextAction } = {}) => {
          setPostCallOpen(false)
          setPendingActivityId(null)
          clearPendingCall()   // Phase 250 — outcome captured; nothing left to restore
          setPendingBump(b => b + 1)  // Phase 237 — refresh the pending-outcomes list
          load(true)  // Phase 71 — silent refresh, preserve scroll
          // Phase 113.8 — parity with /work: prompt a WhatsApp follow-up
          // after the outcome. Skip when the next action is a meeting
          // (onLogMeeting routes to lead detail) or the lead is WA opt-out.
          //
          // Phase 249.3 — this early-return was briefly removed to surface the
          // new meeting-confirmation template, then RESTORED: PostCallOutcomeModal
          // fires onSaved() unawaited and then onLogMeeting(), which navigates to
          // /leads/:id and unmounts this page. The prompt's stage-refetch + 200ms
          // timer therefore resolve on an unmounted component and it never
          // renders. Removing the line achieves nothing but a wasted query and an
          // unmounted-setState warning. Sending a meeting confirmation needs the
          // prompt raised where the rep LANDS (lead detail), not here.
          if (nextAction === 'meeting') return
          // Phase 285 — after >5 calls to this lead with no close, suggest a
          // reassign INSTEAD of the WA prompt this turn (handing off is the
          // priority action). Additive early-return; the chain above is intact.
          if (callLead?.id && profile?.id) {
            const nudge = await checkReassignNudge(supabase, { leadId: callLead.id, userId: profile.id })
            if (nudge != null) { setReassignSuggest({ lead: callLead, count: nudge }); return }
          }
          // Pure check (no toast side-effect) — blockedByWaOptOut() toasts,
          // which would surface a stray "opted out" message after save.
          if (callLead?.id && !callLead?.wa_opt_out) {
            const { data } = await supabase
              .from('leads').select('stage').eq('id', callLead.id).maybeSingle()
            setTimeout(() => {
              // Phase 126.4 — carry the lead INTO waPrompt so the popup is
              // self-contained (decoupled from callLead's lifecycle).
              setWaPrompt({ stage: data?.stage || callLead?.stage || 'post_call', lead: callLead })
            }, 200)
          }
        }}
        onLogMeeting={() => {
          // Telecaller doesn't run LogMeetingModal directly — route
          // them to the lead detail where the meeting flow lives.
          if (callLead?.id) navigate(`/leads/${callLead.id}`)
        }}
      />

      {/* Phase 113.8 — post-call WhatsApp follow-up prompt (parity with
          /work). Opens after the outcome modal saves; rep sends or skips.
          WA opt-out leads are filtered out in onSaved above. */}
      <WhatsAppPromptModal
        open={!!waPrompt}
        stage={waPrompt?.stage}
        lead={waPrompt?.lead}
        profile={profile}
        onClose={() => setWaPrompt(null)}
      />

      {/* Phase 285 — post-call reassign nudge (>5 calls to one lead). "Hand
          off" opens the existing ReassignModal; "Keep working it" remembers
          for 24h so it doesn't nag on every call. */}
      <ReassignSuggestModal
        open={!!reassignSuggest}
        lead={reassignSuggest?.lead}
        count={reassignSuggest?.count}
        onReassign={() => { setReassignLead(reassignSuggest.lead); setReassignSuggest(null) }}
        onKeep={() => {
          if (reassignSuggest?.lead && profile?.id) dismissReassignNudge(profile.id, reassignSuggest.lead.id)
          setReassignSuggest(null)
        }}
      />
      {reassignLead && (
        <ReassignModal
          lead={reassignLead}
          onClose={() => setReassignLead(null)}
          onSaved={() => { setReassignLead(null); load(true) }}
        />
      )}

      {/* Phase 47.1 — WhatsApp 1-click send modal. */}
      <WhatsAppSendModal
        open={waOpen}
        lead={waLead}
        onClose={() => { setWaOpen(false); setWaLead(null) }}
        onSent={() => load(true)}  /* Phase 71 — silent refresh */
      />
    </div>
  )
}

/* ─── Sub-components ─── */
// Phase 104 — the <Stat> KPI-strip card was removed when the Today tile
// grid (sales-style m-card tiles) replaced the lead-stat-strip. Deleted
// to avoid dead code.

// Phase 113.7 — heatColor() removed; its only caller (the hero round
// avatar) was dropped in the declutter. Truth 2 — hotWarmCount() +
// overdueCount() removed (dead since their tiles dropped in 113.12).
