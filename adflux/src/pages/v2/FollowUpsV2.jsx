// src/pages/v2/FollowUpsV2.jsx
//
// Phase 31K (10 May 2026) — owner directive.
//
// What this is:
//   A dedicated "today's follow-ups" page for sales reps. The
//   follow_ups table has been around since Phase 1 and the auto-
//   creation trigger fires when a quote.status flips to 'sent'
//   (Phase 31C wired SECURITY DEFINER + extended RLS). But there
//   was no SCREEN where a rep could see "what follow-ups do I owe
//   today" in one list. They had to go lead-by-lead. That's the gap.
//
// Layout (mobile-first, single column):
//   • Overdue   — follow_up_date < today, sorted oldest first (red)
//   • Due today — follow_up_date = today                     (yellow)
//   • Tomorrow  — follow_up_date = today+1                   (neutral)
//   • This week — follow_up_date in [today+2, today+7]       (neutral)
//
// Each row shows:
//   client name (linked to /quotes/:id) · due date+time · note
//   inline action buttons: Call · WhatsApp · Mark done
//
// Empty states are explicit per CLAUDE.md UI checklist §6 — never
// render a blank box.

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Phone, MessageCircle, CheckCircle2, Loader2,
  Inbox, AlertTriangle, Clock, RefreshCw,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)
