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
  Phone, ArrowRight, MapPin, Clock, Plus, Sparkles,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { formatDate, formatRelative } from '../../utils/formatters'
import {
  StageChip, HeatDot, SegChip, LeadAvatar, Pill,
} from '../../components/leads/LeadShared'
import { DidYouKnow } from '../../components/v2/DidYouKnow'

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
  const [qualifiedToday, setQualifiedToday] = useState(0)
  const [handoffs, setHandoffs] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const startOfDay = `${today}T00:00:00`

    const [leadsRes, callsRes, qualRes, handoffRes] = await Promise.all([
      supabase
        .from('leads')
        .select('*, assigned:assigned_to(id, name, city)')
        .eq('telecaller_id', profile.id)
        .not('stage', 'in', '("Won","Lost","SalesReady","QuoteSent","Negotiating","MeetingScheduled")')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
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
    ])

    setLeads(leadsRes.data || [])
    setCallsToday(callsRes.count || 0)
    setQualifiedToday(qualRes.count || 0)
    setHandoffs(handoffRes.data || [])
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

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
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          Loading queue…
        </div>
      </div>
    )
  }

  return (
    <div className="lead-root">
      {/* Phase 34.9 (C) discoverability — voice log + AI extract is
          a hidden superpower. Most telecallers type notes manually. */}
      <DidYouKnow id="telecaller-voice-log-2026-05-13" title="Stop typing call notes">
        After a call, open /voice → pick the lead → speak 30 seconds in
        Gujarati / Hindi / English. AI extracts outcome + next action + amount
        and updates the lead for you.
      </DidYouKnow>

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
            {nextCall.phone ? (
              <a href={`tel:${nextCall.phone}`} className="tc-call-cta" style={{ textDecoration: 'none' }}>
                <Phone size={16} /> Call now
              </a>
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

      {/* KPI strip */}
      <div className="lead-stat-strip">
        <Stat label="Today's calls"     num={callsToday}            meta="from call_logs" />
        <Stat label="Qualified today"   num={qualifiedToday}        meta="lead → SalesReady" />
        <Stat label="Open queue"        num={leads.length}          meta={hotWarmCount(leads)} />
        <Stat label="Pending hand-offs" num={handoffs.length}       meta={overdueCount(handoffs)} />
      </div>

      {/* Two-col: hand-offs + queue */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, marginTop: 4 }}>
        {/* Pending hand-offs */}
        <div className="lead-card">
          <div className="lead-card-head">
            <div>
              <div className="lead-card-title">Pending hand-offs</div>
              <div className="lead-card-sub">
                {handoffs.length} SalesReady · {handoffs.filter(h => slaPill(h.handoff_sla_due_at)?.tone === 'danger').length} SLA overdue
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
