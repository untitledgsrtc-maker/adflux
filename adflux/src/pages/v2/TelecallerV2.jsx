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
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatDate, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, SegChip, LeadAvatar, Pill,
} from '../../components/leads/LeadShared'
import V2Hero from '../../components/v2/V2Hero'
// Phase 43.1 — parity with WorkV2 + LeadDetailV2 call chain. Tel-tap
// audit + post-call outcome capture + auto-refresh.
import PostCallOutcomeModal from '../../components/leads/PostCallOutcomeModal'
import { logCallAudit } from '../../utils/callAudit'
import useAutoRefresh from '../../hooks/useAutoRefresh'
import { pushToast } from '../../components/v2/Toast'

function cleanPhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length === 10 ? '91' + d : d
}

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
  // Phase 43.2 — daily call target for the ring + accountability.
  const [callTarget, setCallTarget] = useState(50)
  // Phase 43.3 — upcoming callbacks (this rep's open follow_ups due
  // in the next 48 hours, joined to the lead for name + phone).
  const [callbacks, setCallbacks] = useState([])

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const startOfDay = `${today}T00:00:00`

    // Phase 43.3 — 48 hour cutoff for callback panel.
    const todayDateISO = new Date().toISOString().slice(0, 10)
    const in2Days = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [leadsRes, callsRes, connectedRes, qualRes, handoffRes, targetRes, callbacksRes] = await Promise.all([
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
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('call_at', startOfDay),
      // Phase 43.2 prep — connected-rate KPI. Count tel-tap rows that
      // came back with outcome='connected' (vs no-answer/busy/etc).
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('outcome', 'connected')
        .gte('call_at', startOfDay),
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
      // Phase 43.2 — read this rep's active daily target for min_calls.
      supabase
        .from('daily_targets')
        .select('min_calls')
        .eq('user_id', profile.id)
        .is('effective_to', null)
        .maybeSingle(),
      // Phase 43.3 — upcoming callbacks (this rep's open follow_ups
      // due today or tomorrow). Joined to lead for name + phone so
      // the panel renders without extra round-trips.
      supabase
        .from('follow_ups')
        .select('id, follow_up_date, follow_up_time, notes, lead_id, leads(id, name, phone, company)')
        .eq('assigned_to', profile.id)
        .eq('is_done', false)
        .gte('follow_up_date', todayDateISO)
        .lte('follow_up_date', in2Days)
        .order('follow_up_date', { ascending: true })
        .order('follow_up_time', { ascending: true, nullsFirst: true })
        .limit(10),
    ])

    setLeads(leadsRes.data || [])
    setCallsToday(callsRes.count || 0)
    setConnectedToday(connectedRes.count || 0)
    setQualifiedToday(qualRes.count || 0)
    setHandoffs(handoffRes.data || [])
    setCallTarget(Number(targetRes?.data?.min_calls) || 50)
    setCallbacks(callbacksRes?.data || [])
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])
  // Phase 43.1 — match sales-frozen contract: auto-refresh queue.
  useAutoRefresh(load)

  // Phase 43.1 — quickLogCall mirrors WorkV2:532 chain.
  // tel: link fires immediately on user gesture (iOS Safari requirement),
  // then logCallAudit + lead_activities insert + open modal 1.5s later.
  async function quickLogCall(lead) {
    if (!lead?.id || !profile?.id) return
    const phone = cleanPhone(lead.phone)
    if (!phone) {
      pushToast('No phone on this lead — open the lead and add the mobile number first.', 'danger')
      return
    }
    setCallLead(lead)
    window.location.href = `tel:+${phone}`
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

  const nextCall = sortedQueue[0] || null

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
      {(queueOpen > 0 || callsToday > 0) && (
        <V2Hero
          eyebrow={`Telecaller · ${profile?.name || 'You'}`}
          value={`${callsToday}/${callTarget}`}
          label={`call${callsToday === 1 ? '' : 's'} today · target ${callTarget}`}
          percent={callTargetPct}
          footerStats={[
            { label: `${connectRatePct}% connected`, value: connectedToday, tint: connectRatePct >= 30 ? '#2BD8A0' : '#F59E0B' },
            { label: 'qualified',                    value: qualifiedToday, tint: '#5AB0FF' },
            { label: 'in queue',                     value: queueOpen,      tint: 'var(--accent, #FFE600)' },
            { label: 'handoffs',                     value: handoffs.length, tint: handoffs.length > 0 ? '#F59E0B' : 'var(--v2-ink-2, #94a3b8)' },
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
          <Pill tone="blue">{callsToday} call{callsToday !== 1 ? 's' : ''} · today</Pill>
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

      {/* Hero next-call card */}
      {nextCall ? (
        <div className="tc-hero" style={{ marginBottom: 16 }}>
          <div className="tc-hero-head">
            <div className="tc-big-av">
              {(nextCall.name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
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
      <div className="lead-stat-strip">
        <Stat label="Calls today"       num={`${callsToday}/${callTarget}`} meta={`${callTargetPct}% of target`} />
        <Stat label="Connect rate"      num={`${connectRatePct}%`}          meta={`${connectedToday} of ${callsToday} connected`} />
        <Stat label="Qualified today"   num={qualifiedToday}                meta="handed off to sales" />
        <Stat label="Pending hand-offs" num={handoffs.length}               meta={overdueCount(handoffs)} />
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
                    {lead.company || '—'}{cb.notes ? ` · ${cb.notes.slice(0, 60)}` : ''}
                  </div>
                </div>
                <Pill tone="warn">{dateLabel}{timeLabel ? ` · ${timeLabel}` : ''}</Pill>
                {lead.phone && (
                  <button
                    type="button"
                    className="tc-call-cta"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => quickLogCall(lead)}
                  >
                    <Phone size={12} /> Call
                  </button>
                )}
              </div>
            )
          })}
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
                  gridTemplateColumns: '10px 1fr auto',
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
          load()
        }}
        onLogMeeting={() => {
          // Telecaller doesn't run LogMeetingModal directly — route
          // them to the lead detail where the meeting flow lives.
          if (callLead?.id) navigate(`/leads/${callLead.id}`)
        }}
      />
    </div>
  )
}

/* ─── Sub-components ─── */
function Stat({ label, num, meta }) {
  return (
    <div className="lead-stat-card">
      <div className="lead-stat-eyebrow">{label}</div>
      <div className="lead-stat-num">{num}</div>
      {meta ? <div className="lead-stat-meta">{meta}</div> : null}
    </div>
  )
}

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
