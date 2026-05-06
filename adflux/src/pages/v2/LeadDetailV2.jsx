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
  AlertTriangle, Clock, Mic,
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
  const isPrivileged = ['admin', 'co_owner', 'sales_manager'].includes(profile?.role)

  const [lead, setLead] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modal state
  const [activeModal, setActiveModal] = useState(null)   // null | 'stage' | 'reassign'
  const [activityType, setActivityType] = useState(null) // null | 'call' | 'whatsapp' | …

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
  const heatLabel = lead.heat ? lead.heat[0].toUpperCase() + lead.heat.slice(1) : null

  return (
    <div className="lead-root">
      {/* Back link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12, marginBottom: 12, cursor: 'pointer' }}
           onClick={() => navigate('/leads')}>
        <ArrowLeft size={12} />
        <span>Back to leads</span>
      </div>

      {/* ─── Header card ─── */}
      <div
        className="lead-card lead-card-pad"
        style={{
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 16,
          alignItems: 'flex-start',
        }}
      >
        {/* Left — name + meta */}
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600 }}>
            {lead.name}
          </div>
          {lead.company && (
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 2 }}>{lead.company}</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <StageChip stage={lead.stage} />
            {lead.heat && (
              <>
                <HeatDot heat={lead.heat} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  {heatLabel}
                </span>
              </>
            )}
            {lead.segment && <SegChip segment={lead.segment} />}
            <span style={{ height: 14, width: 1, background: 'var(--border)' }} />
            {lead.source && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Source · {lead.source}</span>
            )}
            {lead.assigned?.name && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                · Assigned <b style={{ color: 'var(--text)' }}>{lead.assigned.name}</b>
                {lead.assigned.city ? ` · ${lead.assigned.city}` : ''}
              </span>
            )}
            {lead.telecaller?.name && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                · Telecaller <b style={{ color: 'var(--text)' }}>{lead.telecaller.name}</b>
              </span>
            )}
            {lead.last_contact_at && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· last contact {formatRelative(lead.last_contact_at)}</span>
            )}
          </div>
        </div>

        {/* Right — value + action row */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
              Expected value
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600,
                color: lead.expected_value ? 'var(--accent)' : 'var(--text-subtle)',
              }}
            >
              {lead.expected_value ? formatCurrency(lead.expected_value) : '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {lead.phone ? (
              <a
                href={`tel:${lead.phone}`}
                className="lead-btn lead-btn-sm"
                onClick={() => setActivityType('call')}
                style={{ textDecoration: 'none' }}
              >
                <Phone size={12} /> Call
              </a>
            ) : (
              <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('call')}>
                <Phone size={12} /> Call
              </button>
            )}
            <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('meeting')}>
              <Calendar size={12} /> Meeting
            </button>
            <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('note')}>
              <Edit3 size={12} /> Note
            </button>
            <button className="lead-btn lead-btn-sm" onClick={() => setActivityType('whatsapp')}>
              <MessageCircle size={12} /> WA
            </button>
            <button
              className="lead-btn lead-btn-sm"
              onClick={() => navigate(`/voice?lead=${lead.id}`)}
              title="Voice-log this lead — speak in Gujarati / Hindi / English"
            >
              <Mic size={12} /> Voice
            </button>
            <button className="lead-btn lead-btn-sm lead-btn-primary" onClick={() => setActiveModal('stage')}>
              <RefreshCw size={12} /> Stage
            </button>
            {lead.quote_id ? (
              <button
                className="lead-btn lead-btn-sm lead-btn-primary"
                onClick={() => navigate(
                  lead.segment === 'GOVERNMENT' ? `/proposal/${lead.quote_id}` : `/quotes/${lead.quote_id}`
                )}
              >
                <FileTextIcon size={12} /> View quote
              </button>
            ) : (lead.stage !== 'Won' && lead.stage !== 'Lost') && (
              <button className="lead-btn lead-btn-sm lead-btn-primary" onClick={convertToQuote}>
                <FileTextIcon size={12} /> Convert
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Two-column: timeline + side panel ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>
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
              {activities.map(a => {
                const Icon = ACTIVITY_ICON[a.activity_type] || Edit3
                const color = ACTIVITY_COLOR[a.activity_type] || 'amber'
                const dur = formatDuration(a.duration_seconds)
                return (
                  <div className="tl-row" key={a.id}>
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
                          <Clock size={11} /> Next: {a.next_action}
                          {a.next_action_date ? ` · ${formatDate(a.next_action_date)}` : ''}
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
              <FieldCell label="Phone">
                <InlineField value={lead.phone}    field="phone"    leadId={lead.id} type="tel"   onSaved={onLeadFieldSaved} />
              </FieldCell>
              <FieldCell label="Email">
                <InlineField value={lead.email}    field="email"    leadId={lead.id} type="email" onSaved={onLeadFieldSaved} />
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
          type={activityType}
          onClose={() => setActivityType(null)}
          onSaved={load}
        />
      )}
      {activeModal === 'stage' && (
        <ChangeStageModal
          lead={lead}
          onClose={() => setActiveModal(null)}
          onSaved={load}
        />
      )}
      {activeModal === 'reassign' && (
        <ReassignModal
          lead={lead}
          onClose={() => setActiveModal(null)}
          onSaved={load}
        />
      )}
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
