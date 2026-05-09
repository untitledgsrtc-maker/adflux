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
  Inbox, AlertTriangle, Clock,
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
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busyId, setBusyId]   = useState(null)

  const load = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    setError('')
    // Privileged users (admin / co_owner) see ALL pending follow-ups
    // so they can spot-check the team. Sales reps see their own.
    let q = supabase.from('follow_ups')
      .select(`
        id, follow_up_date, follow_up_time, note, is_done,
        quote_id,
        quote:quotes ( id, client_name, client_company, client_phone, segment )
      `)
      .eq('is_done', false)
      .order('follow_up_date', { ascending: true })
      .order('follow_up_time', { ascending: true, nullsFirst: false })
    if (!isPrivileged) {
      q = q.eq('assigned_to', profile.id)
    }
    const { data, error: err } = await q
    if (err) { setError(err.message); setLoading(false); return }
    setRows(data || [])
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

  function openWhatsApp(row) {
    const phone = row.quote?.client_phone
    if (!phone) {
      setError(`${row.quote?.client_name || 'Client'} has no phone on file. Add it from the quote.`)
      return
    }
    // Strip non-digits, prepend country code 91 if local number.
    const clean = String(phone).replace(/\D/g, '')
    const e164  = clean.length === 10 ? `91${clean}` : clean
    const greet = row.note ? `Hi ${row.quote?.client_name || ''}, following up on: ${row.note}` : `Hi ${row.quote?.client_name || ''}`
    const url   = `https://wa.me/${e164}?text=${encodeURIComponent(greet)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function openCall(row) {
    const phone = row.quote?.client_phone
    if (!phone) {
      setError(`${row.quote?.client_name || 'Client'} has no phone on file.`)
      return
    }
    window.location.href = `tel:${String(phone).replace(/\s/g, '')}`
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

  return (
    <div className="lead-root" style={{ paddingBottom: 24 }}>
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>
            Follow-ups
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {total === 0
              ? 'Nothing on your plate today.'
              : `${total} pending · ${buckets.overdue.length} overdue · ${buckets.today.length} due today`}
          </div>
        </div>
      </div>

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

      {total === 0 && (
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
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} busyId={busyId}
        navigate={navigate}
      />
      <Section
        title="Due today"
        rows={buckets.today}
        tone="warning"
        icon={<Clock size={14} strokeWidth={2} />}
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} busyId={busyId}
        navigate={navigate}
      />
      <Section
        title="Tomorrow"
        rows={buckets.tomorrow}
        tone="neutral"
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} busyId={busyId}
        navigate={navigate}
      />
      <Section
        title="This week"
        rows={buckets.week}
        tone="neutral"
        onCall={openCall} onWhatsApp={openWhatsApp} onDone={markDone} busyId={busyId}
        navigate={navigate}
      />
    </div>
  )
}

function Section({ title, rows, tone, icon, onCall, onWhatsApp, onDone, busyId, navigate }) {
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
            onCall={onCall} onWhatsApp={onWhatsApp} onDone={onDone}
            busy={busyId === r.id}
            navigate={navigate}
          />
        ))}
      </div>
    </section>
  )
}

function Row({ row, onCall, onWhatsApp, onDone, busy, navigate }) {
  const client = row.quote?.client_name || 'Unknown client'
  const company = row.quote?.client_company
  const time = row.follow_up_time ? row.follow_up_time.slice(0, 5) : null
  const dateLabel = formatDate(row.follow_up_date)

  return (
    <div
      className="lead-card"
      style={{
        padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div
        onClick={() => row.quote_id && navigate(`/quotes/${row.quote_id}`)}
        style={{ cursor: row.quote_id ? 'pointer' : 'default' }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          {client}
          {company && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 13 }}> · {company}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {dateLabel}{time ? ` · ${time}` : ''}
        </div>
        {row.note && (
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