const ADD_DAYS  = (iso, n) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function FollowUpsV2() {
  const { profile, isPrivileged } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows]             = useState([])
  // Phase 31S — Nurture leads ready to revisit. Separate query off
  // the leads table since they're a distinct concept from follow_ups
  // (no scheduled note, no time, just "this lead's parked-revisit
  // date has arrived"). Rendered as their own section below the
  // follow-up sections.
  const [nurtureRows, setNurtureRows] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [busyId, setBusyId]         = useState(null)

  const load = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    // Privileged users (admin / co_owner) see ALL pending follow-ups
    // so they can spot-check the team. Sales reps see their own.
    // Phase 33D.4 — pull both quote-linked AND lead-linked follow-ups
    // in one query. Lead-linked rows have lead_id set (and quote_id
    // NULL); quote-linked rows are the reverse. The join keeps both
    // join targets available; whichever is null is ignored in render.
    let q = supabase.from('follow_ups')
      .select(`
        id, follow_up_date, follow_up_time, note, is_done, auto_generated,
        quote_id, lead_id,
        quote:quotes ( id, client_name, client_company, client_phone, segment ),
        lead:leads   ( id, name, company, phone, segment )
      `)
      .eq('is_done', false)
      .order('follow_up_date', { ascending: true })
      .order('follow_up_time', { ascending: true, nullsFirst: false })
    if (!isPrivileged) {
      q = q.eq('assigned_to', profile.id)
    }

    // Phase 31S — Nurture leads where revisit_date is within the
    // surfacing window (overdue + this week). Pull more than we'll
    // show (50) so admin spot-checks see context. Use the new
    // Phase 31N revisit_date column (NOT the legacy nurture_revisit_date
    // which lives on Lost rows).
    const today = TODAY_ISO()
    const weekEnd = ADD_DAYS(today, 7)
    let nq = supabase.from('leads')
      .select('id, name, company, phone, email, stage, revisit_date, segment, assigned_to')
      .eq('stage', 'Nurture')
      .not('revisit_date', 'is', null)
      .lte('revisit_date', weekEnd)
      .order('revisit_date', { ascending: true })
      .limit(50)
    if (!isPrivileged) {
      nq = nq.eq('assigned_to', profile.id)
    }

    const [fuRes, nuRes] = await Promise.all([q, nq])
    if (fuRes.error) { setError(fuRes.error.message); setLoading(false); return }
    if (nuRes.error) { setError(nuRes.error.message); setLoading(false); return }
    setRows(fuRes.data || [])
    setNurtureRows(nuRes.data || [])
    setLoading(false)
  }, [profile?.id, isPrivileged])

  useEffect(() => { load() }, [load])

  // Bucket rows by date — labels chosen to read like a person would
  // describe them ("Overdue" not "<TODAY"; "Today" not "=TODAY").
  const buckets = useMemo(() => {
    const today    = TODAY_ISO()
    const tomorrow = ADD_DAYS(today, 1)
    const weekEnd  = ADD_DAYS(today, 7)
    const out = { overdue: [], today: [], tomorrow: [], week: [] }
    rows.forEach(r => {
      const d = r.follow_up_date
      if (!d) return
      if (d < today)            out.overdue.push(r)
      else if (d === today)     out.today.push(r)
      else if (d === tomorrow)  out.tomorrow.push(r)
      else if (d <= weekEnd)    out.week.push(r)
      // > week — not surfaced here. Rep can scroll their normal
      // queue if they want to plan further out.
    })
    return out
  }, [rows])

  // Phase 31S — same date bucketing for Nurture revisits.
  const nurtureBuckets = useMemo(() => {
    const today    = TODAY_ISO()
    const tomorrow = ADD_DAYS(today, 1)
    const weekEnd  = ADD_DAYS(today, 7)
    const out = { overdue: [], today: [], tomorrow: [], week: [] }
    nurtureRows.forEach(l => {
      const d = l.revisit_date
      if (!d) return
      if (d < today)            out.overdue.push(l)
      else if (d === today)     out.today.push(l)
      else if (d === tomorrow)  out.tomorrow.push(l)
      else if (d <= weekEnd)    out.week.push(l)
    })
    return out
  }, [nurtureRows])

  async function markDone(row) {
    setBusyId(row.id)
    const { error: err } = await supabase
      .from('follow_ups')
      .update({ is_done: true, done_at: new Date().toISOString() })
      .eq('id', row.id)
    setBusyId(null)
    if (err) { setError(err.message); return }
    // Optimistic remove from local state — the realtime sync will
    // catch up but the rep shouldn't have to wait for it.
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  // Phase 33D.6 — Snooze pushes the FU date by 1 day. Stops the
  // queue from accumulating overdue items when rep has a rough day.
  async function snooze(row) {
    setBusyId(row.id)
    // Add 1 day, then push Sunday → Monday on the client too.
    const d = new Date(row.follow_up_date + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    if (d.getDay() === 0) d.setDate(d.getDate() + 1)
    const newDate = d.toISOString().slice(0, 10)
    const { error: err } = await supabase
      .from('follow_ups')
      .update({ follow_up_date: newDate })
      .eq('id', row.id)
    setBusyId(null)
    if (err) { setError(err.message); return }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, follow_up_date: newDate } : r))
  }

  // Phase 33D.4 — both quote-linked AND lead-linked follow-ups can
  // appear here. Resolve phone + name from whichever join is present.
  function rowPhone(row) {
    return row.lead_id ? row.lead?.phone : row.quote?.client_phone
  }
  function rowName(row) {
    return row.lead_id ? row.lead?.name : row.quote?.client_name
  }

  function openWhatsApp(row) {
    const phone = rowPhone(row)
    if (!phone) {
      setError(`${rowName(row) || 'Contact'} has no phone on file.`)
      return
    }
    const clean = String(phone).replace(/\D/g, '')
    const e164  = clean.length === 10 ? `91${clean}` : clean
    const greet = row.note ? `Hi ${rowName(row) || ''}, following up on: ${row.note}` : `Hi ${rowName(row) || ''}`
    const url   = `https://wa.me/${e164}?text=${encodeURIComponent(greet)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function openCall(row) {
    const phone = rowPhone(row)
    if (!phone) {
      setError(`${rowName(row) || 'Contact'} has no phone on file.`)
      return
    }
    window.location.href = `tel:${String(phone).replace(/\s/g, '')}`
  }

  // Phase 31S — Nurture row handlers. Lead has phone directly on the
  // row (no nested quote join), so the contact actions read lead.phone
  // / lead.name. Reactivate flips the stage back to Working, clears
  // revisit_date, and inserts a status_change activity for the timeline.
  function nurtureCall(lead) {
    if (!lead.phone) {
      setError(`${lead.name || 'Lead'} has no phone on file.`)
      return
    }
    window.location.href = `tel:${String(lead.phone).replace(/\s/g, '')}`
  }
  function nurtureWhatsApp(lead) {
    if (!lead.phone) {
      setError(`${lead.name || 'Lead'} has no phone on file.`)
      return
    }
    const clean = String(lead.phone).replace(/\D/g, '')
    const e164  = clean.length === 10 ? `91${clean}` : clean
    const greet = `Hi ${lead.name || ''}, just checking back in as we discussed.`
    const url   = `https://wa.me/${e164}?text=${encodeURIComponent(greet)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  async function reactivate(lead) {
    setBusyId(lead.id)
    const { error: err } = await supabase
      .from('leads')
      .update({ stage: 'Working', revisit_date: null })
      .eq('id', lead.id)
    if (!err) {
      // Status_change row for the timeline so the rep sees when this
      // happened and what stage flip drove it.
      await supabase.from('lead_activities').insert([{
        lead_id:       lead.id,
        activity_type: 'status_change',
        notes:         'Stage → Follow-up (reactivated from Nurture)',
        created_by:    profile.id,
      }])
    }
    setBusyId(null)
    if (err) { setError(err.message); return }
    setNurtureRows(prev => prev.filter(r => r.id !== lead.id))
  }

  if (loading) {
    return (
      <div className="lead-root">
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Loading follow-ups…</div>
        </div>
      </div>
    )
  }

  const total = buckets.overdue.length + buckets.today.length + buckets.tomorrow.length + buckets.week.length
  // Phase 31S — Nurture totals included in the "anything to do?" check
  // so the empty state only shows when BOTH lists are clean.
  const nurtureTotal = nurtureBuckets.overdue.length + nurtureBuckets.today.length + nurtureBuckets.tomorrow.length + nurtureBuckets.week.length
  const grandTotal = total + nurtureTotal

  return (
    <div className="lead-root" style={{ paddingBottom: 24 }}>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
            Follow-ups
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {grandTotal === 0
              ? 'Nothing on your plate today.'
              : `${total} follow-up${total === 1 ? '' : 's'}${nurtureTotal > 0 ? ` · ${nurtureTotal} nurture revisit${nurtureTotal === 1 ? '' : 's'}` : ''} · ${buckets.overdue.length + nurtureBuckets.overdue.length} overdue`}
          </div>
        </div>
      </div>

      {/* Phase 33D — empty-state CTA. Never a dead page; always show
          the next action. When no follow-ups, suggest logging a meeting. */}
      {grandTotal === 0 && !error && (
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32, marginBottom: 14 }}>
          <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 10 }}>
            All caught up. Time to find a new lead.
          </div>
          <button
            className="lead-btn lead-btn-primary"
            onClick={() => navigate('/work')}
          >
            Go to Today
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'var(--danger-soft)', border: '1px solid var(--danger)',
            color: 'var(--danger)', borderRadius: 8, padding: '10px 14px',
            marginBottom: 12, fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {grandTotal === 0 && (
        <div className="lead-card lead-card-pad" style={{ textAlign: 'center', padding: 32 }}>
          <Inbox size={28} strokeWidth={1.6} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No follow-ups due</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 320, margin: '0 auto' }}>
            Either you're caught up or no one's expecting a call this week.
            Send a quote — a follow-up will be auto-scheduled three days later.
          </div>
        </div>
      )}

      <Section
        title="Overdue"
        rows={buckets.overdue}
        tone="danger"
        icon={<AlertTriangle size={14} strokeWidth={2} />}
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} onSnooze={snooze} busyId={busyId}
        navigate={navigate}
      />
      <Section
        title="Due today"
        rows={buckets.today}
        tone="warning"
        icon={<Clock size={14} strokeWidth={2} />}
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} onSnooze={snooze} busyId={busyId}
        navigate={navigate}
      />
      <Section
        title="Tomorrow"
        rows={buckets.tomorrow}
        tone="neutral"
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} onSnooze={snooze} busyId={busyId}
        navigate={navigate}
      />
      <Section
        title="This week"
        rows={buckets.week}
        tone="neutral"
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} onSnooze={snooze} busyId={busyId}
        navigate={navigate}
      />

      {/* Phase 31S — Nurture revisit sections. Distinct from follow-ups
          (Nurture = lead in parked stage, no scheduled note; revisit_date
          is set by the rep when moving to Nurture). Visually grouped
          UNDER the follow-up sections so reps see "what was scheduled"
          first, then "what's parked but ready to revisit." */}
      {nurtureTotal > 0 && (
        <div style={{
          marginTop: 24, marginBottom: 8, paddingTop: 16,
          borderTop: '1px dashed var(--border)',
          fontSize: 11, fontWeight: 700, letterSpacing: '.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          Nurture · Ready to revisit
        </div>
      )}

      <NurtureSection
        title="Overdue revisit"
        rows={nurtureBuckets.overdue}
        tone="danger"
        icon={<AlertTriangle size={14} strokeWidth={2} />}
        onCall={nurtureCall} onWhatsApp={nurtureWhatsApp} onReactivate={reactivate}
        busyId={busyId} navigate={navigate}
      />
      <NurtureSection
        title="Revisit today"
        rows={nurtureBuckets.today}
        tone="warning"
        icon={<Clock size={14} strokeWidth={2} />}
        onCall={nurtureCall} onWhatsApp={nurtureWhatsApp} onReactivate={reactivate}
        busyId={busyId} navigate={navigate}
      />
      <NurtureSection
        title="Revisit tomorrow"
        rows={nurtureBuckets.tomorrow}
        tone="neutral"
        onCall={nurtureCall} onWhatsApp={nurtureWhatsApp} onReactivate={reactivate}
        busyId={busyId} navigate={navigate}
      />
      <NurtureSection
        title="Revisit this week"
        rows={nurtureBuckets.week}
        tone="neutral"
        onCall={nurtureCall} onWhatsApp={nurtureWhatsApp} onReactivate={reactivate}
        busyId={busyId} navigate={navigate}
      />
    </div>
  )
}

