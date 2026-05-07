// src/components/dashboard/CockpitWidgets.jsx
//
// Phase 12 rev3 — widgets extracted from the retired CockpitV2 page
// and reused inside AdminDashboardDesktop, so the owner has ONE
// landing page (per Master Spec §3.5 + UI Design System §4.2).
//
// Each widget fetches its own data so it can drop into any host page
// without touching the host's state machine. Lightweight queries.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, AlertTriangle, ArrowRight, Clock, MapPin, FileText,
} from 'lucide-react'
// Already had ArrowRight — Phase 25c uses it for the "View action queue →"
// CTA + the per-item arrow.
import { supabase } from '../../lib/supabase'
import { LEAD_STAGES, STAGE_LABELS } from '../../hooks/useLeads'

const STAGE_BAR_COLOR = {
  New:              'rgba(96,165,250,.50)',
  Contacted:        'rgba(96,165,250,.70)',
  Qualified:        'rgba(251,191,36,.70)',
  SalesReady:       'rgba(192,132,252,.70)',
  MeetingScheduled: 'rgba(251,191,36,.80)',
  QuoteSent:        'rgba(251,191,36,.90)',
  Negotiating:      'rgba(251,191,36,1)',
  Won:              'rgba(74,222,128,1)',
  Lost:             'rgba(248,113,113,.80)',
  Nurture:          'rgba(96,165,250,.40)',
}

/* ─── AI Briefing card ─────────────────────────────────────────────
   Phase 25c — rebuilt to match _design_reference/Untitled_Os_(1)/
   app.jsx structure. Has FOUR distinct content blocks:
     1. eyebrow with pulse dot   — "AI briefing · today"
     2. yesterday recap line     — "Yesterday: ₹X collected, N quotes, M wins"
     3. items list (up to 4)     — each row: text + tinted chip + meta + ↗
     4. RHS CTA column           — "Updated X min ago" + "View action queue →"

   Each item carries: text, chip { tone, label }, meta, route (optional).
   Tinted chips use design's red/amber/green/govt palette (rgba tints
   + matching border + colored text). */
