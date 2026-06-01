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

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Phone, ArrowRight, MapPin, Clock, Plus, Sparkles, Loader2,
  MessageSquare, ChevronRight, ChevronDown, FileText,
  PhoneCall, CheckCircle2, Users, ArrowUpRight, AlertTriangle,
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
import EveningWrapBanner from '../../components/work/EveningWrapBanner'
import MissedCallsCard from '../../components/work/MissedCallsCard'
// Phase 89.11 (2026-05-23) — mount RepMapPanel on /telecaller so
// Renuka + any TC who does the occasional field visit sees their
// own meeting pins + GPS track. Defaults collapsed so the page
// continues to lead with the Next-Call hero; TC reps who never
// step out keep their existing vertical density.
import RepMapPanel from '../../components/leads/RepMapPanel'
// Phase 43.1 — parity with WorkV2 + LeadDetailV2 call chain. Tel-tap
// audit + post-call outcome capture + auto-refresh.
import PostCallOutcomeModal from '../../components/leads/PostCallOutcomeModal'
import { logCallAudit } from '../../utils/callAudit'
import { dialPhone } from '../../utils/openExternal'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { pushToast } from '../../components/v2/Toast'
// Phase 47.1 — WhatsApp 1-click send.
import WhatsAppSendModal from '../../components/leads/WhatsAppSendModal'

function cleanPhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length === 10 ? '91' + d : d
}

// Phase 47.9 — IST today via shared util.
import { istTodayISO, istTodayPlusDays } from '../../utils/istDate'

const HEAT_RANK = { hot: 0, warm: 1, cold: 2 }

function slaPill(due) {
  if (!due) return null
  const ms = new Date(due).getTime() - Date.now()
  const hours = ms / 3600 / 1000
  if (hours < 0)  return { tone: 'danger',  label: `Overdue ${Math.abs(Math.round(hours))}h` }
  if (hours <= 6) return { tone: 'warn',    label: `${Math.round(hours)}h left` }
  return { tone: 'success', label: `${Math.round(hours)}h left` }
}

