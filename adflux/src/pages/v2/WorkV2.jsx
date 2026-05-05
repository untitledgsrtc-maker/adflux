// src/pages/v2/WorkV2.jsx
//
// Phase 12 (M1) — daily work flow for sales reps + telecallers.
// Mobile-first.  Three states based on time-of-day + work_session row:
//
//   State A — before check-in: morning plan form
//   State B — checked in: live counters + quick action buttons
//   State C — needs evening report → check-out
//
// Enforcement (per master spec §3 + architecture §4.1):
//   • Cannot tap Check In without a submitted morning plan.
//   • Cannot tap Check Out without a submitted evening report.
//   • GPS captured at check-in, check-out (silent fail if denied).
//
// One row per (user_id, work_date).  Counters auto-incremented by
// triggers in supabase_phase12_m1_m7_foundation.sql when activities
// are logged.

import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, Moon, MapPin, Phone, Calendar, UserPlus, CheckCircle2,
  AlertTriangle, Loader2, ArrowRight, Edit3, Plus, Trash2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const TODAY = () => new Date().toISOString().slice(0, 10)

async function captureGps() {
  if (!navigator.geolocation) return null
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 5000, maximumAge: 60000,
      })
    })
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy),
    }
  } catch (e) {
    return null
  }
}

export default function WorkV2() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  // Morning plan draft
  const [plannedMeetings, setPlannedMeetings] = useState([
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
  ])
  const [plannedCalls, setPlannedCalls] = useState(20)
  const [plannedLeads, setPlannedLeads] = useState(10)
  const [focusArea, setFocusArea]       = useState('')

  // Evening report draft
  const [eveningSummary, setEveningSummary] = useState({
    quotes_sent: '',
    blockers: '',
    tomorrow_focus: '',
  })

  /* ─── Load today's session ─── */
  async function load() {
    setLoading(true)
    setError('')
    const today = TODAY()
    const { data, error: err } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('user_id', profile.id)
      .eq('work_date', today)
      .maybeSingle()
    if (err) {
      setError(err.message)
      setSession(null)
    } else {
      setSession(data)
      // Pre-fill plan draft from existing session if present
      if (data?.planned_meetings) setPlannedMeetings(data.planned_meetings)
      if (data?.planned_calls)    setPlannedCalls(data.planned_calls)
      if (data?.planned_leads)    setPlannedLeads(data.planned_leads)
      if (data?.evening_summary)  setEveningSummary(data.evening_summary)
    }
    setLoading(false)
  }

  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

  // Pull rep's daily targets from their user record (with safe defaults).
  const targets = useMemo(() => {
    return profile?.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
  }, [profile])

  const counters = session?.daily_counters || { meetings: 0, calls: 0, new_leads: 0 }

  /* ─── State machine — derive current state from session ─── */
  const stateName =
    !session?.plan_submitted_at         ? 'A_PLAN' :
    !session?.check_in_at               ? 'A_CHECKIN' :
    !session?.evening_report_submitted_at ? 'B_ACTIVE' :
    !session?.check_out_at              ? 'C_CHECKOUT' :
    'D_DONE'

  /* ─── Submit morning plan ─── */
  async function submitMorningPlan() {
    setBusy(true); setError('')
    const today = TODAY()
    const filteredMeetings = plannedMeetings.filter(m => m.client.trim())
    const payload = {
      user_id: profile.id,
      work_date: today,
      plan_submitted_at: new Date().toISOString(),
      planned_meetings: filteredMeetings,
      planned_calls: Number(plannedCalls) || 0,
      planned_leads: Number(plannedLeads) || 0,
      evening_summary: focusArea ? { focus: focusArea } : null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .upsert(payload, { onConflict: 'user_id,work_date' })
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  /* ─── Check in (with GPS) ─── */
  async function doCheckIn() {
    setBusy(true); setError('')
    const gps = await captureGps()
    const patch = {
      check_in_at: new Date().toISOString(),
      check_in_gps_lat: gps?.lat || null,
      check_in_gps_lng: gps?.lng || null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .update(patch)
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  /* ─── Submit evening report ─── */
  async function submitEveningReport() {
    setBusy(true); setError('')
    const summary = {
      ...(session?.evening_summary || {}),
      quotes_sent: eveningSummary.quotes_sent,
      blockers: eveningSummary.blockers,
      tomorrow_focus: eveningSummary.tomorrow_focus,
      counters: counters,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        evening_report_submitted_at: new Date().toISOString(),
        evening_summary: summary,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  /* ─── Check out (with GPS) ─── */
  async function doCheckOut() {
    setBusy(true); setError('')
    const gps = await captureGps()
    const patch = {
      check_out_at: new Date().toISOString(),
      check_out_gps_lat: gps?.lat || null,
      check_out_gps_lng: gps?.lng || null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .update(patch)
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  /* ─── Render ─── */
  if (loading) return <div className="v2d-loading"><div className="v2d-spinner" />Loading work session…</div>

  return (
    <div className="v2d-work">
      <div className="v2d-page-head">
        <div>
          <div className="v2d-page-kicker">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <h1 className="v2d-page-title">Today's work</h1>
          <div className="v2d-page-sub">
            {stateName === 'A_PLAN' && 'Submit your morning plan to start the day.'}
            {stateName === 'A_CHECKIN' && 'Plan submitted. Tap Check In when you start.'}
            {stateName === 'B_ACTIVE' && 'Active. Log activities through the day.'}
            {stateName === 'C_CHECKOUT' && 'Submit evening report, then check out.'}
            {stateName === 'D_DONE' && 'Day complete. See you tomorrow.'}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(248,113,113,.10)',
          border: '1px solid rgba(248,113,113,.28)',
          color: '#f87171',
          borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13,
        }}>⚠ {error}</div>
      )}

      {/* ─── State A: morning plan ─── */}
      {stateName === 'A_PLAN' && (
        <div className="v2d-panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Sun size={22} style={{ color: '#fbbf24' }} />
            <div style={{ fontSize: 16, fontWeight: 600 }}>Morning plan</div>
          </div>

          <div className="v2d-page-kicker" style={{ marginBottom: 8 }}>Planned meetings</div>
          {plannedMeetings.map((m, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 90px 1fr 28px', gap: 8, marginBottom: 8 }}>
              <input
                placeholder={`Meeting ${i+1} — client name`}
                value={m.client}
                onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, client: e.target.value } : x))}
              />
              <input
                type="time"
                value={m.time}
                onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, time: e.target.value } : x))}
              />
              <input
                placeholder="Location"
                value={m.location}
                onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
              />
              <button
                type="button"
                onClick={() => setPlannedMeetings(prev => prev.filter((_, j) => j !== i))}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--v2-ink-2)', cursor: 'pointer',
                }}
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="v2d-ghost v2d-ghost--btn"
            onClick={() => setPlannedMeetings(prev => [...prev, { client: '', time: '', location: '' }])}
            style={{ marginBottom: 16 }}
          >
            <Plus size={12} /> Add meeting
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label>Calls planned</label>
              <input type="number" min="0" value={plannedCalls} onChange={e => setPlannedCalls(e.target.value)} />
            </div>
            <div className="fg" style={{ marginBottom: 0 }}>
              <label>New leads to add</label>
              <input type="number" min="0" value={plannedLeads} onChange={e => setPlannedLeads(e.target.value)} />
            </div>
          </div>

          <div className="fg">
            <label>Focus today</label>
            <input
              placeholder="e.g. close GSPC quote, follow up Stanza Living"
              value={focusArea}
              onChange={e => setFocusArea(e.target.value)}
            />
          </div>

          <button
            className="v2d-cta"
            onClick={submitMorningPlan}
            disabled={busy}
            style={{ width: '100%' }}
          >
            {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                  : <><CheckCircle2 size={14} /> Submit plan</>}
          </button>
        </div>
      )}

      {/* ─── State A.5: plan done, ready to check in ─── */}
      {stateName === 'A_CHECKIN' && (
        <div className="v2d-panel" style={{ padding: 28, textAlign: 'center' }}>
          <CheckCircle2 size={40} style={{ color: '#4ade80', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Plan submitted ✓</div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 20 }}>
            {session.planned_meetings?.length || 0} meetings · {session.planned_calls || 0} calls · {session.planned_leads || 0} new leads
          </div>
          <button
            className="v2d-cta"
            onClick={doCheckIn}
            disabled={busy}
            style={{ minWidth: 200 }}
          >
            {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Checking in…</>
                  : <><MapPin size={14} /> Check In</>}
          </button>
          <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 12 }}>
            GPS captured if browser allows. Won't block check-in if denied.
          </div>
        </div>
      )}

      {/* ─── State B: active ─── */}
      {stateName === 'B_ACTIVE' && (
        <>
          {/* Live counters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            <CounterCard label="Meetings" current={counters.meetings || 0} target={targets.meetings} icon={Calendar} />
            <CounterCard label="Calls"    current={counters.calls    || 0} target={targets.calls}    icon={Phone} />
            <CounterCard label="New leads" current={counters.new_leads || 0} target={targets.new_leads} icon={UserPlus} />
          </div>

          {/* Quick action buttons */}
          <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
            <div className="v2d-page-kicker" style={{ marginBottom: 12 }}>Quick actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <button className="v2d-ghost v2d-ghost--btn" onClick={() => navigate('/leads')} style={{ justifyContent: 'center' }}>
                <Phone size={14} /> Log Call
              </button>
              <button className="v2d-ghost v2d-ghost--btn" onClick={() => navigate('/leads')} style={{ justifyContent: 'center' }}>
                <Calendar size={14} /> Log Meeting
              </button>
              <button className="v2d-cta" onClick={() => navigate('/leads/upload')} style={{ justifyContent: 'center' }}>
                <UserPlus size={14} /> Add Lead
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--v2-ink-2)', marginTop: 12, marginBottom: 0 }}>
              Activities logged on a lead automatically increment your counters.
            </p>
          </div>

          {/* Today's plan recap */}
          {session.planned_meetings?.length > 0 && (
            <div className="v2d-panel" style={{ padding: 20, marginBottom: 16 }}>
              <div className="v2d-page-kicker" style={{ marginBottom: 8 }}>This morning's plan</div>
              {session.planned_meetings.map((m, i) => (
                <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: i < session.planned_meetings.length - 1 ? '1px solid var(--v2-line, rgba(255,255,255,.06))' : 'none' }}>
                  <strong>{m.time || '—'}</strong> · {m.client} {m.location && <span style={{ color: 'var(--v2-ink-2)' }}>· {m.location}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Cant check out yet — needs evening report first */}
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 8 }}>
              When you're done for the day, submit evening report first.
            </div>
            <button
              className="v2d-cta"
              onClick={() => {
                // Just transition to C_CHECKOUT by showing the form
                // We're already in B_ACTIVE; jump to C requires nothing
                // (the report form is rendered conditionally).
                // Trick: scroll to bottom and show the form at the bottom always.
                document.getElementById('evening-form')?.scrollIntoView({ behavior: 'smooth' })
              }}
              style={{ background: 'transparent', border: '1px solid var(--v2-line, rgba(255,255,255,.1))', color: 'var(--v2-ink-1)' }}
            >
              <Moon size={14} /> End the day
            </button>
          </div>

          {/* Evening report inline (so they can fill earlier if they want) */}
          <div id="evening-form" className="v2d-panel" style={{ padding: 20, marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Moon size={22} style={{ color: '#c084fc' }} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>Evening report</div>
            </div>

            <div style={{
              background: 'var(--v2-bg-2)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 14,
              fontSize: 12, color: 'var(--v2-ink-1)',
            }}>
              <strong>Today's totals:</strong> {counters.meetings || 0} meetings · {counters.calls || 0} calls · {counters.new_leads || 0} new leads
            </div>

            <div className="fg">
              <label>Quotes sent today</label>
              <input
                type="number"
                min="0"
                value={eveningSummary.quotes_sent}
                onChange={e => setEveningSummary(s => ({ ...s, quotes_sent: e.target.value }))}
                placeholder="0"
              />
            </div>
            <div className="fg">
              <label>Blockers</label>
              <textarea
                value={eveningSummary.blockers}
                onChange={e => setEveningSummary(s => ({ ...s, blockers: e.target.value }))}
                placeholder="What's stuck? What do you need from the team?"
                style={{ minHeight: 60 }}
              />
            </div>
            <div className="fg">
              <label>Tomorrow's focus</label>
              <textarea
                value={eveningSummary.tomorrow_focus}
                onChange={e => setEveningSummary(s => ({ ...s, tomorrow_focus: e.target.value }))}
                placeholder="3 things you'll prioritize tomorrow."
                style={{ minHeight: 60 }}
              />
            </div>

            <button
              className="v2d-cta"
              onClick={submitEveningReport}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                    : <><CheckCircle2 size={14} /> Submit report</>}
            </button>
          </div>
        </>
      )}

      {/* ─── State C: report submitted, check out ─── */}
      {stateName === 'C_CHECKOUT' && (
        <div className="v2d-panel" style={{ padding: 28, textAlign: 'center' }}>
          <CheckCircle2 size={40} style={{ color: '#c084fc', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Report submitted ✓</div>
          <div style={{ fontSize: 12, color: 'var(--v2-ink-2)', marginBottom: 20 }}>
            {counters.meetings || 0} meetings · {counters.calls || 0} calls · {counters.new_leads || 0} new leads
          </div>
          <button
            className="v2d-cta"
            onClick={doCheckOut}
            disabled={busy}
            style={{ minWidth: 200 }}
          >
            {busy ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Checking out…</>
                  : <><Moon size={14} /> Check Out</>}
          </button>
        </div>
      )}

      {/* ─── State D: done ─── */}
      {stateName === 'D_DONE' && (
        <div className="v2d-panel" style={{ padding: 28, textAlign: 'center' }}>
          <CheckCircle2 size={40} style={{ color: '#4ade80', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Day complete</div>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2)', marginBottom: 20 }}>
            Checked out at {new Date(session.check_out_at).toLocaleTimeString('en-IN')}
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat label="Meetings" value={`${counters.meetings || 0} / ${targets.meetings}`} hit={counters.meetings >= targets.meetings} />
            <Stat label="Calls" value={`${counters.calls || 0} / ${targets.calls}`} hit={counters.calls >= targets.calls} />
            <Stat label="Leads" value={`${counters.new_leads || 0} / ${targets.new_leads}`} hit={counters.new_leads >= targets.new_leads} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Sub-components ─── */
function CounterCard({ label, current, target, icon: Icon }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0
  const hit = current >= target
  return (
    <div className="v2d-panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
        <Icon size={12} />
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontFamily: 'var(--v2-display)', fontSize: 28, fontWeight: 600, color: hit ? '#4ade80' : 'var(--v2-ink-0)' }}>
          {current}
        </div>
        <div style={{ fontSize: 14, color: 'var(--v2-ink-2)' }}>/ {target}</div>
        {hit && <CheckCircle2 size={14} style={{ color: '#4ade80', marginLeft: 'auto' }} />}
      </div>
      <div style={{
        height: 4, background: 'var(--v2-bg-2)', borderRadius: 2, marginTop: 10,
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: hit ? '#4ade80' : pct > 50 ? '#fbbf24' : '#f87171',
          borderRadius: 2, transition: 'width .4s ease',
        }} />
      </div>
    </div>
  )
}

function Stat({ label, value, hit }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--v2-ink-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--v2-display)', fontSize: 22, fontWeight: 600, color: hit ? '#4ade80' : 'var(--v2-ink-0)' }}>
        {value}
      </div>
    </div>
  )
}
