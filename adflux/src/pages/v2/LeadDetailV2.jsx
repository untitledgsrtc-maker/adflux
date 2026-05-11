// src/pages/v2/LeadDetailV2.jsx
//
// Phase 16 commit 3 — Lead detail, ported in-place from owner's
// Claude Design output (_design_reference/Leads/lead-admin.jsx ·
// AdminLeadDetail). Same /leads/:id route, new UI.
//
// Phase 19 — Lead module v2.1
//   • Inline-edit on Lead details (Phone/Email/City/Industry/Source/Notes).
//     Pattern: click-to-edit → onBlur → supabase update → optimistic merge.
//     RLS rejects unauthorised edits and the field reverts with a "save
//     failed" hint.
//   • Realtime listener on this lead row — if another tab updates the
//     row, this view reflects within 1–2s without refresh.
//
// Uses the 3 Phase 16 modal components for actions:
//   • LogActivityModal     — call / whatsapp / email / meeting / site_visit / note
//   • ChangeStageModal     — 10-stage move with BANT gate on SalesReady
//   • ReassignModal        — admin/manager rep change
//
// Layout (matches design):
//   Header card: name + stage chip + heat dot + segment chip + meta row
//                + expected value (right) + 6 action buttons
//   Two columns:
//     LEFT (8) — Activity timeline
//     RIGHT (4) — Lead details · Ownership (with SLA pill) · Stage history
//
// RLS lets in: admin, govt_partner (Govt leads), assigned sales rep,
// telecaller, sales_manager (direct reports).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Phone, MessageCircle, Mail, Calendar, MapPin, Edit3,
  RefreshCw, Sparkles, FileText as FileTextIcon, Users as UsersIcon,
  AlertTriangle, Clock, Mic, ChevronDown, MoreHorizontal,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatDate, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, SegChip, LeadAvatar, OutcomeChip, Pill,
} from '../../components/leads/LeadShared'
import LogActivityModal from '../../components/leads/LogActivityModal'
import ChangeStageModal from '../../components/leads/ChangeStageModal'
import ReassignModal   from '../../components/leads/ReassignModal'
import PhotoCapture     from '../../components/leads/PhotoCapture'
import WhatsAppPromptModal from '../../components/leads/WhatsAppPromptModal'

const ACTIVITY_ICON = {
  call:          Phone,
  whatsapp:      MessageCircle,
  email:         Mail,
  meeting:       Calendar,
  site_visit:    MapPin,
  note:          Edit3,
  status_change: RefreshCw,
  imported:      Sparkles,
}
const ACTIVITY_COLOR = {
  call:          'blue',
  whatsapp:      'green',
  email:         'amber',
  meeting:       'purple',
  site_visit:    'amber',
  note:          'amber',
  status_change: 'purple',
  imported:      'purple',
}
const ACTIVITY_TITLE = {
  call:          'Call',
  whatsapp:      'WhatsApp',
  email:         'Email',
  meeting:       'Meeting',
  site_visit:    'Site visit',
  note:          'Note',
  status_change: 'Stage change',
  imported:      'Imported',
}

// Phase 32P — single source of truth for phone-number cleaning. Strip
// every non-digit, then prepend 91 if the result is a bare 10-digit
// Indian number. Used by Call (tel:) and WhatsApp (wa.me:) so both
// land on the same account. Returns null if the cleaned number is
// shorter than 10 digits (invalid → don't generate a broken URL).
function cleanPhone(raw) {
  if (!raw) return null
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length < 10) return null
  if (digits.length === 10) return '91' + digits
  return digits
}

