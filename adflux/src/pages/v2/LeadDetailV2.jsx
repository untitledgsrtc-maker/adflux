// src/pages/v2/LeadDetailV2.jsx
//
// Phase 12 (M1) — single lead detail page.
//
// Header: name, company, stage chip, heat, assigned, last contact.
// Body: activity timeline + log-call + log-meeting + stage transition
// + convert-to-quote + reassign.
//
// Stage transitions force decisions:
//   • Lost     → mandatory lost_reason
//   • Nurture  → mandatory nurture_revisit_date (max 90 days out)
//   • SalesReady → 4 mandatory fields (budget, timeline, decision-maker,
//                  service interest) + manual rep pick (per §17.1, rep
//                  required, with city + load shown for the suggested rep)
//
// RLS lets in: admin, govt_partner (for govt leads), assigned sales rep,
// telecaller, sales manager (direct reports).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Phone, MessageCircle, Mail, FileText as FileTextIcon,
  Calendar, MapPin, User, Loader2, Plus, Edit3, RefreshCw,
  CheckCircle2, XCircle, Clock,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import {
  LEAD_STAGES, STAGE_LABELS, STAGE_TINT, LOST_REASONS, HEAT_OPTIONS,
} from '../../hooks/useLeads'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters'

/* ─── Stage chip ─── */
function StageChip({ stage, large = false }) {
  const tint = STAGE_TINT[stage] || 'blue'
  const tintMap = {
    blue:   { bg: 'rgba(96,165,250,.12)',  bd: 'rgba(96,165,250,.30)',  fg: '#60a5fa' },
    green:  { bg: 'rgba(74,222,128,.10)',  bd: 'rgba(74,222,128,.28)',  fg: '#4ade80' },
    amber:  { bg: 'rgba(251,191,36,.10)',  bd: 'rgba(251,191,36,.28)',  fg: '#fbbf24' },
    red:    { bg: 'rgba(248,113,113,.10)', bd: 'rgba(248,113,113,.28)', fg: '#f87171' },
    purple: { bg: 'rgba(192,132,252,.12)', bd: 'rgba(192,132,252,.30)', fg: '#c084fc' },
  }
  const s = tintMap[tint]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: large ? '5px 14px' : '3px 9px', borderRadius: 999,
      fontSize: large ? 13 : 11, fontWeight: 600,
      background: s.bg, border: `1px solid ${s.bd}`, color: s.fg,
      whiteSpace: 'nowrap',
    }}>
      {STAGE_LABELS[stage] || stage}
    </span>
  )
}

const ACTIVITY_ICON = {
  call:          Phone,
  whatsapp:      MessageCircle,
  email:         Mail,
  meeting:       Calendar,
  site_visit:    MapPin,
  note:          Edit3,
  status_change: RefreshCw,
}
const ACTIVITY_COLOR = {
  call:          'blue',
  whatsapp:      'green',
  email:         'amber',
  meeting:       'purple',
  site_visit:    'amber',
  note:          'blue',
  status_change: 'amber',
}