export function AiBriefingCard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => {
    const today = new Date()
    const todayIso = today.toISOString().slice(0, 10)
    const y = new Date(today); y.setDate(y.getDate() - 1)
    const yIso = y.toISOString().slice(0, 10)
    const yStart = `${yIso}T00:00:00`
    const yEnd   = `${yIso}T23:59:59`

    Promise.all([
      // Phase 30A — SLA breaches: any active (non-closed) lead with
      // a handoff_sla_due_at in the past. SalesReady stage removed.
      supabase.from('leads').select('id').not('stage', 'in', '(Won,Lost)').lt('handoff_sla_due_at', new Date().toISOString()),
      // Active team for missed-checkin compute
      supabase.from('users').select('id, name, team_role').eq('is_active', true).in('team_role', ['sales','telecaller','sales_manager','agency']),
      // Today's check-ins
      supabase.from('work_sessions').select('user_id, check_in_at').eq('work_date', todayIso),
      // Pending approvals (count + sum)
      supabase.from('payments').select('amount_received').eq('approval_status', 'pending'),
      // Hot-idle leads (heat=hot, last_contact_at > 7 days OR null, not Won/Lost)
      supabase.from('leads').select('id, name, last_contact_at, assigned_to, users:assigned_to(name)').eq('heat', 'hot').not('stage', 'in', '("Won","Lost")').or(`last_contact_at.is.null,last_contact_at.lt.${new Date(Date.now() - 7*86400000).toISOString()}`).limit(5),
      // Yesterday recap — payments collected
      supabase.from('payments').select('amount_received').eq('approval_status', 'approved').gte('payment_date', yIso).lte('payment_date', yIso),
      // Yesterday recap — quotes sent (status moved to sent yesterday)
      supabase.from('quotes').select('id, status, total_amount').gte('updated_at', yStart).lte('updated_at', yEnd),
      // Govt OC copy attachments missing — quotes status=won, segment=GOVERNMENT, no oc_copy attachment
      supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'won').eq('segment', 'GOVERNMENT'),
    ]).then(([sla, team, sess, pend, stale, yPay, yQuotes, govt]) => {
      const checkedIn = new Set((sess.data || []).filter(s => s.check_in_at).map(s => s.user_id))
      const elevenAm = new Date(); elevenAm.setHours(11, 0, 0, 0)
      const isAfter11 = new Date() > elevenAm
      const noCheckIn = isAfter11
        ? (team.data || []).filter(u => !checkedIn.has(u.id))
        : []
      const pendCount  = (pend.data || []).length
      const pendTotal  = (pend.data || []).reduce((s, p) => s + Number(p.amount_received || 0), 0)
      const yQuotesArr = yQuotes.data || []
      const sentY = yQuotesArr.filter(q => q.status === 'sent').length
      const wonY  = yQuotesArr.filter(q => q.status === 'won')
      const wonYValue = wonY.reduce((s, q) => s + Number(q.total_amount || 0), 0)
      const collectedY = (yPay.data || []).reduce((s, p) => s + Number(p.amount_received || 0), 0)

      setData({
        slaBreaches: (sla.data || []).length,
        noCheckIn,
        pendCount,
        pendTotal,
        staleHot: stale.data || [],
        yesterday: { sent: sentY, won: wonY.length, wonValue: wonYValue, collected: collectedY },
      })
    })
  }, [])

  if (!data) return null

  // Compose recap line. If yesterday had no activity, fall back to a
  // simpler line so the briefing still feels populated.
  const recap = data.yesterday.sent + data.yesterday.won + data.yesterday.collected > 0
    ? `Yesterday: ${data.yesterday.sent} quote${data.yesterday.sent === 1 ? '' : 's'} sent, ${data.yesterday.won} won${data.yesterday.wonValue > 0 ? ` (${formatLakh(data.yesterday.wonValue)})` : ''}${data.yesterday.collected > 0 ? `, ${formatLakh(data.yesterday.collected)} collected` : ''}.`
    : 'Quiet day yesterday. Below is what needs your attention today.'

  // Build items list — up to 4, design preserves chip + meta + cta shape.
  const items = []
  if (data.slaBreaches > 0) {
    items.push({
      text:  `${data.slaBreaches} SalesReady lead${data.slaBreaches === 1 ? '' : 's'} past 24h SLA`,
      chip:  { tone: 'red', label: 'Act now' },
      meta:  'Hand-off overdue',
      route: '/leads?stage=SalesReady',
    })
  }
  if (data.staleHot.length > 0) {
    const top = data.staleHot[0]
    items.push({
      text:  `${top.name} stale · last touch by ${top.users?.name || 'unassigned'}${data.staleHot.length > 1 ? ` (+${data.staleHot.length - 1} more)` : ''}`,
      chip:  { tone: 'amber', label: 'Follow up' },
      meta:  `${data.staleHot.length} hot idle`,
      route: `/leads/${top.id}`,
    })
  }
  if (data.noCheckIn.length > 0) {
    items.push({
      text:  `${data.noCheckIn.length} field staff missed 11 AM check-in: ${data.noCheckIn.slice(0, 3).map(u => u.name).join(', ')}${data.noCheckIn.length > 3 ? '…' : ''}`,
      chip:  { tone: 'amber', label: 'Coach' },
      meta:  'No check-in',
      route: '/team-dashboard',
    })
  }
  if (data.pendCount > 0) {
    items.push({
      text:  `${data.pendCount} payment approval${data.pendCount === 1 ? '' : 's'} waiting · ${formatLakh(data.pendTotal)}`,
      chip:  { tone: 'green', label: 'Approve' },
      meta:  '5 min',
      route: '/pending-approvals',
    })
  }

  return (
    <div className="ai-briefing-card" style={{
      position: 'relative',
      background: `
        radial-gradient(900px 220px at 100% 0%, rgba(192,132,252,.20), transparent 60%),
        radial-gradient(700px 220px at 0% 100%, rgba(96,165,250,.18), transparent 60%),
        linear-gradient(135deg, rgba(192,132,252,.10), rgba(96,165,250,.10))
      `,
      border: '1px solid var(--v2-line, rgba(255,255,255,.08))',
      borderRadius: 16,
      padding: '20px 22px',
      marginBottom: 16,
      display: 'grid',
      gridTemplateColumns: '44px 1fr auto',
      gap: 18,
      alignItems: 'start',
    }}>
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: 'linear-gradient(135deg, #c084fc, #60a5fa)',
        display: 'grid', placeItems: 'center',
        color: 'white',
        boxShadow: '0 4px 16px rgba(192,132,252,.25)',
      }}>
        <Sparkles size={22} />
      </div>

      {/* Content */}
      <div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase',
          color: 'var(--v2-ink-1, rgba(255,255,255,.62))', marginBottom: 10,
          fontWeight: 700,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#c084fc',
            animation: 'aipulse 2s infinite',
          }} />
          AI briefing · today
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 14, color: 'var(--v2-ink-0, #fff)', fontWeight: 500 }}>
          {recap}
        </div>

        {items.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                onClick={() => it.route && navigate(it.route)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  gap: 10, alignItems: 'center',
                  background: 'rgba(15, 23, 42, .35)',
                  border: '1px solid rgba(255,255,255,.05)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  cursor: it.route ? 'pointer' : 'default',
                  textAlign: 'left',
                  transition: 'border-color .15s, background .15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'
                  e.currentTarget.style.background = 'rgba(15, 23, 42, .55)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,.05)'
                  e.currentTarget.style.background = 'rgba(15, 23, 42, .35)'
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--v2-ink-0, #fff)', lineHeight: 1.4 }}>
                  {it.text}
                </span>
                <Chip tone={it.chip.tone}>{it.chip.label}</Chip>
                <span style={{ fontSize: 11, color: 'var(--v2-ink-2)', whiteSpace: 'nowrap' }}>
                  {it.meta}
                </span>
                <ArrowRight size={13} style={{ color: 'var(--v2-ink-2)' }} />
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2)', fontStyle: 'italic' }}>
            Inbox zero — nothing flagged today.
          </div>
        )}
      </div>

      {/* RHS CTA column */}
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'flex-end', justifyContent: 'space-between',
        height: '100%', minHeight: 80,
      }}>
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', whiteSpace: 'nowrap' }}>
          Updated {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => navigate('/leads')}
            style={{
              background: 'transparent', border: 0,
              color: 'var(--v2-yellow, #FFE600)',
              fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'inline-flex',
              alignItems: 'center', gap: 4,
              padding: 0,
            }}
          >
            View action queue <ArrowRight size={12} />
          </button>
        )}
      </div>

      <style>{`
        @keyframes aipulse {
          0%   { box-shadow: 0 0 0 0 rgba(192,132,252,.5); }
          70%  { box-shadow: 0 0 0 6px rgba(192,132,252,0); }
          100% { box-shadow: 0 0 0 0 rgba(192,132,252,0); }
        }
      `}</style>
    </div>
  )
}

