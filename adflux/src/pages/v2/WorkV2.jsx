// src/pages/v2/WorkV2.jsx
//
// Phase 16 commit 5 — /work mobile rep daily flow, ported in-place
// from _design_reference/Leads/lead-modals-mobile.jsx (MWorkPlan,
// MWorkActive, MWorkDone). 5-state machine drives the page render:
//
//   A_PLAN    — morning plan form (5 meeting slots + calls + leads + focus)
//   A_CHECKIN — plan saved, waiting for GPS check-in
//   B_ACTIVE  — checked in, live counters + quick actions + meeting list
//   C_CHECKOUT— evening report submitted, waiting for GPS check-out
//   D_DONE    — day complete summary
//
// State derived from work_sessions row (one per user_id × work_date).
// Counters auto-incremented by Postgres triggers when activities log.
// GPS captured silently on check-in/out — fails gracefully if denied.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sun, MapPin, Phone, Calendar, UserPlus, Loader2, Trash2, Plus,
  CheckCircle2, Users as UsersIcon, Edit3, Mic,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { LeadAvatar, Pill } from '../../components/leads/LeadShared'
import TodayTasksPanel from '../../components/leads/TodayTasksPanel'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* ─── Morning plan draft ─── */
  const [plannedMeetings, setPlannedMeetings] = useState([
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
    { client: '', time: '', location: '' },
  ])
  const [plannedCalls, setPlannedCalls] = useState(20)
  const [plannedLeads, setPlannedLeads] = useState(10)
  const [focusArea, setFocusArea] = useState('')

  /* ─── Evening draft ─── */
  const [evening, setEvening] = useState({
    quotes_sent: '', blockers: '', tomorrow_focus: '',
  })

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase
      .from('work_sessions')
      .select('*')
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
      .maybeSingle()
    if (err) {
      setError(err.message)
      setSession(null)
    } else {
      setSession(data)
      if (data?.planned_meetings?.length) setPlannedMeetings(data.planned_meetings)
      if (data?.planned_calls)             setPlannedCalls(data.planned_calls)
      if (data?.planned_leads)             setPlannedLeads(data.planned_leads)
      if (data?.evening_summary?.focus)    setFocusArea(data.evening_summary.focus)
      if (data?.evening_summary)           setEvening({
        quotes_sent: data.evening_summary.quotes_sent || '',
        blockers: data.evening_summary.blockers || '',
        tomorrow_focus: data.evening_summary.tomorrow_focus || '',
      })
    }
    setLoading(false)
  }
  useEffect(() => { if (profile?.id) load() /* eslint-disable-next-line */ }, [profile?.id])

  const targets = useMemo(() => {
    return profile?.daily_targets || { meetings: 5, calls: 20, new_leads: 10 }
  }, [profile])
  const counters = session?.daily_counters || { meetings: 0, calls: 0, new_leads: 0 }

  const stateName =
    !session?.plan_submitted_at           ? 'A_PLAN'    :
    !session?.check_in_at                 ? 'A_CHECKIN' :
    !session?.evening_report_submitted_at ? 'B_ACTIVE'  :
    !session?.check_out_at                ? 'C_CHECKOUT':
    'D_DONE'

  /* ─── Submit morning plan ─── */
  async function submitPlan() {
    setBusy(true); setError('')
    const filtered = plannedMeetings.filter(m => m.client.trim())
    const payload = {
      user_id:           profile.id,
      work_date:         TODAY(),
      plan_submitted_at: new Date().toISOString(),
      planned_meetings:  filtered,
      planned_calls:     Number(plannedCalls) || 0,
      planned_leads:     Number(plannedLeads) || 0,
      evening_summary:   focusArea ? { focus: focusArea } : null,
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .upsert(payload, { onConflict: 'user_id,work_date' })
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function toggleMeetingDone(idx) {
    if (!session?.planned_meetings) return
    setBusy(true); setError('')
    const next = session.planned_meetings.map((m, i) =>
      i === idx ? { ...m, done: !m.done } : m
    )
    const wasDone = !!session.planned_meetings[idx]?.done
    const nowDone = !wasDone
    const nextCounters = {
      ...(session.daily_counters || {}),
      meetings: Math.max(0, (session.daily_counters?.meetings || 0) + (nowDone ? 1 : -1)),
    }
    const { error: err } = await supabase
      .from('work_sessions')
      .update({ planned_meetings: next, daily_counters: nextCounters })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function doCheckIn() {
    setBusy(true); setError('')
    const gps = await captureGps()
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        check_in_at:      new Date().toISOString(),
        check_in_gps_lat: gps?.lat || null,
        check_in_gps_lng: gps?.lng || null,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  async function submitEvening() {
    setBusy(true); setError('')
    const summary = {
      ...(session?.evening_summary || {}),
      quotes_sent:    evening.quotes_sent,
      blockers:       evening.blockers,
      tomorrow_focus: evening.tomorrow_focus,
      counters,
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

  async function doCheckOut() {
    setBusy(true); setError('')
    const gps = await captureGps()
    const { error: err } = await supabase
      .from('work_sessions')
      .update({
        check_out_at:      new Date().toISOString(),
        check_out_gps_lat: gps?.lat || null,
        check_out_gps_lng: gps?.lng || null,
      })
      .eq('user_id', profile.id)
      .eq('work_date', TODAY())
    setBusy(false)
    if (err) { setError(err.message); return }
    load()
  }

  if (loading) {
    return (
      <div className="lead-root">
        <div className="m-screen">
          <div className="m-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 8 }}>Loading work session…</div>
          </div>
        </div>
      </div>
    )
  }

  const niceDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short',
  })
  const repInitials = (profile?.name || '').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  const repColor = profile?.id ? (profile.id.charCodeAt(0) % 6) + 1 : 4

  return (
    <div className="lead-root">
      <div className="m-screen">
        {/* Greet header — design: avatar on Plan, "● live" pill on Active,
            Day done greeting on D_DONE. */}
        <div className="m-greet">
          <div>
            <div className="hello">
              {stateName === 'D_DONE' ? 'Day done.' :
               stateName === 'B_ACTIVE' ? 'Day in progress' :
               'Good morning, ' + (profile?.name?.split(' ')[0] || '')}
            </div>
            <div className="date">{niceDate}{session?.check_in_at ? ` · checked in ${formatTime(session.check_in_at)}` : ''}</div>
          </div>
          {stateName === 'B_ACTIVE' ? (
            <Pill tone="success">
              <span className="lead-live-dot" style={{ marginRight: 5, width: 6, height: 6 }} />
              live
            </Pill>
          ) : (
            profile?.name && (
              <span className={`lead-avatar av-${repColor}`} style={{ width: 36, height: 36, fontSize: 13 }}>
                {repInitials}
              </span>
            )
          )}
        </div>

        {error && (
          <div
            style={{
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
              borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12,
            }}
          >
            ⚠ {error}
          </div>
        )}

        {/* ─── A_PLAN: morning plan form ─── */}
        {stateName === 'A_PLAN' && (
          <div className="m-card">
            <div className="m-card-title">
              <span>Today's plan <span className="pill">Step 1 of 3</span></span>
              <Sun size={16} style={{ color: 'var(--warning)' }} />
            </div>
            <label className="lead-fld-label">Planned meetings</label>
            {plannedMeetings.map((m, i) => (
              <div key={i} className="m-meeting-row">
                <input
                  className="lead-inp"
                  type="time"
                  style={{ width: 80, padding: '6px 8px' }}
                  value={m.time}
                  onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, time: e.target.value } : x))}
                />
                <div className="info" style={{ display: 'grid', gap: 4 }}>
                  <input
                    className="lead-inp"
                    placeholder="Client"
                    style={{ padding: '6px 8px' }}
                    value={m.client}
                    onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, client: e.target.value } : x))}
                  />
                  <input
                    className="lead-inp"
                    placeholder="Where"
                    style={{ padding: '6px 8px', fontSize: 12 }}
                    value={m.location}
                    onChange={e => setPlannedMeetings(prev => prev.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                  />
                </div>
                <button
                  type="button"
                  className="lead-btn lead-btn-sm"
                  onClick={() => setPlannedMeetings(prev => prev.filter((_, j) => j !== i))}
                  aria-label="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="lead-btn lead-btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => setPlannedMeetings(prev => [...prev, { client: '', time: '', location: '' }])}
            >
              <Plus size={12} /> Add another
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              <div>
                <label className="lead-fld-label">Calls planned</label>
                <input
                  className="lead-inp"
                  type="number"
                  value={plannedCalls}
                  onChange={e => setPlannedCalls(e.target.value)}
                />
              </div>
              <div>
                <label className="lead-fld-label">New leads target</label>
                <input
                  className="lead-inp"
                  type="number"
                  value={plannedLeads}
                  onChange={e => setPlannedLeads(e.target.value)}
                />
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <label className="lead-fld-label">Focus area</label>
              <input
                className="lead-inp"
                value={focusArea}
                onChange={e => setFocusArea(e.target.value)}
                placeholder="Close Sunrise · push 2 quotes"
              />
            </div>
          </div>
        )}

        {stateName === 'A_PLAN' && (
          <button className="m-cta" onClick={submitPlan} disabled={busy}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            Submit plan
          </button>
        )}

        {/* ─── A_CHECKIN: plan submitted, waiting for check-in ─── */}
        {stateName === 'A_CHECKIN' && (
          <>
            <div className="m-card">
              <div className="m-card-title">Plan submitted ✓</div>
              <PlanSummary session={session} />
            </div>
            <button className="m-cta" onClick={doCheckIn} disabled={busy}>
              <MapPin size={16} />
              {busy ? 'Capturing GPS…' : 'Check in'}
            </button>
          </>
        )}

        {/* ─── B_ACTIVE: checked in, working day ─── */}
        {stateName === 'B_ACTIVE' && (
          <>
            <div className="m-counters">
              <Counter num={counters.meetings || 0} target={targets.meetings} label="Meetings" />
              <Counter num={counters.calls || 0}    target={targets.calls}    label="Calls" />
              <Counter num={counters.new_leads || 0} target={targets.new_leads} label="New leads" />
            </div>

            {/* Phase 19 — Smart Task Engine: today's ranked call list */}
            <TodayTasksPanel userId={profile.id} />

            <div className="m-quick">
              <button className="tile" onClick={() => navigate('/leads')}>
                <div className="ti"><Phone size={16} /></div>
                Log call
              </button>
              <button className="tile" onClick={() => navigate('/leads')}>
                <div className="ti"><Calendar size={16} /></div>
                Log meet
              </button>
              <button className="tile" onClick={() => navigate('/leads/new')}>
                <div className="ti"><UserPlus size={16} /></div>
                New lead
              </button>
              <button className="tile" onClick={() => navigate('/leads')}>
                <div className="ti"><UsersIcon size={16} /></div>
                My leads
              </button>
            </div>

            {session?.planned_meetings?.length > 0 && (
              <div className="m-card">
                <div className="m-card-title">Today's meetings</div>
                {session.planned_meetings.map((m, i) => (
                  <div key={i} className="m-meeting-row">
                    <span className="time">{m.time || '—'}</span>
                    <div className="info">
                      <div className="who">{m.client}</div>
                      {m.location && <div className="where">{m.location}</div>}
                    </div>
                    {/* Phase 22b — Mark done pattern from design.
                        m.done is a flag on the planned_meetings JSONB
                        array. Toggle persists to work_sessions row. */}
                    {m.done ? (
                      <Pill tone="success">✓ done</Pill>
                    ) : (
                      <button
                        type="button"
                        className="lead-btn lead-btn-sm lead-btn-primary"
                        onClick={() => toggleMeetingDone(i)}
                        disabled={busy}
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="m-card">
              <div className="m-card-title">
                <span>Evening report</span>
                <button
                  type="button"
                  className="lead-btn lead-btn-sm"
                  onClick={() => navigate('/voice/evening')}
                  title="Speak your summary instead of typing"
                >
                  <Mic size={11} /> Speak summary
                </button>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label className="lead-fld-label">Quotes sent today</label>
                  <input
                    className="lead-inp"
                    type="number"
                    value={evening.quotes_sent}
                    onChange={e => setEvening(prev => ({ ...prev, quotes_sent: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="lead-fld-label">Blockers</label>
                  <textarea
                    className="lead-inp"
                    rows={2}
                    value={evening.blockers}
                    onChange={e => setEvening(prev => ({ ...prev, blockers: e.target.value }))}
                    placeholder="What stopped you closing?"
                  />
                </div>
                <div>
                  <label className="lead-fld-label">Tomorrow focus</label>
                  <input
                    className="lead-inp"
                    value={evening.tomorrow_focus}
                    onChange={e => setEvening(prev => ({ ...prev, tomorrow_focus: e.target.value }))}
                    placeholder="Sunrise close, push 2 quotes"
                  />
                </div>
              </div>
            </div>

            <button className="m-cta" onClick={submitEvening} disabled={busy}>
              {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              Submit evening report
            </button>
          </>
        )}

        {/* ─── C_CHECKOUT: evening submitted, waiting for check-out ─── */}
        {stateName === 'C_CHECKOUT' && (
          <>
            <div className="m-card">
              <div className="m-card-title">Evening report submitted ✓</div>
              <DaySummary counters={counters} targets={targets} />
              {session?.evening_summary?.tomorrow_focus && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                  Tomorrow: {session.evening_summary.tomorrow_focus}
                </div>
              )}
            </div>
            <button className="m-cta" onClick={doCheckOut} disabled={busy}>
              <MapPin size={16} />
              {busy ? 'Capturing GPS…' : 'Check out'}
            </button>
          </>
        )}

        {/* ─── D_DONE ─── */}
        {stateName === 'D_DONE' && (
          <>
            <div className="m-counters">
              <Counter num={counters.meetings || 0} target={targets.meetings}  label="Meetings ✓" tone={counters.meetings >= targets.meetings ? 'good' : 'warn'} />
              <Counter num={counters.calls || 0}    target={targets.calls}     label="Calls"     tone={counters.calls >= targets.calls ? 'good' : 'warn'} />
              <Counter num={counters.new_leads || 0} target={targets.new_leads} label="Leads ✓"   tone={counters.new_leads >= targets.new_leads ? 'good' : 'warn'} />
            </div>

            <div className="m-card">
              <div className="m-card-title">Evening summary</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {session?.evening_summary?.quotes_sent ? `${session.evening_summary.quotes_sent} quotes sent. ` : ''}
                {session?.evening_summary?.blockers || ''}
              </div>
              {session?.evening_summary?.tomorrow_focus && (
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 8 }}>
                  <b>Tomorrow:</b> {session.evening_summary.tomorrow_focus}
                </div>
              )}
            </div>

            <button className="m-cta m-cta-ghost" onClick={() => navigate('/leads')}>
              View my leads
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ─── Sub-components ─── */
function Counter({ num, target, label, tone }) {
  const color = tone === 'good' ? 'var(--success)'
              : tone === 'warn' ? 'var(--warning)'
              : undefined
  return (
    <div className="m-count">
      <div className="num" style={color ? { color } : undefined}>
        {num}
        {target ? <span className="target">/{target}</span> : null}
      </div>
      <div className="lbl">{label}</div>
    </div>
  )
}

function PlanSummary({ session }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
      <span>{(session.planned_meetings || []).length} meetings · {session.planned_calls} calls · {session.planned_leads} new leads</span>
      {session.evening_summary?.focus && (
        <span>Focus: {session.evening_summary.focus}</span>
      )}
    </div>
  )
}

function DaySummary({ counters, targets }) {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-muted)' }}>
      <span><b style={{ color: 'var(--text)' }}>{counters.meetings}</b>/{targets.meetings} meetings</span>
      <span><b style={{ color: 'var(--text)' }}>{counters.calls}</b>/{targets.calls} calls</span>
      <span><b style={{ color: 'var(--text)' }}>{counters.new_leads}</b>/{targets.new_leads} new leads</span>
    </div>
  )
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