export default function LeadDetailV2() {
  const { id } = useParams()
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const isPrivileged = ['admin', 'co_owner'].includes(profile?.role)

  const [lead, setLead]           = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [savingStage, setSavingStage] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityType, setActivityType] = useState('call')

  // Stage transition modal state
  const [stageModal, setStageModal] = useState(null) // null | { newStage }

  // Activity form draft
  const [draft, setDraft] = useState({
    outcome: '', notes: '', next_action: '', next_action_date: '',
  })
  const [savingActivity, setSavingActivity] = useState(false)

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

  /* ─── Stage transition with mandatory fields ─── */
  function requestStageChange(newStage) {
    if (newStage === lead.stage) return
    setStageModal({ newStage, lost_reason: '', nurture_revisit_date: '',
                    budget_confirmed: false, timeline_confirmed: false,
                    decision_maker_contact: '', service_interest: '',
                    handoff_to: '' })
  }

  async function commitStageChange() {
    const m = stageModal
    if (!m) return

    // Validate mandatory fields
    if (m.newStage === 'Lost' && !m.lost_reason) {
      alert('Lost reason is required.')
      return
    }
    if (m.newStage === 'Nurture' && !m.nurture_revisit_date) {
      alert('Nurture revisit date is required.')
      return
    }
    if (m.newStage === 'SalesReady') {
      if (!m.budget_confirmed || !m.timeline_confirmed
          || !m.decision_maker_contact?.trim() || !m.service_interest?.trim()) {
        alert('All four qualification fields are required for Sales Ready.')
        return
      }
      if (!m.handoff_to) {
        alert('Pick a sales rep to hand off to.')
        return
      }
    }

    setSavingStage(true)
    const patch = { stage: m.newStage }
    if (m.newStage === 'Lost')      patch.lost_reason = m.lost_reason
    if (m.newStage === 'Nurture')   patch.nurture_revisit_date = m.nurture_revisit_date
    if (m.newStage === 'Qualified') patch.qualified_at = new Date().toISOString()
    if (m.newStage === 'SalesReady') {
      patch.qualified_at   = lead.qualified_at || new Date().toISOString()
      patch.sales_ready_at = new Date().toISOString()
      patch.assigned_to    = m.handoff_to
    }
    const { data, error: err } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (!err && (m.newStage === 'SalesReady' || m.newStage === 'Lost' || m.newStage === 'Nurture' || m.newStage === 'Qualified')) {
      // Log a status_change activity for the timeline.
      const noteParts = [`Stage → ${STAGE_LABELS[m.newStage] || m.newStage}`]
      if (m.lost_reason)            noteParts.push(`Reason: ${m.lost_reason}`)
      if (m.nurture_revisit_date)   noteParts.push(`Revisit: ${m.nurture_revisit_date}`)
      if (m.newStage === 'SalesReady') {
        noteParts.push(`Budget ✓ Timeline ✓ DM: ${m.decision_maker_contact} Interest: ${m.service_interest}`)
      }
      await supabase.from('lead_activities').insert([{
        lead_id: id,
        activity_type: 'status_change',
        notes: noteParts.join(' · '),
        created_by: profile.id,
      }])
    }

    setSavingStage(false)
    if (err) {
      alert('Stage change failed: ' + err.message)
      return
    }
    setStageModal(null)
    load()
  }

  /* ─── Activity logging ─── */
  function openActivity(type) {
    setActivityType(type)
    setDraft({ outcome: '', notes: '', next_action: '', next_action_date: '' })
    setActivityOpen(true)
  }

  async function commitActivity() {
    setSavingActivity(true)
    const row = {
      lead_id: id,
      activity_type: activityType,
      outcome: draft.outcome || null,
      notes: draft.notes?.trim() || null,
      next_action: draft.next_action?.trim() || null,
      next_action_date: draft.next_action_date || null,
      created_by: profile.id,
    }
    // Capture GPS when available (browser permission required).
    if (navigator.geolocation) {
      try {
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false, timeout: 4000, maximumAge: 60000,
          })
        })
        row.gps_lat = pos.coords.latitude
        row.gps_lng = pos.coords.longitude
        row.gps_accuracy_m = Math.round(pos.coords.accuracy)
      } catch (e) {
        // Permission denied / unavailable — log without GPS.
      }
    }
    const { error: err } = await supabase.from('lead_activities').insert([row])
    setSavingActivity(false)
    if (err) {
      alert('Could not log activity: ' + err.message)
      return
    }
    setActivityOpen(false)
    load()
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

  /* ─── Render ─── */
  if (loading) return <div className="v2d-loading"><div className="v2d-spinner" />Loading lead…</div>
  if (error)   return (
    <div className="v2d-leads">
      <button className="v2d-ghost v2d-ghost--btn" onClick={() => navigate('/leads')}>
        <ArrowLeft size={14} /> Back to Leads
      </button>
      <div style={{
        marginTop: 16,
        background: 'rgba(248,113,113,.10)',
        border: '1px solid rgba(248,113,113,.28)',
        color: '#f87171',
        borderRadius: 12, padding: '14px 18px', fontSize: 13,
      }}>⚠ {error}</div>
    </div>
  )
  if (!lead) return null

  return (
    <div className="v2d-lead-detail">
      {/* Back link */}
      <button
        className="v2d-ghost v2d-ghost--btn"
        onClick={() => navigate('/leads')}
        style={{ marginBottom: 16 }}
      >
        <ArrowLeft size={14} /> All Leads
      </button>

      {/* ─── Header card ─── */}
      <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="v2d-page-kicker">
              {lead.segment === 'GOVERNMENT' ? 'Govt lead' : lead.segment === 'PRIVATE' ? 'Private lead' : 'Lead'}
              {lead.source && <> · {lead.source}</>}
            </div>
            <h1 className="v2d-page-title" style={{ margin: '4px 0 8px' }}>{lead.name}</h1>
            {lead.company && (
              <div style={{ fontSize: 14, color: 'var(--v2-ink-1)' }}>{lead.company}</div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--v2-ink-2)' }}>
              {lead.phone && (
                <span><Phone size={11} style={{ verticalAlign: 'middle' }} /> <span className="v2d-mono" style={{ fontFamily: 'monospace' }}>{lead.phone}</span></span>
              )}
              {lead.email && (
                <span><Mail size={11} style={{ verticalAlign: 'middle' }} /> {lead.email}</span>
              )}
              {lead.city && (
                <span><MapPin size={11} style={{ verticalAlign: 'middle' }} /> {lead.city}</span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <StageChip stage={lead.stage} large />
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginTop: 8 }}>
              {lead.assigned ? <>Assigned to <strong style={{ color: 'var(--v2-ink-0)' }}>{lead.assigned.name}</strong></> : 'Unassigned'}
            </div>
            {lead.expected_value && (
              <div style={{ fontFamily: 'var(--v2-display)', fontSize: 18, fontWeight: 600, marginTop: 6 }}>
                {formatCurrency(lead.expected_value)}
              </div>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div style={{
          display: 'flex', gap: 8, marginTop: 16, paddingTop: 16,
          borderTop: '1px solid var(--v2-line, rgba(255,255,255,.06))',
          flexWrap: 'wrap',
        }}>
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="v2d-ghost v2d-ghost--btn"
              onClick={() => openActivity('call')}
              style={{ textDecoration: 'none' }}
            >
              <Phone size={14} /> <span>Call</span>
            </a>
          )}
          <button className="v2d-ghost v2d-ghost--btn" onClick={() => openActivity('call')}>
            <Phone size={14} /> <span>Log Call</span>
          </button>
          <button className="v2d-ghost v2d-ghost--btn" onClick={() => openActivity('whatsapp')}>
            <MessageCircle size={14} /> <span>Log WhatsApp</span>
          </button>
          <button className="v2d-ghost v2d-ghost--btn" onClick={() => openActivity('meeting')}>
            <Calendar size={14} /> <span>Log Meeting</span>
          </button>
          <button className="v2d-ghost v2d-ghost--btn" onClick={() => openActivity('note')}>
            <Edit3 size={14} /> <span>Note</span>
          </button>
          {(lead.stage !== 'Won' && lead.stage !== 'Lost') && (
            <button className="v2d-cta" onClick={convertToQuote}>
              <FileTextIcon size={14} /> <span>Convert to Quote</span>
            </button>
          )}
        </div>

        {/* Stage transition pill row */}
        <div style={{ marginTop: 16 }}>
          <div className="v2d-page-kicker" style={{ marginBottom: 8 }}>Move to stage</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {LEAD_STAGES.filter(s => s !== lead.stage).map(s => (
              <button
                key={s}
                onClick={() => requestStageChange(s)}
                disabled={savingStage}
                style={{
                  padding: '5px 12px', borderRadius: 999,
                  border: '1px solid var(--v2-line, rgba(255,255,255,.1))',
                  background: 'transparent',
                  color: 'var(--v2-ink-1)',
                  fontSize: 12, fontWeight: 500,
                  cursor: savingStage ? 'wait' : 'pointer',
                }}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Activity timeline ─── */}
      <div className="v2d-panel">
        <div className="card-head" style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Activity</div>
            <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 2 }}>
              {activities.length} entr{activities.length === 1 ? 'y' : 'ies'}
              {lead.contact_attempts_count > 0 && <> · {lead.contact_attempts_count} contact attempts</>}
              {lead.last_contact_at && <> · last {formatDateTime(lead.last_contact_at)}</>}
            </div>
          </div>
        </div>

        {activities.length === 0 ? (
          <div className="v2d-empty-card" style={{ margin: '20px 18px' }}>
            <div className="v2d-empty-ic"><Clock size={28} /></div>
            <div className="v2d-empty-t">No activity yet</div>
            <div className="v2d-empty-s">Log a call, WhatsApp, or meeting to start the timeline.</div>
          </div>
        ) : (
          <div className="activity">
            {activities.map(a => {
              const Icon = ACTIVITY_ICON[a.activity_type] || Edit3
              const color = ACTIVITY_COLOR[a.activity_type] || 'blue'
              return (
                <div key={a.id} className="act-row" style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    display: 'grid', placeItems: 'center',
                    background:
                      color === 'green'  ? 'rgba(74,222,128,.10)'  :
                      color === 'red'    ? 'rgba(248,113,113,.10)' :
                      color === 'amber'  ? 'rgba(251,191,36,.10)'  :
                      color === 'purple' ? 'rgba(192,132,252,.12)' :
                                           'rgba(96,165,250,.12)',
                    color:
                      color === 'green'  ? '#4ade80'  :
                      color === 'red'    ? '#f87171'  :
                      color === 'amber'  ? '#fbbf24'  :
                      color === 'purple' ? '#c084fc'  :
                                           '#60a5fa',
                  }}>
                    <Icon size={14} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--v2-ink-0)', fontWeight: 500 }}>
                      {a.activity_type.replace('_', ' ')}
                      {a.outcome && (
                        <span style={{
                          marginLeft: 8, fontSize: 11, fontWeight: 600,
                          color:
                            a.outcome === 'positive' ? '#4ade80' :
                            a.outcome === 'negative' ? '#f87171' :
                                                       '#fbbf24',
                        }}>
                          · {a.outcome}
                        </span>
                      )}
                    </div>
                    {a.notes && <div style={{ fontSize: 12, color: 'var(--v2-ink-1)', marginTop: 2 }}>{a.notes}</div>}
                    {a.next_action && (
                      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 4 }}>
                        Next: {a.next_action}{a.next_action_date && <> · {formatDate(a.next_action_date)}</>}
                      </div>
                    )}
                    {a.user?.name && (
                      <div style={{ fontSize: 10, color: 'var(--v2-ink-2)', marginTop: 4, letterSpacing: '.04em' }}>
                        by {a.user.name}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', fontFamily: 'monospace' }}>
                    {formatDateTime(a.created_at)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Activity log modal ─── */}
      {activityOpen && (
        <ActivityModal
          activityType={activityType}
          draft={draft}
          setDraft={setDraft}
          saving={savingActivity}
          onCancel={() => setActivityOpen(false)}
          onCommit={commitActivity}
        />
      )}

      {/* ─── Stage transition modal ─── */}
      {stageModal && (
        <StageModal
          modal={stageModal}
          setModal={setStageModal}
          saving={savingStage}
          onCancel={() => setStageModal(null)}
          onCommit={commitStageChange}
          leadCity={lead.city}
          leadSegment={lead.segment}
        />
      )}
    </div>
  )
}

/* ─── Activity log modal ─── */
function ActivityModal({ activityType, draft, setDraft, saving, onCancel, onCommit }) {
  const Icon = ACTIVITY_ICON[activityType] || Edit3
  return (
    <div className="mo" onClick={(e) => { if (e.target === e.currentTarget && !saving) onCancel() }}>
      <div className="md" style={{ maxWidth: 480 }}>
        <div className="md-h">
          <div className="md-t">
            <Icon size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Log {activityType.replace('_', ' ')}
          </div>
          <button className="md-x" onClick={onCancel} disabled={saving}>✕</button>
        </div>
        <div className="md-b">
          {activityType !== 'note' && activityType !== 'status_change' && (
            <div className="fg">
              <label>Outcome</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { v: 'positive', label: '👍 Positive', color: '#4ade80' },
                  { v: 'neutral',  label: '· Neutral',   color: '#fbbf24' },
                  { v: 'negative', label: '👎 Negative', color: '#f87171' },
                ].map(o => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setDraft(d => ({ ...d, outcome: o.v }))}
                    style={{
                      flex: 1,
                      padding: '8px 10px', borderRadius: 8,
                      border: `1px solid ${draft.outcome === o.v ? o.color : 'var(--v2-line, rgba(255,255,255,.1))'}`,
                      background: draft.outcome === o.v ? `${o.color}22` : 'transparent',
                      color: draft.outcome === o.v ? o.color : 'var(--v2-ink-1)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="fg">
            <label>Notes</label>
            <textarea
              value={draft.notes}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              placeholder="What happened? 1-line summary."
              style={{ minHeight: 80, width: '100%' }}
            />
          </div>
          <div className="grid2">
            <div className="fg">
              <label>Next action</label>
              <input
                value={draft.next_action}
                onChange={e => setDraft(d => ({ ...d, next_action: e.target.value }))}
                placeholder="e.g. Send revised quote"
              />
            </div>
            <div className="fg">
              <label>Next action date</label>
              <input
                type="date"
                value={draft.next_action_date}
                onChange={e => setDraft(d => ({ ...d, next_action_date: e.target.value }))}
              />
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 4 }}>
            GPS captured automatically if you allow browser permission. Won't block save if denied.
          </p>
        </div>
        <div className="md-f">
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-y" onClick={onCommit} disabled={saving}>
            {saving ? 'Logging…' : 'Log activity'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Stage transition modal ─── */
function StageModal({ modal, setModal, saving, onCancel, onCommit, leadCity, leadSegment }) {
  const [reps, setReps] = useState([])
  const [loadingReps, setLoadingReps] = useState(false)
  const newStage = modal.newStage

  useEffect(() => {
    if (newStage !== 'SalesReady') return
    setLoadingReps(true)
    // Pull active sales reps; sort by city-match first (suggested first).
    supabase
      .from('users')
      .select('id, name, team_role, city, is_active')
      .in('team_role', ['sales', 'agency'])
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const list = data || []
        if (leadCity) {
          list.sort((a, b) => {
            const aMatch = a.city === leadCity ? -1 : 0
            const bMatch = b.city === leadCity ? -1 : 0
            return aMatch - bMatch
          })
        }
        setReps(list)
        setLoadingReps(false)
      })
  }, [newStage, leadCity])

  const tintMap = {
    blue:   '#60a5fa', green: '#4ade80', amber: '#fbbf24',
    red:    '#f87171', purple: '#c084fc',
  }
  const headerColor = tintMap[STAGE_TINT[newStage] || 'blue']

  return (
    <div className="mo" onClick={(e) => { if (e.target === e.currentTarget && !saving) onCancel() }}>
      <div className="md" style={{ maxWidth: 560 }}>
        <div className="md-h">
          <div className="md-t" style={{ color: headerColor }}>
            Move to: {STAGE_LABELS[newStage] || newStage}
          </div>
          <button className="md-x" onClick={onCancel} disabled={saving}>✕</button>
        </div>
        <div className="md-b">
          {/* Lost — mandatory reason */}
          {newStage === 'Lost' && (
            <div className="fg">
              <label>Lost reason <span style={{ color: '#f87171' }}>*</span></label>
              <select
                value={modal.lost_reason}
                onChange={e => setModal(m => ({ ...m, lost_reason: e.target.value }))}
                style={{ width: '100%' }}
              >
                <option value="">— pick a reason —</option>
                {LOST_REASONS.map(r => (<option key={r} value={r}>{r}</option>))}
              </select>
              <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>
                Reason is mandatory so the team can later analyze loss patterns.
              </p>
            </div>
          )}

          {/* Nurture — mandatory revisit date */}
          {newStage === 'Nurture' && (
            <div className="fg">
              <label>Revisit date <span style={{ color: '#f87171' }}>*</span></label>
              <input
                type="date"
                value={modal.nurture_revisit_date}
                onChange={e => setModal(m => ({ ...m, nurture_revisit_date: e.target.value }))}
                max={new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0,10)}
                min={new Date().toISOString().slice(0,10)}
              />
              <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>
                Maximum 90 days out — architecture forces a decision instead of letting the lead rot.
              </p>
            </div>
          )}

          {/* SalesReady — 4 mandatory fields + handoff target */}
          {newStage === 'SalesReady' && (
            <>
              <p style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 12 }}>
                Confirm all four qualification fields before passing to sales.
                Architecture §4.1 — only "Sales Ready" leads can move forward.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <label style={{
                  flex: 1, padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${modal.budget_confirmed ? '#4ade80' : 'var(--v2-line, rgba(255,255,255,.1))'}`,
                  background: modal.budget_confirmed ? 'rgba(74,222,128,.10)' : 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <input
                    type="checkbox"
                    checked={modal.budget_confirmed}
                    onChange={e => setModal(m => ({ ...m, budget_confirmed: e.target.checked }))}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Budget confirmed</span>
                </label>
                <label style={{
                  flex: 1, padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${modal.timeline_confirmed ? '#4ade80' : 'var(--v2-line, rgba(255,255,255,.1))'}`,
                  background: modal.timeline_confirmed ? 'rgba(74,222,128,.10)' : 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <input
                    type="checkbox"
                    checked={modal.timeline_confirmed}
                    onChange={e => setModal(m => ({ ...m, timeline_confirmed: e.target.checked }))}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Timeline confirmed</span>
                </label>
              </div>
              <div className="fg">
                <label>Decision-maker contact <span style={{ color: '#f87171' }}>*</span></label>
                <input
                  value={modal.decision_maker_contact}
                  onChange={e => setModal(m => ({ ...m, decision_maker_contact: e.target.value }))}
                  placeholder="Name + role of the actual decision-maker"
                />
              </div>
              <div className="fg">
                <label>Service interest <span style={{ color: '#f87171' }}>*</span></label>
                <input
                  value={modal.service_interest}
                  onChange={e => setModal(m => ({ ...m, service_interest: e.target.value }))}
                  placeholder="e.g. Auto Hood Vadodara 500 units / GSRTC 5 stations 3 months"
                />
              </div>
              <div className="fg">
                <label>Hand off to <span style={{ color: '#f87171' }}>*</span></label>
                <select
                  value={modal.handoff_to}
                  onChange={e => setModal(m => ({ ...m, handoff_to: e.target.value }))}
                  disabled={loadingReps}
                  style={{ width: '100%' }}
                >
                  <option value="">— pick a sales rep —</option>
                  {reps.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.city ? ` · ${r.city}` : ''}
                      {leadCity && r.city === leadCity ? ' (suggested — same city)' : ''}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 6 }}>
                  Suggested rep = same city as lead. 24h SLA starts when you confirm.
                </p>
              </div>
            </>
          )}

          {/* Default — generic confirmation */}
          {!['Lost','Nurture','SalesReady'].includes(newStage) && (
            <p style={{ fontSize: 13, color: 'var(--v2-ink-1)' }}>
              Move this lead to <strong style={{ color: headerColor }}>{STAGE_LABELS[newStage]}</strong>?
            </p>
          )}
        </div>
        <div className="md-f">
          <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-y" onClick={onCommit} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