/* Tinted status chip — design uses red/amber/green/blue/govt tints
   with matching borders and colored text. */
function Chip({ tone, children }) {
  const palette = {
    red:    { bg: 'rgba(248,113,113,.12)',  bd: 'rgba(248,113,113,.35)',  fg: '#fca5a5' },
    amber:  { bg: 'rgba(251,191,36,.12)',   bd: 'rgba(251,191,36,.35)',   fg: '#fcd34d' },
    green:  { bg: 'rgba(74,222,128,.12)',   bd: 'rgba(74,222,128,.35)',   fg: '#86efac' },
    blue:   { bg: 'rgba(96,165,250,.12)',   bd: 'rgba(96,165,250,.35)',   fg: '#93c5fd' },
    govt:   { bg: 'rgba(192,132,252,.12)',  bd: 'rgba(192,132,252,.35)',  fg: '#d8b4fe' },
  }
  const c = palette[tone] || palette.blue
  return (
    <span style={{
      background: c.bg,
      border: `1px solid ${c.bd}`,
      color: c.fg,
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '.04em',
      textTransform: 'uppercase',
      padding: '3px 8px',
      borderRadius: 999,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

/* Format ₹ as Lakh / Crore for the recap line */
function formatLakh(n) {
  const x = Number(n) || 0
  if (x >= 10000000) return `₹${(x / 10000000).toFixed(1)}Cr`
  if (x >= 100000)   return `₹${(x / 100000).toFixed(1)}L`
  if (x >= 1000)     return `₹${(x / 1000).toFixed(0)}K`
  return `₹${x}`
}


/* ─── Lead Pipeline funnel ─────────────────────────────────────────
   Different from the existing FunnelPanel which is for QUOTES.
   This one bins LEADS by their 10 stages. Click → /leads. */
export function LeadPipelinePanel() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    supabase
      .from('leads')
      .select('stage, expected_value')
      .then(({ data }) => {
        const c = {}
        LEAD_STAGES.forEach(s => { c[s] = 0 })
        let value = 0
        ;(data || []).forEach(l => {
          c[l.stage] = (c[l.stage] || 0) + 1
          if (!['Won', 'Lost'].includes(l.stage)) value += Number(l.expected_value) || 0
        })
        setCounts({ counts: c, total: (data || []).length, value })
      })
  }, [])

  if (!counts) return null
  const max = Math.max(1, ...Object.values(counts.counts))

  return (
    <div className="v2d-panel" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Lead pipeline</div>
          <div style={{ fontSize: 11, color: 'var(--v2-ink-2, rgba(255,255,255,.40))', marginTop: 2 }}>
            {counts.total} total · ₹{(counts.value/100000).toFixed(1)}L active value
          </div>
        </div>
        <button
          onClick={() => navigate('/leads')}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--v2-yellow, #facc15)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          View all <ArrowRight size={12} />
        </button>
      </div>
      <div style={{ padding: '12px 18px' }}>
        {LEAD_STAGES.map(stage => {
          const count = counts.counts[stage] || 0
          const pct = (count / max) * 100
          return (
            <div
              key={stage}
              onClick={() => navigate('/leads')}
              style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr 40px',
                gap: 10, alignItems: 'center',
                padding: '6px 0', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>{STAGE_LABELS[stage]}</div>
              <div style={{ height: 8, background: 'var(--v2-bg-2, rgba(255,255,255,.06))', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: STAGE_BAR_COLOR[stage] || 'var(--v2-ink-2)',
                  borderRadius: 4,
                  transition: 'width .6s ease',
                }} />
              </div>
              <div style={{
                fontFamily: 'var(--v2-display, "Space Grotesk")',
                fontWeight: 600, fontSize: 13,
                textAlign: 'right',
              }}>
                {count}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


/* ─── Today's team activity ────────────────────────────────────────
   Per-person row with check-in status + counters. Sales-only roles. */
export function TeamActivityPanel() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    Promise.all([
      supabase.from('users').select('id, name, team_role, city, daily_targets').eq('is_active', true).in('team_role', ['sales','telecaller','sales_manager','agency']),
      supabase.from('work_sessions').select('user_id, daily_counters, check_in_at, check_out_at').eq('work_date', today),
    ]).then(([t, s]) => {
      const sessions = new Map((s.data || []).map(x => [x.user_id, x]))
      setData({ team: t.data || [], sessions })
    })
  }, [])

  if (!data) return null
  if (data.team.length === 0) return null

  return (
    <div className="v2d-panel" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--v2-line, rgba(255,255,255,.06))',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Today's team activity</div>
        <div style={{ fontSize: 11, color: 'var(--v2-ink-2, rgba(255,255,255,.40))', marginTop: 2 }}>
          {Array.from(data.sessions.values()).filter(s => s.check_in_at).length} of {data.team.length} field staff checked in
        </div>
      </div>
      <table className="v2d-q-table">
        <thead>
          <tr>
            <th>Name</th>
            <th style={{ width: 60, textAlign: 'right' }}>MTG</th>
            <th style={{ width: 60, textAlign: 'right' }}>CALLS</th>
            <th style={{ width: 60, textAlign: 'right' }}>LEADS</th>
            <th style={{ width: 60 }}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {data.team.map(u => {
            const sess = data.sessions.get(u.id)
            const c = sess?.daily_counters || {}
            const targets = u.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
            const checkedIn = !!sess?.check_in_at
            const checkedOut = !!sess?.check_out_at
            return (
              <tr key={u.id} onClick={() => navigate('/team')} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{u.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--v2-ink-2, rgba(255,255,255,.40))', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    {u.team_role?.replace('_', ' ')}{u.city && ` · ${u.city}`}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.meetings >= targets.meetings ? '#4ade80' : 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>
                  {c.meetings || 0}/{targets.meetings}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.calls >= targets.calls ? '#4ade80' : 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>
                  {c.calls || 0}/{targets.calls}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: c.new_leads >= targets.new_leads ? '#4ade80' : 'var(--v2-ink-1, rgba(255,255,255,.62))' }}>
                  {c.new_leads || 0}/{targets.new_leads}
                </td>
                <td>
                  {checkedOut
                    ? <span style={{ fontSize: 11, color: '#c084fc' }}>✓ Done</span>
                    : checkedIn
                    ? <span style={{ fontSize: 11, color: '#4ade80' }}>● In</span>
                    : <span style={{ fontSize: 11, color: '#f87171' }}>○ No</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


/* ─── SLA breach alert row ─────────────────────────────────────────
   Shown only when there's at least one breach. Compact banner row
   that can sit alongside the existing missed-reps banner. */
export function SlaBreachBanner() {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)

  useEffect(() => {
    // Phase 30A — SalesReady removed. Active SLA breach = any
    // non-closed lead with handoff_sla_due_at in the past.
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('stage', 'in', '(Won,Lost)')
      .lt('handoff_sla_due_at', new Date().toISOString())
      .then(({ count: n }) => setCount(n || 0))
  }, [])

  if (count === 0) return null

  return (
    <section
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        background: 'rgba(248,113,113,.08)',
        border: '1px solid rgba(248,113,113,.28)',
        borderRadius: 12,
        marginBottom: 16,
        cursor: 'pointer',
      }}
      onClick={() => navigate('/leads?stage=SalesReady')}
    >
      <Clock size={18} style={{ color: '#f87171', flex: '0 0 auto' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>
          {count} Sales Ready lead{count === 1 ? '' : 's'} past 24h SLA
        </div>
        <div style={{ fontSize: 12, color: 'var(--v2-ink-2, rgba(255,255,255,.40))' }}>
          Telecaller passed but sales hasn't acted. Click to see who's affected.
        </div>
      </div>
      <ArrowRight size={14} style={{ color: '#f87171' }} />
    </section>
  )
}