function Section({ title, rows, tone, icon, onCall, onWhatsApp, onDone, onSnooze, busyId, navigate }) {
  if (rows.length === 0) return null
  const toneColor =
    tone === 'danger'  ? 'var(--danger)'  :
    tone === 'warning' ? 'var(--warning)' :
                         'var(--text-muted)'
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
        textTransform: 'uppercase', color: toneColor,
        marginBottom: 8, padding: '0 4px',
      }}>
        {icon}
        <span>{title}</span>
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          background: 'var(--surface-2)', padding: '1px 7px', borderRadius: 999,
        }}>
          {rows.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <Row
            key={r.id} row={r}
            onCall={onCall} onWhatsApp={onWhatsApp} onDone={onDone} onSnooze={onSnooze}
            busy={busyId === r.id}
            navigate={navigate}
          />
        ))}
      </div>
    </section>
  )
}

function Row({ row, onCall, onWhatsApp, onDone, onSnooze, busy, navigate }) {
  // Phase 33D.4 — follow-up rows can be quote-linked OR lead-linked.
  // Resolve client display + tap target from whichever join is present.
  const isLeadFu = !!row.lead_id
  const client = isLeadFu
    ? (row.lead?.name || 'Unknown lead')
    : (row.quote?.client_name || 'Unknown client')
  const company = isLeadFu ? row.lead?.company : row.quote?.client_company
  const time = row.follow_up_time ? row.follow_up_time.slice(0, 5) : null
  const dateLabel = formatDate(row.follow_up_date)
  const tapTo = isLeadFu
    ? (row.lead_id ? `/leads/${row.lead_id}` : null)
    : (row.quote_id ? `/quotes/${row.quote_id}` : null)

  return (
    <div
      className="lead-card"
      style={{
        padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div
        onClick={() => tapTo && navigate(tapTo)}
        style={{ cursor: tapTo ? 'pointer' : 'default' }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          {client}
          {company && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}> · {company}</span>
          )}
          {row.auto_generated && (
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 600,
              color: 'var(--accent-fg)', background: 'var(--accent)',
              padding: '2px 6px', borderRadius: 4,
            }}>
              AUTO
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {dateLabel}{time ? ` · ${time}` : ''}
          {/* Phase 33D.6 — show sequence + cadence type */}
          {row.sequence && row.cadence_type && (
            <span style={{ marginLeft: 8 }}>
              · {row.cadence_type === 'lead_intro' ? `Follow-up ${row.sequence} of 6`
                : row.cadence_type === 'quote_chase' ? `Quote chase ${row.sequence} of 3`
                : row.cadence_type === 'nurture' ? 'Nurture check-in'
                : row.cadence_type === 'lost_nurture' ? 'Lost · 30-day touch'
                : ''}
            </span>
          )}
        </div>
        {row.action_hint && (
          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4, fontWeight: 500 }}>
            → {row.action_hint}
          </div>
        )}
        {row.note && !row.note.startsWith('Auto') && (
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 6, lineHeight: 1.4 }}>
            {row.note}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="lead-btn lead-btn-sm"
          onClick={() => onCall(row)}
          disabled={busy}
          style={{ flex: 1, minWidth: 80 }}
        >
          <Phone size={13} /> Call
        </button>
        <button
          type="button"
          className="lead-btn lead-btn-sm"
          onClick={() => onWhatsApp(row)}
          disabled={busy}
          style={{ flex: 1, minWidth: 80 }}
        >
          <MessageCircle size={13} /> WhatsApp
        </button>
        <button
          type="button"
          className="lead-btn lead-btn-sm"
          onClick={() => onSnooze && onSnooze(row)}
          disabled={busy || !onSnooze}
          style={{ flex: 1, minWidth: 80, color: 'var(--text-muted)' }}
          title="Push to tomorrow"
        >
          <Clock size={13} /> Snooze
        </button>
        <button
          type="button"
          className="lead-btn lead-btn-sm lead-btn-primary"
          onClick={() => onDone(row)}
          disabled={busy}
          style={{ flex: 1, minWidth: 80 }}
        >
          {busy
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving</>
            : <><CheckCircle2 size={13} /> Done</>}
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   Phase 31S — Nurture revisit section + row.
   Distinct from <Section> / <Row> because the data shape is
   different: lead row has phone/name directly, no nested quote join,
   and the action set is different (Reactivate moves stage, not
   "Mark done"). Visual style mirrors the follow-up rows so the page
   reads as one continuous list, just with a header divider.
   ───────────────────────────────────────────────────────────────── */
function NurtureSection({ title, rows, tone, icon, onCall, onWhatsApp, onReactivate, busyId, navigate }) {
  if (rows.length === 0) return null
  const toneColor =
    tone === 'danger'  ? 'var(--danger)'  :
    tone === 'warning' ? 'var(--warning)' :
                         'var(--text-muted)'
  return (
    <section style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, fontWeight: 700, letterSpacing: '.1em',
        textTransform: 'uppercase', color: toneColor,
        marginBottom: 8, padding: '0 4px',
      }}>
        {icon}
        <span>{title}</span>
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          background: 'var(--surface-2)', padding: '1px 7px', borderRadius: 999,
        }}>
          {rows.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(l => (
          <NurtureRow
            key={l.id} lead={l}
            onCall={onCall} onWhatsApp={onWhatsApp} onReactivate={onReactivate}
            busy={busyId === l.id}
            navigate={navigate}
          />
        ))}
      </div>
    </section>
  )
}