function formatDuration(secs) {
  if (!secs) return null
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${String(s).padStart(2, '0')}s`
}

function slaInfo(due) {
  if (!due) return null
  const ms = new Date(due).getTime() - Date.now()
  const hours = ms / (3600 * 1000)
  if (hours < 0)   return { tone: 'danger', label: `Overdue ${Math.abs(Math.round(hours))}h · was due ${formatDate(due)}` }
  if (hours <= 6)  return { tone: 'warn',   label: `${Math.round(hours)}h left · due ${formatDate(due)}` }
  return { tone: 'success', label: `${Math.round(hours)}h left · due ${formatDate(due)}` }
}

export default function LeadDetailV2() {
  const { id } = useParams()
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  // Phase 31W — was a local list including 'sales_manager' which isn't
  // even a canonical role per CLAUDE.md §8 (only admin/co_owner/sales/
  // agency/telecaller exist). Standardise to the same definition the
  // rest of the app uses (admin || co_owner). If sales_manager is
  // ever added as a real role, do it once in useAuth.js, not here.
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)

  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modal state
  const [activeModal, setActiveModal] = useState(null)   // null | 'stage' | 'reassign' | 'whatsapp_template'
  const [activityType, setActivityType] = useState(null) // null | 'call' | 'whatsapp' | …

  // Phase 33D.5 — post-action WhatsApp prompt. After quick-Call, stage
  // change, or any other touch, open the prompt with the right
  // template. State: { stage: 'post_call'|'New'|... } or null.
  const [waPrompt, setWaPrompt] = useState(null)

  // Phase 33B.4 — "I'm here" auto-checkin with 10-min dwell. Captures
  // GPS on tap, starts a 10-min timer. If still on this lead page when
  // the timer fires, auto-logs a meeting activity with the captured
  // pin. Rep can tap "Save now" to log immediately.
  const [hereGps, setHereGps] = useState(null)         // {lat, lng, acc, startedAt}
  const [hereCountdown, setHereCountdown] = useState(0)
  // Phase 33G.2 — action-grid trim 9 → 5 + More.
  // Primary 5: Call · WhatsApp · Meeting · Note · Voice (highest-
  // frequency daily-use actions). Email / Follow-up / Stage / Photo
  // fold into the More drawer; stage is also reachable via the chip
  // in the hero, and email still works via the mailto link on the
  // lead.email field below.
  const [moreOpen, setMoreOpen] = useState(false)
  async function imHere() {
    if (!navigator.geolocation) {
      setError('GPS not available on this device.')
      return
    }
    setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy),
          startedAt: Date.now(),
        }
        setHereGps(g)
        setHereCountdown(600)  // 10 minutes in seconds
      },
      (e) => setError('Could not capture GPS: ' + (e.message || 'denied')),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }
  async function saveHereMeeting() {
    if (!hereGps || !lead?.id || !profile?.id) return
    const dwellMin = Math.round((Date.now() - hereGps.startedAt) / 60000)
    const { error: insErr } = await supabase.from('lead_activities').insert([{
      lead_id:        lead.id,
      activity_type:  'meeting',
      outcome:        null,
      notes:          `I'm here · auto-check-in (${dwellMin}m at location)`,
      created_by:     profile.id,
      gps_lat:        hereGps.lat,
      gps_lng:        hereGps.lng,
      gps_accuracy_m: hereGps.acc,
    }])
    if (insErr) {
      setError('Could not log: ' + insErr.message)
      return
    }
    setHereGps(null)
    setHereCountdown(0)
    load()
  }
  // Countdown tick — auto-save when it hits 0.
  useEffect(() => {
    if (hereCountdown <= 0) return
    const t = setInterval(() => {
      setHereCountdown(c => {
        if (c <= 1) {
          saveHereMeeting()
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hereCountdown])

  // Phase 33B — WhatsApp template send. Fetches the message_templates
  // row matching the current lead.stage, fills placeholders, opens
  // WhatsApp. Owner directive (11 May 2026): one-tap follow-up at
  // every stage; templates editable via Master → Message Templates.
  const [waTemplate, setWaTemplate] = useState(null)
  const [waLoading, setWaLoading] = useState(false)
  async function sendStageTemplate() {
    if (!lead) return
    const phone = cleanPhone(lead.phone)
    if (!phone) {
      setError('No phone number on file — can\'t send WhatsApp follow-up.')
      return
    }
    setWaLoading(true)
    const { data, error: tErr } = await supabase
      .from('message_templates')
      .select('id, name, body')
      .eq('stage', lead.stage)
      .eq('is_active', true)
      .order('display_order')
      .limit(1)
      .maybeSingle()
    setWaLoading(false)
    if (tErr || !data) {
      setError(`No active template for stage "${lead.stage}". Ask admin to add one in Master → Message Templates.`)
      return
    }
    // Fill placeholders. {name}, {company}, {rep}, {city}.
    const filled = data.body
      .replace(/\{name\}/g,    lead.name    || 'Sir/Madam')
      .replace(/\{company\}/g, lead.company || lead.name || 'your business')
      .replace(/\{rep\}/g,     profile?.name || 'Sales Team')
      .replace(/\{city\}/g,    lead.city    || 'your city')
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(filled)}`
    window.open(url, '_blank')
    fireAndForgetLog('whatsapp', `Follow-up template sent (${data.name})`)
  }

  /* Phase 30C rev2 + 32P — fast-path action loggers. Owner spec
     (8 May 2026): "call log, whatsapp log not able to fetched". The
     hero-card Call / WhatsApp / Email buttons used to JUST open the
     LogActivityModal — they didn't insert an activity until the rep
     filled in notes. Net effect: clicks were lost if the rep didn't
     come back to type. These helpers fire-and-forget an immediate
     activity insert so the timeline reflects every touch, then
     refresh the timeline. The slower paths (meeting / note) still
     open the modal because those genuinely need notes.

     Phase 32P (11 May 2026) — owner reported: Call / WhatsApp / Email
     buttons "not working". Root causes:
       1. WhatsApp URL was `wa.me/${digits}` without the 91 country
          code prefix, so a 10-digit Indian number landed on the wrong
          WhatsApp account (or a dead URL).
       2. Email button didn't exist at all — Phase 31T pruned it
          claiming the email field in Lead Details was clickable
          mailto, but that field is an inline-edit input. Clicking it
          opens edit mode, not the mail app.
       3. The async supabase.insert in onClick raced with the native
          tel:/wa.me/mailto: handoff on iOS Safari — the browser would
          sometimes refuse to launch the system app because the user
          gesture was deemed "consumed" by the async work.
     Fix: cleanPhone helper for consistent 91 prefix. fireAndForget
     wraps the insert in setTimeout(0) so navigation always wins the
     race. Email button restored to the grid with a real mailto: href. */
  async function quickLog(activityType, notes) {
    if (!lead?.id || !profile?.id) return
    const { error: insErr } = await supabase.from('lead_activities').insert([{
      lead_id:       lead.id,
      activity_type: activityType,
      outcome:       null,
      notes,
      created_by:    profile.id,
    }])
    if (insErr) {
      // Surface the failure so the rep knows the click wasn't logged.
      setError(`Could not log ${activityType}: ${insErr.message}`)
      return
    }
    // Phase 33D.5 — after a call, prompt the rep to send a
    // thank-you WhatsApp template. Delayed by 1.5s so the OS
    // dialer's call screen takes priority first; when the rep
    // returns to the app the prompt is waiting.
    if (activityType === 'call') {
      setTimeout(() => setWaPrompt({ stage: 'post_call' }), 1500)
    }
    load()
  }

  // Phase 32P — defer the activity insert so the tel:/wa.me/mailto:
  // navigation gets the user gesture first. setTimeout(0) puts the
  // insert on the next event-loop tick, after the browser has handed
  // off to the system app.
  function fireAndForgetLog(activityType, notes) {
    setTimeout(() => { quickLog(activityType, notes) }, 0)
  }

  async function load() {
    setLoading(true)
    setError('')
    const [leadRes, actRes] = await Promise.all([
      supabase.from('leads')
        .select(`*,
                 assigned:assigned_to(id, name, team_role, city),
                 telecaller:telecaller_id(id, name, team_role)`)
        .eq('id', id)
        .maybeSingle(),
      supabase.from('lead_activities')
        .select('*, user:created_by(id, name)')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    if (leadRes.error || !leadRes.data) {
      setError(leadRes.error?.message || 'Lead not found or RLS denied.')
      setLead(null)
    } else {
      setLead(leadRes.data)
    }
    setActivities(actRes.data || [])
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [id])

  /* ─── Phase 19 — Realtime: keep this lead + activity list fresh ─── */
  useEffect(() => {
    if (!id) return
    const ch = supabase
      .channel(`lead-detail-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leads', filter: `id=eq.${id}` },
        (payload) => {
          // Merge incoming row into local state, but preserve already-joined
          // assigned / telecaller objects (the realtime payload is unjoined).
          setLead(prev => prev ? { ...prev, ...payload.new } : prev)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lead_activities', filter: `lead_id=eq.${id}` },
        () => { load() }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    /* eslint-disable-next-line */
  }, [id])

  /* ─── Phase 19 — Inline-edit save callback (optimistic local merge) ─── */
  function onLeadFieldSaved(field, value) {
    setLead(prev => prev ? { ...prev, [field]: value } : prev)
  }

  /* ─── Convert lead → quote (prefill wizard) ─── */
  function convertToQuote() {
    if (!lead) return
    navigate(lead.segment === 'GOVERNMENT' ? '/quotes/new/government' : '/quotes/new/private', {
      state: {
        prefill: {
          client_name:    lead.name,
          client_company: lead.company || '',
          client_phone:   lead.phone || '',
          client_email:   lead.email || '',
          client_address: '',
          client_notes:   lead.notes || '',
          lead_id:        lead.id,
        },
      },
    })
  }

  /* ─── Stage history (status_change activities, oldest first) ─── */
  const stageHistory = useMemo(() => {
    return activities
      .filter(a => a.activity_type === 'status_change')
      .slice()
      .reverse()
  }, [activities])

  if (loading) {
    return (
      <div className="lead-root" style={{ padding: 24 }}>
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          Loading lead…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="lead-root">
        <button className="lead-btn" onClick={() => navigate('/leads')} style={{ marginBottom: 16 }}>
          <ArrowLeft size={14} /> Back to Leads
        </button>
        <div
          className="lead-card"
          style={{
            background: 'var(--danger-soft)',
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13,
          }}
        >
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      </div>
    )
  }
  if (!lead) return null

  const sla = slaInfo(lead.handoff_sla_due_at)

  // Phase 33D.6 — stale banner. If last_contact_at > 30 days, surface
  // a yellow banner with last note. Reduces context-switching cost.
  const daysSinceContact = lead.last_contact_at
    ? Math.floor((Date.now() - new Date(lead.last_contact_at).getTime()) / 86400000)
    : null
  const lastNote = activities.find(a => a.notes)?.notes
  const isStale = daysSinceContact !== null && daysSinceContact >= 30

  async function toggleChasePaused() {
    await supabase
      .from('leads')
      .update({ cadence_paused: !lead.cadence_paused })
      .eq('id', lead.id)
    load()
  }
  const heatLabel = lead.heat ? lead.heat[0].toUpperCase() + lead.heat.slice(1) : null

  return (
    <div className="lead-root">
      {/* Back link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, marginBottom: 12, cursor: 'pointer' }}
           onClick={() => navigate('/leads')}>
        <ArrowLeft size={12} />
        <span>Back to leads</span>
      </div>

      {/* Phase 33D.6 — stale-lead banner. Shown when no contact in 30+ days. */}
      {isStale && (
        <div style={{
          background: 'rgba(245, 158, 11, .08)',
          border: '1px solid var(--warning, #F59E0B)',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12,
          fontSize: 13,
        }}>
          <div style={{ color: 'var(--warning)', fontWeight: 600 }}>
            Last contact: {daysSinceContact} days ago
          </div>
          {lastNote && (
            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
              Last note: "{lastNote.slice(0, 160)}{lastNote.length > 160 ? '…' : ''}"
            </div>
          )}
        </div>
      )}

      {/* Phase 33D.6 — Stop chasing toggle. Sets cadence_paused so
          stage-change triggers + 30-day nurture cycles skip this lead. */}
      {(lead.stage === 'Lost' || lead.stage === 'Nurture') && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', marginBottom: 10,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {lead.cadence_paused
              ? 'Auto follow-ups paused for this lead'
              : 'Auto follow-ups active (30-day cadence)'}
          </span>
          <button className="lead-btn lead-btn-sm" onClick={toggleChasePaused}>
            {lead.cadence_paused ? 'Resume' : 'Stop chasing'}
          </button>
        </div>
      )}

      {/* ─── Header card (Phase 30B rebuild) ────────────────
          Goals (owner spec, 7 May 2026):
          - Title never repeats name + company when they're identical
            ("Untitled Gsrtc / Untitled Gsrtc" was the bug).
          - Status chips on ONE compact row, not scattered with stray
            "COLD" / "PRIVATE" labels floating around.
          - Meta (source / assigned / telecaller / last contact) on a
            separate, smaller line — distinct visual hierarchy.
          - Action bar: ONE primary action that changes by stage,
            secondary actions as small icons. No more 6-button row. */}
      <div
        className="lead-hero-card lead-card lead-card-pad"
        style={{ marginBottom: 16 }}
      >
        {/* Top row: title block (left) + value (right on desktop) */}
        <div className="lead-hero-top">
          <div className="lead-hero-title-block">
            {/* Title: prefer company (B2B context); contact name as
                subtitle when distinct. If name == company, show only once. */}
            {(() => {
              const company = (lead.company || '').trim()
              const name    = (lead.name    || '').trim()
              const title   = company || name || '—'
              const sub     = (company && name && company.toLowerCase() !== name.toLowerCase())
                              ? name : null
              return (
                <>
                  <div className="lead-hero-title">{title}</div>
                  {sub && <div className="lead-hero-sub">{sub}</div>}
                </>
              )
            })()}

            {/* Status row: stage + heat + segment, in that order, no separators
                Phase 31T — stage chip is now clickable.
                Phase 32L — owner reported (10 May 2026) "when we change
                stage of lead it's not changing". Root cause was NOT the
                save logic (works) but discoverability — the chip looked
                like a static badge with zero visible affordance. The
                only hint was a `title=` tooltip, invisible on touch. Fix
                wraps chip + ChevronDown in a pill-styled button with a
                subtle border + hover state so it reads as "tap me". The
                Stage button is also restored to the action grid below
                as a second path for reps with muscle memory from <31T. */}
            <div className="lead-hero-chips">
              {/* Phase 33J (F6 fix) — added an explicit "Change" label
                  next to the chevron. ChevronDown alone wasn't a clear
                  enough tap-target for low-literacy reps; the word
                  removes ambiguity. */}
              <button
                type="button"
                onClick={() => setActiveModal('stage')}
                title="Tap to change stage"
                className="lead-stage-chip-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'var(--surface-2, rgba(255,255,255,.04))',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: 999, padding: '2px 8px 2px 4px',
                  cursor: 'pointer', font: 'inherit',
                }}
              >
                <StageChip stage={lead.stage} slaBreached={!!sla && sla.tone === 'danger'} />
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: '.08em',
                  color: 'var(--text-muted)', textTransform: 'uppercase',
                  marginLeft: 2,
                }}>Change</span>
                <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
              </button>
              {lead.heat && (
                <span className="lead-hero-heat">
                  <HeatDot heat={lead.heat} />
                  <span className="lead-hero-heat-label">{heatLabel}</span>
                </span>
              )}
              {lead.segment && <SegChip segment={lead.segment} />}
            </div>

            {/* Meta row: source · assigned · telecaller · last contact */}
            <div className="lead-hero-meta">
              {lead.source && <span>Source · <b>{lead.source}</b></span>}
              {lead.assigned?.name && (
                <span>· Assigned <b>{lead.assigned.name}</b>{lead.assigned.city ? ` · ${lead.assigned.city}` : ''}</span>
              )}
              {lead.telecaller?.name && (
                <span>· Telecaller <b>{lead.telecaller.name}</b></span>
              )}
              {lead.last_contact_at && (
                <span>· last contact {formatRelative(lead.last_contact_at)}</span>
              )}
            </div>
          </div>

          {/* Expected value — only render when non-zero. An empty card
              taking a full row of vertical space (with just '—') was
              dead weight on mobile. */}
          {lead.expected_value ? (
            <div className="lead-hero-value">
              <div className="lead-hero-value-label">Expected value</div>
              <div className="lead-hero-value-num has-val">
                {formatCurrency(lead.expected_value)}
              </div>
            </div>
          ) : null}
        </div>

        {/* Action bar — ONE primary CTA + compact secondary icons.
            Primary = "next best action" by stage:
              has quote        -> View quote
              else not closed  -> Convert (or Call if no quote yet and we have a phone)
              closed (Won/Lost) -> nothing primary */}
        <div className="lead-hero-actions">
          {/* PRIMARY */}
          {lead.quote_id ? (
            <button
              className="lead-btn lead-btn-primary lead-btn-lg"
              onClick={() => navigate(
                lead.segment === 'GOVERNMENT' ? `/proposal/${lead.quote_id}` : `/quotes/${lead.quote_id}`
              )}
            >
              <FileTextIcon size={14} /> View quote
            </button>
          ) : (lead.stage !== 'Won' && lead.stage !== 'Lost') ? (
            <button className="lead-btn lead-btn-primary lead-btn-lg" onClick={convertToQuote}>
              <FileTextIcon size={14} /> Convert to quote
            </button>
          ) : null}

          {/* Phase 31L — owner reported (10 May 2026) the standalone
              "Call" button was a duplicate. The 8-action grid below
              already includes a Call button that does the same thing
              (tel: + quickLog). Showing both, in two different sizes,
              for a cold lead with a phone was visually confusing. The
              "call cold leads first" nudge happens via the green hero
              card's "Working" badge + the prominent grid placement. */}

          {/* TERTIARY — labelled pills (Phase 30B rev2 — owner: icons
              alone don't tell reps what they do). 3-per-row grid on
              mobile, inline on desktop.
              Phase 30C rev2 — Call / WhatsApp / Email are FAST-PATH:
              they open the relevant app AND fire a quickLog insert
              in one click. No more "click button → fill form → save".
              Meeting / Note still open the modal because those need
              free-text notes to be useful. */}
          {/* Phase 31T — owner audit caught this back at 8 buttons.
              Cut to 5 (the Phase 31L+M target):
                Call · WhatsApp · Note · Follow-up · Voice
              Email moved out of the grid (the lead.email field in the
              Lead Details panel below is clickable mailto:; reps who
              actually email — mostly govt — go through there).
              Meeting moved out — recording a past meeting goes via
              Note (or Voice for non-typing reps); scheduling a future
              meeting goes via Follow-up.
              Stage moved out — the stage chip itself is now the
              click target (rendered in the green hero card above).
              Note opens LogActivityModal in 'note' mode (free-text),
              Follow-up opens it in 'note' mode AND scrolls to the
              schedule-follow-up section so the rep doesn't need to
              hunt for it (Phase 31B nudge preserved, just no longer
              a duplicate Note button). */}
          {/* Phase 32P — Call / WhatsApp / Email rewritten end-to-end.
              All three follow the same pattern:
                - Phone/email cleaned + validated SYNCHRONOUSLY
                - href set to the resolved tel:/wa.me/mailto: URL
                - fireAndForgetLog defers the activity insert to the
                  next event-loop tick so the OS app handoff wins
                  the race
                - If no phone / email available, fall back to opening
                  the LogActivityModal so the rep can still record
                  the touch manually (e.g. they called from another
                  device, or want to email from desktop client) */}
          {/* Phase 33P (owner directive) — final 4-button primary grid.
              Owner's mockup:
                ┌──────────────────────┐
                │  Convert to quote    │   (top, already above)
                ├──────────┬───────────┤
                │  Call    │ WhatsApp  │   row 1
                ├──────────┼───────────┤
                │  Meeting │ Voice     │   row 2
                ├──────────┴───────────┤
                │       More ↓         │   row 3 (full-width toggle)
                └──────────────────────┘
              2-col grid, bigger tap targets. Note moves into More.
              Stage stays in More (chip in hero is still primary path).
              Photo/Email/Follow-up stay in More. */}
          <div
            className="lead-hero-actions-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            {(() => {
              const phone = cleanPhone(lead.phone)
              return phone ? (
                <a
                  href={`tel:+${phone}`}
                  className="lead-btn lead-btn-sm"
                  onClick={() => fireAndForgetLog('call', `Call → ${lead.phone}`)}
                  style={{ textDecoration: 'none' }}
                >
                  <Phone size={13} /> <span>Call</span>
                </a>
              ) : (
                <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('call')}>
                  <Phone size={13} /> <span>Call</span>
                </button>
              )
            })()}
            {/* Phase 33L — long-press WhatsApp = blank chat (no template).
                Tap = stage-aware template (Phase 33D.5 default).
                Hold for >500ms = wa.me link only, no template prompt. */}
            {(() => {
              const phone = cleanPhone(lead.phone)
              if (!phone) {
                return (
                  <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('whatsapp')}>
                    <MessageCircle size={13} /> <span>WhatsApp</span>
                  </button>
                )
              }
              let pressTimer = null
              let longPressed = false
              const start = () => {
                longPressed = false
                pressTimer = setTimeout(() => {
                  longPressed = true
                  fireAndForgetLog('whatsapp', `WhatsApp blank → ${lead.phone}`)
                  window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer')
                }, 500)
              }
              const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null } }
              const tap = (e) => {
                cancel()
                if (longPressed) { e.preventDefault(); return }
                fireAndForgetLog('whatsapp', `WhatsApp → ${lead.phone}`)
              }
              return (
                <a
                  href={`https://wa.me/${phone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lead-btn lead-btn-sm"
                  onClick={tap}
                  onMouseDown={start}
                  onTouchStart={start}
                  onMouseUp={cancel}
                  onTouchEnd={cancel}
                  onMouseLeave={cancel}
                  onContextMenu={(e) => e.preventDefault()}
                  title="Tap for default template. Hold for blank chat."
                  style={{ textDecoration: 'none', userSelect: 'none' }}
                >
                  <MessageCircle size={13} /> <span>WhatsApp</span>
                </a>
              )
            })()}
            <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('meeting')}>
              <Calendar size={13} /> <span>Meeting</span>
            </button>
            {/* Phase 33P (owner mockup) — Voice restored to primary 4.
                Note moved into the More drawer below. */}
            <button
              className="lead-btn lead-btn-sm"
              onClick={() => navigate(`/voice?lead=${lead.id}`)}
              title="Voice log (Gujarati / Hindi / English)"
            >
              <Mic size={13} /> <span>Voice</span>
            </button>
          </div>

          {/* Phase 33P — More toggle as its own full-width row below
              the 2x2 primary grid. Bigger tap target. */}
          <button
            className="lead-btn lead-btn-sm"
            onClick={() => setMoreOpen(v => !v)}
            title="More actions"
            aria-expanded={moreOpen}
            style={{
              width: '100%', marginTop: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6,
            }}
          >
            <MoreHorizontal size={13} /> <span>More</span>
            <ChevronDown
              size={11}
              style={{
                marginLeft: 2,
                transform: moreOpen ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform .15s',
              }}
            />
          </button>

          {/* Phase 33G.2 — More drawer. Hidden by default; opens to a
              second 4-button row when the rep taps More. Same
              lead-hero-actions-grid styling so it reads as a natural
              extension. Stays open until rep taps Less. */}
          {moreOpen && (
            <div
              className="lead-hero-actions-grid"
              style={{ marginTop: 8 }}
            >
              {/* Phase 33P — Note moved here from primary grid. */}
              <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('note')}>
                <Edit3 size={13} /> <span>Note</span>
              </button>
              {/* Email — falls back to LogActivityModal when lead has
                  no email on file (most govt leads). */}
              {lead.email ? (
                <a
                  href={`mailto:${lead.email}?subject=${encodeURIComponent('Outdoor advertising — ' + (lead.company || lead.name || ''))}`}
                  className="lead-btn lead-btn-sm"
                  onClick={() => fireAndForgetLog('email', `Email → ${lead.email}`)}
                  style={{ textDecoration: 'none' }}
                >
                  <Mail size={13} /> <span>Email</span>
                </a>
              ) : (
                <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('email')}>
                  <Mail size={13} /> <span>Email</span>
                </button>
              )}
              <button
                className="lead-btn lead-btn-sm"
                onClick={() => setActivityType('followup')}
                title="Schedule a follow-up date"
              >
                <Clock size={13} /> <span>Follow-up</span>
              </button>
              <button
                className="lead-btn lead-btn-sm"
                onClick={() => setActiveModal('stage')}
                title="Change stage"
              >
                <RefreshCw size={13} /> <span>Stage</span>
              </button>
              {/* Phase 33L (F7 fix) — OCR field merge now asks the rep
                  to confirm when OCR has a value AND the existing
                  field is non-empty AND they differ. Empty fields get
                  patched silently as before. */}
              <PhotoCapture
                leadId={lead.id}
                profileId={profile?.id}
                onSaved={() => load()}
                onPatchLead={async (fields) => {
                  const patch = {}
                  const conflicts = []
                  ;[
                    ['name',    'Name'],
                    ['phone',   'Phone'],
                    ['email',   'Email'],
                    ['company', 'Company'],
                  ].forEach(([key, label]) => {
                    const ocrVal = (fields[key] || '').trim()
                    const curVal = (lead[key] || '').trim()
                    if (!ocrVal) return
                    if (!curVal) {
                      patch[key] = ocrVal
                    } else if (curVal.toLowerCase() !== ocrVal.toLowerCase()) {
                      conflicts.push({ key, label, curVal, ocrVal })
                    }
                  })

                  // Resolve conflicts via simple confirm prompts.
                  // For each conflict, ask "Replace X with Y from card?"
                  conflicts.forEach(c => {
                    const msg = `${c.label}: replace "${c.curVal}" with "${c.ocrVal}" from the scanned card?`
                    if (confirm(msg)) patch[c.key] = c.ocrVal
                  })

                  if (Object.keys(patch).length === 0) { load(); return }
                  await supabase.from('leads').update(patch).eq('id', lead.id)
                  load()
                }}
              />
            </div>
          )}
          {/* Phase 33B.4 — "I'm here" auto-checkin row. Locked 10-min
              dwell per owner decision. Shown only after the rep taps
              I'm here; otherwise the button is in the grid above. */}
          {/* Phase 33L (F10 fix) — Save now made bigger + first in tap
              order. Quick visits (under 10 min) don't need the rep to
              wait out the countdown — they tap Save now the moment the
              meeting ends. Cancel demoted to a small secondary action. */}
          {hereGps && (
            <div style={{
              marginTop: 12,
              padding: '12px 14px',
              background: 'rgba(255,230,0,0.10)',
              border: '1px solid var(--accent, #FFE600)',
              borderRadius: 10,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{
                fontSize: 13, color: 'var(--text)',
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', gap: 10,
              }}>
                <span><strong>I'm here</strong> · auto-saving in {Math.floor(hereCountdown / 60)}:{String(hereCountdown % 60).padStart(2,'0')}</span>
                <button
                  onClick={() => { setHereGps(null); setHereCountdown(0) }}
                  style={{
                    background: 'none', border: 0,
                    color: 'var(--text-muted)', fontSize: 11,
                    cursor: 'pointer', padding: 4,
                    textDecoration: 'underline',
                  }}
                >
                  Cancel
                </button>
              </div>
              <button
                className="lead-btn lead-btn-primary"
                onClick={saveHereMeeting}
                style={{
                  width: '100%', padding: '10px 14px',
                  fontSize: 14, fontWeight: 700,
                  background: 'var(--accent, #FFE600)',
                  color: 'var(--accent-fg, #0f172a)',
                  border: 0, borderRadius: 8, cursor: 'pointer',
                }}
              >
                Save meeting now
              </button>
            </div>
          )}
          {!hereGps && lead.phone && (
            <button
              className="lead-btn lead-btn-sm"
              onClick={imHere}
              style={{
                marginTop: 10,
                borderColor: 'var(--accent, #FFE600)',
                background: 'rgba(255,230,0,0.06)',
              }}
            >
              <MapPin size={13} /> I'm here (auto-log in 10 min)
            </button>
          )}
        </div>
      </div>

      {/* ─── Two-column on desktop, stacked on mobile (Phase 30B rev2).
          Owner screenshot showed both cols crammed side-by-side at
          mobile width, "untitledgsrtc@gmail.com" wrapping mid-word.
          The grid now collapses to a single column at <960px. */}
      <div className="lead-detail-body">
        {/* LEFT — Activity timeline */}
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Activity timeline</div>
              <div className="lead-card-sub">
                {activities.length} {activities.length === 1 ? 'entry' : 'entries'} · last {Math.min(activities.length, 200)} shown
              </div>
            </div>
          </div>
          {activities.length === 0 ? (
            <div className="lead-card-pad" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              No activity yet — start with a call or note from the action buttons above.
            </div>
          ) : (
            <div className="lead-timeline">
              {activities.map((a, i) => {
                const Icon = ACTIVITY_ICON[a.activity_type] || Edit3
                const color = ACTIVITY_COLOR[a.activity_type] || 'amber'
                const dur = formatDuration(a.duration_seconds)
                // Phase 30G — mark the most-recent (top) row as fresh
                // for one render so it pops in via CSS keyframe. Only
                // applies when the row is from the last 5s — keeps
                // animation tied to "I just saved" and doesn't fire on
                // every reload of an old timeline.
                const ageMs = Date.now() - new Date(a.created_at).getTime()
                const isFresh = i === 0 && ageMs < 5000
                return (
                  <div className={`tl-row${isFresh ? ' tl-row-fresh' : ''}`} key={a.id}>
                    <div className={`tl-icon ${color}`}><Icon size={14} /></div>
                    <div>
                      <div className="tl-head">
                        <span className="tl-title">
                          {ACTIVITY_TITLE[a.activity_type] || a.activity_type}
                          {dur ? ` · ${dur}` : ''}
                        </span>
                        <OutcomeChip outcome={a.outcome} />
                        <span className="tl-time">{formatRelative(a.created_at)}</span>
                      </div>
                      {a.notes && <div className="tl-body">{a.notes}</div>}
                      {a.next_action && (
                        <div className="tl-next">
                          {/* Phase 31V — next_action_time was being saved
                              by the voice flow (Phase 31J) but never
                              displayed. Now: 'Send quote · 12 May · 14:30'. */}
                          <Clock size={11} /> Next: {a.next_action}
                          {a.next_action_date ? ` · ${formatDate(a.next_action_date)}` : ''}
                          {a.next_action_time ? ` · ${String(a.next_action_time).slice(0, 5)}` : ''}
                        </div>
                      )}
                      {(a.gps_lat && a.gps_lng) && (
                        <div className="tl-gps">
                          <MapPin size={10} /> {Number(a.gps_lat).toFixed(4)}, {Number(a.gps_lng).toFixed(4)}
                          {a.gps_accuracy_m ? ` · ±${a.gps_accuracy_m}m` : ''}
                        </div>
                      )}
                      {a.user?.name && (
                        <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                          by {a.user.name}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT — side panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Lead details — Phase 19 inline-edit */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div className="lead-card-title">Lead details</div>
              <span className="lead-card-sub" style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                Click any field to edit
              </span>
            </div>
            <div className="lead-card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
              {/* Phase 32P — the inline-edit field opens edit mode on
                  click, which blocks the obvious "tap to call" / "tap
                  to email" affordance. Small action icon next to each
                  value gives a clear separate path: tap icon = call /
                  email, tap text = edit. */}
              <FieldCell label="Phone">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InlineField value={lead.phone} field="phone" leadId={lead.id} type="tel" onSaved={onLeadFieldSaved} />
                  </div>
                  {cleanPhone(lead.phone) && (
                    <a
                      href={`tel:+${cleanPhone(lead.phone)}`}
                      onClick={() => fireAndForgetLog('call', `Call → ${lead.phone}`)}
                      title="Call now"
                      style={{
                        color: 'var(--accent)', textDecoration: 'none',
                        display: 'inline-flex', padding: 4,
                      }}
                    >
                      <Phone size={14} />
                    </a>
                  )}
                </div>
              </FieldCell>
              <FieldCell label="Email">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InlineField value={lead.email} field="email" leadId={lead.id} type="email" onSaved={onLeadFieldSaved} />
                  </div>
                  {lead.email && (
                    <a
                      href={`mailto:${lead.email}?subject=${encodeURIComponent('Outdoor advertising — ' + (lead.company || lead.name || ''))}`}
                      onClick={() => fireAndForgetLog('email', `Email → ${lead.email}`)}
                      title="Email now"
                      style={{
                        color: 'var(--accent)', textDecoration: 'none',
                        display: 'inline-flex', padding: 4,
                      }}
                    >
                      <Mail size={14} />
                    </a>
                  )}
                </div>
              </FieldCell>
              <FieldCell label="City">
                <InlineField value={lead.city}     field="city"     leadId={lead.id} onSaved={onLeadFieldSaved} />
              </FieldCell>
              <FieldCell label="Industry">
                <InlineField value={lead.industry} field="industry" leadId={lead.id} onSaved={onLeadFieldSaved} />
              </FieldCell>
              <FieldCell label="Source">
                <InlineField value={lead.source}   field="source"   leadId={lead.id} onSaved={onLeadFieldSaved} />
              </FieldCell>
              <FieldCell label="Created">
                <span>{lead.created_at ? formatDate(lead.created_at) : '—'}</span>
              </FieldCell>
              <div style={{ gridColumn: '1 / span 2', borderTop: '1px solid var(--border-soft, rgba(255,255,255,.06))', paddingTop: 10, marginTop: 4 }}>
                <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 4 }}>
                  Notes
                </div>
                <InlineField
                  value={lead.notes}
                  field="notes"
                  leadId={lead.id}
                  multiline
                  onSaved={onLeadFieldSaved}
                  placeholder="Click to add notes…"
                />
              </div>
            </div>
          </div>

          {/* Ownership */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div className="lead-card-title">Ownership</div>
              {isPrivileged && (
                <span className="lead-card-link" onClick={() => setActiveModal('reassign')}>
                  <UsersIcon size={11} /> Reassign
                </span>
              )}
            </div>
            <div className="lead-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Assigned to</span>
                {lead.assigned?.name ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LeadAvatar name={lead.assigned.name} userId={lead.assigned.id} />
                    {lead.assigned.name}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-subtle)' }}>Unassigned</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Telecaller</span>
                {lead.telecaller?.name ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LeadAvatar name={lead.telecaller.name} userId={lead.telecaller.id} />
                    {lead.telecaller.name}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-subtle)' }}>—</span>
                )}
              </div>
              {sla && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Hand-off SLA</span>
                  <Pill tone={sla.tone}>{sla.label}</Pill>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Contact attempts</span>
                <span className="mono">{lead.contact_attempts_count || 0}</span>
              </div>
            </div>
          </div>

          {/* Stage history */}
          <div className="lead-card">
            <div className="lead-card-head">
              <div className="lead-card-title">Stage history</div>
            </div>
            <div className="lead-card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <Row label="Created"   right={<span className="mono">{lead.created_at ? formatDate(lead.created_at) : '—'}</span>} />
              {lead.qualified_at && (
                <Row label="Qualified" right={<span className="mono">{formatDate(lead.qualified_at)}</span>} />
              )}
              {lead.sales_ready_at && (
                <Row label="Sales Ready" right={<span className="mono">{formatDate(lead.sales_ready_at)}</span>} />
              )}
              {stageHistory.slice(0, 5).map(h => (
                <Row
                  key={h.id}
                  label={h.notes?.split(' · ')[0] || 'Status change'}
                  right={
                    <span style={{ color: 'var(--text-muted)' }}>
                      {h.user?.name ? `${h.user.name} · ` : ''}
                      <span className="mono">{formatDate(h.created_at)}</span>
                    </span>
                  }
                />
              ))}
              {lead.lost_reason && (
                <Row label="Lost reason" right={<Pill tone="danger">{lead.lost_reason}</Pill>} />
              )}
              {lead.nurture_revisit_date && (
                <Row label="Nurture revisit" right={<span className="mono">{formatDate(lead.nurture_revisit_date)}</span>} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {activityType && (
        <LogActivityModal
          lead={lead}
          // Phase 31T — 'followup' is a UI shorthand that opens the note
          // modal pre-focused on the schedule-follow-up section. The
          // saved activity_type is still 'note' (the only valid CHECK
          // value for free-text rows). The focusFollowup prop just
          // scrolls the modal to that section on mount.
          type={activityType === 'followup' ? 'note' : activityType}
          focusFollowup={activityType === 'followup'}
          onClose={() => setActivityType(null)}
          onSaved={load}
        />
      )}
      {activeModal === 'stage' && (
        <ChangeStageModal
          lead={lead}
          onClose={() => setActiveModal(null)}
          onSaved={(newStage) => {
            load()
            // Phase 33D.5 — open the post-stage-change WhatsApp prompt
            // with the new stage's template. ChangeStageModal calls
            // onSaved() with no args, so we re-fetch the lead first
            // (load() above) then pick up the new stage from the
            // refreshed lead state via a small delay. Simpler: just
            // open the prompt with whatever the modal moved TO. The
            // modal already validates the stage is valid.
            // To avoid coupling, fetch the lead again ourselves here.
            setTimeout(async () => {
              const { data } = await supabase
                .from('leads').select('stage').eq('id', lead.id).maybeSingle()
              if (data?.stage) setWaPrompt({ stage: data.stage })
            }, 200)
          }}
        />
      )}
      {activeModal === 'reassign' && (
        <ReassignModal
          lead={lead}
          onClose={() => setActiveModal(null)}
          onSaved={load}
        />
      )}
      {/* Phase 33D.5 — post-action WhatsApp prompt. Opens after
          quick-Call, after stage change, etc. Lead object stays
          current via the load() refetch that precedes it. */}
      <WhatsAppPromptModal
        open={!!waPrompt}
        stage={waPrompt?.stage}
        lead={lead}
        profile={profile}
        onClose={() => setWaPrompt(null)}
      />
    </div>
  )
}

function Row({ label, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{label}</span>
      <span>{right}</span>
    </div>
  )
}

/* ─── Phase 19 — inline-edit cells ─── */
function FieldCell({ label, children }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          color: 'var(--text-subtle)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ wordBreak: 'break-word' }}>{children}</div>
    </div>
  )
}

function InlineField({
  value,
  field,
  leadId,
  type = 'text',
  multiline = false,
  placeholder = 'Click to add…',
  onSaved,
}) {
  const [val, setVal] = useState(value ?? '')
  const [original, setOriginal] = useState(value ?? '')
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState('idle') // idle | saving | saved | error
  const [errMsg, setErrMsg] = useState('')

  // External value can change (after re-fetch / realtime push) — re-sync.
  useEffect(() => {
    setVal(value ?? '')
    setOriginal(value ?? '')
  }, [value])

  async function persist() {
    setEditing(false)
    const trimmed = (val || '').trim()
    const before = (original || '').trim()
    if (trimmed === before) {
      setStatus('idle')
      return
    }
    setStatus('saving')
    setErrMsg('')
    const { error } = await supabase
      .from('leads')
      .update({ [field]: trimmed || null })
      .eq('id', leadId)
    if (error) {
      setStatus('error')
      setErrMsg(error.message || 'save failed')
      // Revert visual to last-known-good. RLS may have rejected — keep
      // the user's typed value briefly so they can copy it before reset.
      setTimeout(() => setVal(before), 1200)
      return
    }
    setOriginal(trimmed)
    setStatus('saved')
    setTimeout(() => setStatus('idle'), 1100)
    if (onSaved) onSaved(field, trimmed || null)
  }

  if (editing) {
    const commonProps = {
      autoFocus: true,
      value: val,
      onChange: e => setVal(e.target.value),
      onBlur: persist,
      onKeyDown: e => {
        if (e.key === 'Escape') {
          setVal(original)
          setEditing(false)
          setStatus('idle')
        }
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault()
          e.target.blur()
        }
      },
      style: {
        width: '100%',
        background: 'var(--surface-3, rgba(255,255,255,.04))',
        border: '1px solid var(--border-strong)',
        borderRadius: 6,
        padding: '6px 8px',
        fontSize: 12,
        color: 'var(--text)',
        fontFamily: 'inherit',
        outline: 'none',
        resize: multiline ? 'vertical' : 'none',
      },
    }
    if (multiline) {
      return <textarea rows={3} {...commonProps} />
    }
    return <input type={type} {...commonProps} />
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
      title="Click to edit (Esc to cancel)"
      style={{
        cursor: 'text',
        wordBreak: 'break-word',
        whiteSpace: multiline ? 'pre-line' : 'normal',
        padding: '2px 4px',
        margin: '-2px -4px',
        borderRadius: 4,
        color: val ? 'var(--text)' : 'var(--text-subtle)',
        minHeight: multiline ? 36 : 'auto',
      }}
    >
      {val || placeholder}
      {status === 'saving' && (
        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-subtle)' }}>
          saving…
        </span>
      )}
      {status === 'saved' && (
        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--success)' }}>
          saved
        </span>
      )}
      {status === 'error' && (
        <span
          style={{ marginLeft: 6, fontSize: 10, color: 'var(--danger)' }}
          title={errMsg}
        >
          save failed — {errMsg}
        </span>
      )}
    </div>
  )
}