export default function TelecallerV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [leads, setLeads] = useState([])
  const [callsToday, setCallsToday] = useState(0)
  const [connectedToday, setConnectedToday] = useState(0)
  const [qualifiedToday, setQualifiedToday] = useState(0)
  const [handoffs, setHandoffs] = useState([])
  const [loading, setLoading] = useState(true)
  // Phase 43.1 — PostCallOutcomeModal chain state (mirror of WorkV2).
  const [callLead, setCallLead] = useState(null)
  const [postCallOpen, setPostCallOpen] = useState(false)
  const [pendingActivityId, setPendingActivityId] = useState(null)
  // Phase 43.2 + Phase 49 — daily/weekly TC policy targets.
  const [callTarget, setCallTarget] = useState(50)
  const [connectTarget, setConnectTarget] = useState(30)   // %
  const [qualifiedWeeklyTarget, setQualifiedWeeklyTarget] = useState(5)
  const [qualifiedThisWeek, setQualifiedThisWeek] = useState(0)
  const [slaBreachCount, setSlaBreachCount] = useState(0)
  // Phase 43.3 — upcoming callbacks (this rep's open follow_ups due
  // in the next 48 hours, joined to the lead for name + phone).
  const [callbacks, setCallbacks] = useState([])
  // Phase 47.1 — WhatsApp send modal state.
  const [waLead, setWaLead] = useState(null)
  const [waOpen, setWaOpen] = useState(false)
  // Phase 47.2 — call scripts master + collapsible script panel.
  const [scripts, setScripts] = useState([])
  const [scriptOpen, setScriptOpen] = useState(false)
  // Phase 51 — last quote for the current Next Call lead. Surfaces
  // ref + amount + status + age on the hero so TC can answer "did
  // we already quote them?" without leaving the page.
  const [lastQuote, setLastQuote] = useState(null)

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

    // Phase 49 — week-start anchor for weekly qualified count.
    // Monday 00:00 IST is the week boundary (Indian work week).
    const weekStartISO = (() => {
      const t = new Date(today + 'T00:00:00')
      const dow = t.getDay() // 0=Sun..6=Sat
      const diff = dow === 0 ? -6 : 1 - dow  // back to Monday
      t.setDate(t.getDate() + diff)
      return t.toISOString().slice(0, 10)
    })()

    const [leadsRes, callsRes, connectedRes, qualRes, handoffRes, targetRes, callbacksRes, qualifiedWeekRes] = await Promise.all([
      supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .eq('telecaller_id', profile.id)
        // Phase 43.1 — dropped stale `SalesReady` filter string (stage
        // removed in Phase 30A). Active queue = anything not closed
        // or pending sales handoff.
        .not('stage', 'in', '("Won","Lost","QuoteSent","Negotiating","MeetingScheduled")')
        .order('created_at', { ascending: false })
        .limit(50),
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
        .gte('duration_seconds', 10)
        .or('direction.is.null,direction.neq.missed')
        .not('lead_id', 'is', null),
      // Phase 43.2 prep — connected-rate KPI. Count tel-tap rows that
      // came back with outcome='connected' (vs no-answer/busy/etc).
      // Phase 76.2.2 — same 10s floor applied here so the ratio stays
      // meaningful (connected/total both gated to "real" calls).
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
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('telecaller_id', profile.id)
        .or(`sales_ready_at.gte.${startOfDay},qualified_at.gte.${startOfDay}`),
      // Phase 30A — SalesReady stage removed. Telecaller hand-offs are
      // now identified by `sales_ready_at` timestamp (the moment the
      // telecaller flipped the lead to ready) on a still-active row.
      supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .eq('telecaller_id', profile.id)
        .not('sales_ready_at', 'is', null)
        .not('stage', 'in', '(Won,Lost)')
        .order('handoff_sla_due_at', { ascending: true, nullsFirst: false })
        .limit(20),
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
        .gte('follow_up_date', todayDateISO)
        .lte('follow_up_date', in2Days)
        .order('follow_up_date', { ascending: true })
        .order('follow_up_time', { ascending: true, nullsFirst: true })
        .limit(10),
      // Phase 49 — qualified handoffs THIS WEEK. Counts leads this
      // TC flipped to SalesReady (sales_ready_at) since Monday.
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('telecaller_id', profile.id)
        .gte('sales_ready_at', `${weekStartISO}T00:00:00`),
    ])

    setLeads(leadsRes.data || [])
    setCallsToday(callsRes.count || 0)
    setConnectedToday(connectedRes.count || 0)
    setQualifiedToday(qualRes.count || 0)
    setHandoffs(handoffRes.data || [])
    setCallTarget(Number(targetRes?.data?.min_calls) || 50)
    // Phase 49 — connect-rate + weekly-qualified targets + counts.
    setConnectTarget(Number(targetRes?.data?.min_connect_pct) || 30)
    setQualifiedWeeklyTarget(Number(targetRes?.data?.min_qualified_weekly) || 5)
    setQualifiedThisWeek(qualifiedWeekRes?.count || 0)
    // SLA breaches = handoffs with handoff_sla_due_at in the past
    // and lead still not flipped (computed from existing handoffRes).
    const nowMs = Date.now()
    const breached = (handoffRes?.data || []).filter(h => {
      if (!h.handoff_sla_due_at) return false
      return new Date(h.handoff_sla_due_at).getTime() < nowMs
    }).length
    setSlaBreachCount(breached)
    setCallbacks(callbacksRes?.data || [])
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])
  // Phase 43.1 — match sales-frozen contract: auto-refresh queue.
  // Phase 65 — 20s poll so call counters + connect-rate update
  // without waiting for tab-resume.
  useAutoRefresh(() => load(true), { pollSeconds: 20 })  // Phase 71 — silent background refresh

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
    if (!lead?.id || !profile?.id) return
    // Phase 47.5 — DNC gate. Block call entirely if flagged.
    if (blockedByDNC(lead)) return
    const phone = cleanPhone(lead.phone)
    if (!phone) {
      pushToast('No phone on this lead — open the lead and add the mobile number first.', 'danger')
      return
    }
    setCallLead(lead)
    dialPhone(phone)
    logCallAudit(supabase, { userId: profile.id, leadId: lead.id, phone: lead.phone })
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
        pushToast(`Could not log call: ${insErr.message}`, 'danger')
        return
      }
      setPendingActivityId(actRow?.id || null)
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
  const queueOpen = leads.length
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

      {/* Phase 83 — evening day summary card. Auto-shows after 7 PM
          IST. Mounted above V2Hero so it's the first thing the TC
          sees when finishing the day. */}
      <DaySummaryCard />

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

      {/* Slim AI briefing — only renders if there's a hottest idle lead */}
      {nextCall && (
        <div className="lead-ai-card" style={{ padding: '14px 18px', marginBottom: 16, gridTemplateColumns: '36px 1fr auto' }}>
          <div className="lead-ai-icon" style={{ width: 36, height: 36 }}>
            <Sparkles size={16} />
          </div>
          <div>
            <div className="lead-ai-eyebrow">
              <span className="pulse" /> AI · queue
            </div>
            <p className="lead-ai-recap" style={{ fontSize: 13, margin: 0 }}>
              <b>{nextCall.name}</b>{nextCall.company ? ` · ${nextCall.company}` : ''}
              {' '}is your top call —{' '}
              {nextCall.last_contact_at
                ? `${formatRelative(nextCall.last_contact_at)} since last touch`
                : 'no contact attempt logged yet'}.
            </p>
          </div>
          <div />
        </div>
      )}

      {/* Phase 47.6 — stale lead alert banner. Renders only when
          ≥1 lead has had no contact for 3+ days. Click → scroll
          into the queue below. No push (notification fatigue);
          visible-when-open is enough. */}
      {staleLeads.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 14,
          background: 'rgba(245,158,11,.10)',
          border: '1px solid rgba(245,158,11,.35)',
          borderRadius: 10,
          fontSize: 13, color: 'var(--warning, #F59E0B)',
        }}>
          <Clock size={14} />
          <div style={{ flex: 1 }}>
            <strong>{staleLeads.length} lead{staleLeads.length > 1 ? 's' : ''} idle 3+ days.</strong>{' '}
            <span style={{ color: 'var(--v2-ink-2)' }}>
              Tap one in the queue below to call. Oldest at top.
            </span>
          </div>
        </div>
      )}

      {/* Hero next-call card */}
      {nextCall ? (
        <div className="tc-hero" style={{ marginBottom: 16 }}>
          <div className="tc-hero-head">
            <div className="tc-big-av">
              {/* Phase 92b — single initial (was 2). Matches WorkV2
                  NextActionCard avatar so /work + /telecaller feel
                  like the same product. */}
              {(nextCall.name || '?').trim().slice(0, 1).toUpperCase()}
              <span className="heat" style={{ background: heatColor(nextCall.heat) }} />
            </div>
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
          { icon: Clock,         tint: 'var(--warning, #F59E0B)', label: 'Callbacks', n: callbacks.length,  to: '/follow-ups' },
          { icon: PhoneCall,     tint: 'var(--success, #10B981)', label: 'Connected', n: connectedToday,    to: null },
          { icon: CheckCircle2,  tint: 'var(--blue, #3B82F6)',    label: 'Qualified', n: qualifiedThisWeek, to: '/leads?stage=Working' },
          { icon: Users,         tint: 'var(--accent, #FFE600)',  label: 'In queue',  n: queueOpen,         to: '/leads' },
          { icon: ArrowUpRight,  tint: 'var(--warning, #F59E0B)', label: 'Hand-offs', n: handoffs.length,   to: '/leads' },
          { icon: AlertTriangle, tint: 'var(--danger, #EF4444)',  label: 'SLA',       n: slaBreachCount,    to: '/leads' },
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

      {/* Phase 43.3 — upcoming callbacks panel. Shows the rep's open
          follow_ups due in the next 48 hours. Each row has a Call
          button that fires the same quickLogCall chain. Empty when
          nothing scheduled, so doesn't take space unnecessarily. */}
      {callbacks.length > 0 && (
        <div className="lead-card" style={{ marginBottom: 16 }}>
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Upcoming callbacks</div>
              <div className="lead-card-sub">{callbacks.length} scheduled · next 48 hours</div>
            </div>
          </div>
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
        </div>
      )}

      {/* Phase 91b — Missed-call rescue. Highest leverage for TC role
          since connect-rate is the metric they're paid on. Same card
          + same quickLogCall chain as /work. Exception-rendered (no
          card when 0 missed in 24h). refreshKey bumped via callsToday
          so a save on PostCallOutcomeModal forces a refetch. */}
      {profile?.id && (
        <MissedCallsCard
          userId={profile.id}
          onCallLead={quickLogCall}
          refreshKey={callsToday}
        />
      )}

      {/* Phase 89.11 — RepMapPanel. Same component as WorkV2 mounts.
          Collapsed by default so it doesn't push the queue below
          the fold. TC reps who never visit clients leave it
          collapsed; Renuka / TC leads who do site visits get the
          same Google Maps + meeting pins admin sees. */}
      {profile?.id && <div style={{ marginBottom: 16 }}><RepMapPanel userId={profile.id} /></div>}

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

      {/* Two-col: hand-offs + queue */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, marginTop: 4 }}>
        {/* Pending hand-offs */}
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Pending hand-offs</div>
              <div className="lead-card-sub">
                {handoffs.length} awaiting sales · {handoffs.filter(h => slaPill(h.handoff_sla_due_at)?.tone === 'danger').length} SLA overdue
              </div>
            </div>
          </div>
          {handoffs.length === 0 ? (
            <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No pending hand-offs.
            </div>
          ) : (
            handoffs.map((h) => {
              const pill = slaPill(h.handoff_sla_due_at) || { tone: '', label: '—' }
              return (
                <div
                  key={h.id}
                  onClick={() => navigate(`/leads/${h.id}`)}
                  style={{
                    padding: '12px 18px',
                    borderBottom: '1px solid var(--border-soft, rgba(255,255,255,.06))',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap: 10,
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{h.company || '—'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    {h.assigned?.name ? (
                      <>
                        <LeadAvatar name={h.assigned.name} userId={h.assigned.id} />
                        <span>{h.assigned.name}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-subtle)' }}>Unassigned</span>
                    )}
                  </div>
                  <Pill tone={pill.tone}>{pill.label}</Pill>
                </div>
              )
            })
          )}
        </div>

        {/* Call queue */}
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Call queue</div>
              <div className="lead-card-sub">{leads.length} in queue · sorted by heat</div>
            </div>
            <span className="lead-card-link" onClick={() => navigate('/leads')}>
              View all <ArrowRight size={11} />
            </span>
          </div>
          {sortedQueue.length === 0 ? (
            <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Queue empty.
            </div>
          ) : (
            sortedQueue.slice(0, 12).map((l, i) => (
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
        </div>
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
        }}
        onSaved={() => {
          setPostCallOpen(false)
          setPendingActivityId(null)
          load(true)  // Phase 71 — silent refresh, preserve scroll
        }}
        onLogMeeting={() => {
          // Telecaller doesn't run LogMeetingModal directly — route
          // them to the lead detail where the meeting flow lives.
          if (callLead?.id) navigate(`/leads/${callLead.id}`)
        }}
      />

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

function heatColor(heat) {
  if (heat === 'hot')  return 'var(--danger)'
  if (heat === 'warm') return 'var(--warning)'
  return 'var(--text-subtle)'
}
function hotWarmCount(leads) {
  const hot  = leads.filter(l => l.heat === 'hot').length
  const warm = leads.filter(l => l.heat === 'warm').length
  return `${hot} hot · ${warm} warm`
}
function overdueCount(handoffs) {
  const overdue = handoffs.filter(h => slaPill(h.handoff_sla_due_at)?.tone === 'danger').length
  if (overdue === 0) return 'all on track'
  return `${overdue} overdue`
}