function NurtureRow({ lead, onCall, onWhatsApp, onReactivate, busy, navigate }) {
  const dateLabel = formatDate(lead.revisit_date)
  return (
    <div
      className="lead-card"
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div
        onClick={() => navigate(`/leads/${lead.id}`)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          {lead.name || 'Unknown lead'}
          {lead.company && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}> · {lead.company}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          Nurture · revisit {dateLabel}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="lead-btn lead-btn-sm"
          onClick={() => onCall(lead)}
          disabled={busy}
          style={{ flex: 1, minWidth: 80 }}
        >
          <Phone size={13} /> Call
        </button>
        <button
          type="button"
          className="lead-btn lead-btn-sm"
          onClick={() => onWhatsApp(lead)}
          disabled={busy}
          style={{ flex: 1, minWidth: 80 }}
        >
          <MessageCircle size={13} /> WhatsApp
        </button>
        <button
          type="button"
          className="lead-btn lead-btn-sm lead-btn-primary"
          onClick={() => onReactivate(lead)}
          disabled={busy}
          style={{ flex: 1, minWidth: 100 }}
          title="Move back to Follow-up stage"
        >
          {busy
            ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving</>
            : <><RefreshCw size={13} /> Reactivate</>}
        </button>
      </div>
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  const today = TODAY_ISO()
  if (iso === today)            return 'Today'
  if (iso === ADD_DAYS(today, 1)) return 'Tomorrow'
  if (iso === ADD_DAYS(today, -1)) return 'Yesterday'
  // For other dates show a short readable form (e.g. "Mon 12 May").
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}
