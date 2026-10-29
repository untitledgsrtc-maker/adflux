// src/components/work/GpsOffReasonGate.jsx
//
// Phase 530 / 533 — one non-skippable popup when a field rep's GPS OR internet
// has been off for 10+ minutes during the working day (one popup, one reason for
// every unexplained gap of either kind). The rep picks a reason and sends it;
// that releases the popup at once. Admin then marks it Excused / Not excused on
// /pending-approvals (a label only: no score, TA or incentive effect).
//
// Counts only time inside today's check-in .. check-out window and before 19:00
// IST, so overnight / after-hours phone gaps never trigger it. One reason covers
// every unexplained gap in the list (one popup, not many). Mounted in V2AppShell
// for field sales only (same gate as GpsSetupPrompt); web build does nothing
// extra: the events themselves come from the existing GPS tracking.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MapPinOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'

const MIN_GAP_SECONDS = 10 * 60
const POLL_MS = 60 * 1000

const REASONS = [
  { value: 'phone_off',             label: 'Phone was switched off' },
  { value: 'battery_dead',          label: 'Battery died' },
  { value: 'no_signal',             label: 'No network / signal where I was' },
  { value: 'data_finished',         label: 'Mobile data / recharge finished' },
  { value: 'saving_battery',        label: 'Turned it off to save battery' },
  { value: 'turned_off_by_mistake', label: 'Turned it off by mistake' },
  { value: 'other',                 label: 'Other' },
]

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
})

export default function GpsOffReasonGate({ enabled }) {
  const profile = useAuthStore(s => s.profile)
  const uid = profile?.id
  const [gaps, setGaps] = useState([])          // [{ id, kind: 'gps'|'net', startMs, endMs, open }]
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const latchRef = useRef(false)
  const sentRef = useRef(new Set())        // event ids already explained this session (race-proof)
  const [fails, setFails] = useState(0)    // failed sends in a row
  const [snoozeUntil, setSnoozeUntil] = useState(0)

  const check = useCallback(async () => {
    if (!enabled || !uid || latchRef.current) return
    try {
      const today = istTodayISO()
      const { data: ws } = await supabase.from('work_sessions')
        .select('check_in_at, check_out_at')
        .eq('user_id', uid).eq('work_date', today).maybeSingle()
      if (!ws?.check_in_at || ws.check_out_at) { setGaps([]); return }

      const inMs = new Date(ws.check_in_at).getTime()
      const capMs = new Date(`${today}T19:00:00+05:30`).getTime()
      const nowMs = Date.now()
      const windowEnd = Math.min(nowMs, capMs)

      const { data: events } = await supabase.from('gps_off_events')
        .select('id, toggled_off_at, toggled_on_at')
        .eq('user_id', uid)
        .gte('created_at', ws.check_in_at)
        .order('toggled_off_at', { ascending: true })
      const long = (events || []).map(e => {
        const startMs = Math.max(new Date(e.toggled_off_at).getTime(), inMs)
        const endMs = Math.min(e.toggled_on_at ? new Date(e.toggled_on_at).getTime() : nowMs, windowEnd)
        return { id: e.id, kind: 'gps', startMs, endMs, open: !e.toggled_on_at }
      }).filter(g => (g.endMs - g.startMs) / 1000 >= MIN_GAP_SECONDS)

      // Internet gaps (Phase 533). Only rows written by the new tracker count: it inserts a
      // COMPLETE row after the outage ends (created_at ~ regained_at). Rows from the old
      // open-row recorder were created at the START of the "gap" and are known to be false.
      const { data: nets } = await supabase.from('network_off_events')
        .select('id, lost_at, regained_at, created_at')
        .eq('user_id', uid)
        .not('regained_at', 'is', null)
        .gte('regained_at', ws.check_in_at)
        .order('lost_at', { ascending: true })
      const netLong = (nets || [])
        .filter(n => new Date(n.created_at).getTime() >= new Date(n.regained_at).getTime() - 2 * 60 * 1000)
        .map(n => {
          const startMs = Math.max(new Date(n.lost_at).getTime(), inMs)
          const endMs = Math.min(new Date(n.regained_at).getTime(), windowEnd)
          return { id: n.id, kind: 'net', startMs, endMs, open: false }
        }).filter(g => (g.endMs - g.startMs) / 1000 >= MIN_GAP_SECONDS)

      const all = [...long, ...netLong]
      if (!all.length) { setGaps([]); return }

      const gpsIds = long.map(g => g.id)
      const netIds = netLong.map(g => g.id)
      const [gDone, nDone] = await Promise.all([
        gpsIds.length ? supabase.from('gps_off_reasons').select('event_id').in('event_id', gpsIds) : { data: [] },
        netIds.length ? supabase.from('net_off_reasons').select('event_id').in('event_id', netIds) : { data: [] },
      ])
      const doneSet = new Set([...(gDone.data || []), ...(nDone.data || [])].map(r => r.event_id))
      setGaps(all
        .filter(g => !doneSet.has(g.id) && !sentRef.current.has(g.id))
        .sort((a, b) => a.startMs - b.startMs))
    } catch { /* never break the app shell over this check */ }
  }, [enabled, uid])

  useEffect(() => {
    if (!enabled || !uid) return undefined
    check()
    const t = setInterval(check, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', check)
    }
  }, [enabled, uid, check])

  // Snoozed only after repeated failed sends (rep offline): the popup comes back
  // by itself and stays until a reason is sent.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!snoozeUntil) return undefined
    const t = setTimeout(() => tick(n => n + 1), Math.max(0, snoozeUntil - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [snoozeUntil])
  const open = gaps.length > 0 && Date.now() >= snoozeUntil

  async function send() {
    if (latchRef.current || !reason) return
    if (reason === 'other' && !note.trim()) { setErr('Please write a short note for "Other".'); return }
    latchRef.current = true
    setSaving(true)
    setErr('')
    const mk = (g) => ({
      event_id: g.id,
      user_id: uid,
      reason_code: reason,
      reason_note: note.trim() || null,
    })
    const send1 = async (table, list) => {
      if (!list.length) return null
      const { error: e } = await supabase.from(table)
        .upsert(list.map(mk), { onConflict: 'event_id', ignoreDuplicates: true })
      if (!e) list.forEach(g => sentRef.current.add(g.id))
      return e
    }
    const error = (await send1('gps_off_reasons', gaps.filter(g => g.kind === 'gps')))
      || (await send1('net_off_reasons', gaps.filter(g => g.kind === 'net')))
    if (error) {
      setErr(error.message || 'Could not send. Try again.')
      setFails(n => n + 1)
      latchRef.current = false
      setSaving(false)
      // keep only what is still unexplained so a retry doesn't resend the rest
      setGaps(prev => prev.filter(g => !sentRef.current.has(g.id)))
      return
    }
    setFails(0)
    latchRef.current = false
    setSaving(false)
    setReason('')
    setNote('')
    setGaps([])
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(2,6,23,0.80)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, overflowY: 'auto',
      }}
    >
      <div
        role="dialog"
        aria-label="Why was GPS or internet off"
        style={{
          maxWidth: 440, width: '100%',
          background: 'var(--surface, #1e293b)',
          border: '1px solid var(--border, #334155)',
          borderRadius: 14, padding: 20,
          fontFamily: 'var(--font-sans, system-ui)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <MapPinOff size={22} style={{ color: 'var(--warning, #F59E0B)' }} />
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
            {gaps.some(g => g.kind === 'gps') && gaps.some(g => g.kind === 'net')
              ? 'Your GPS and internet were off'
              : gaps.some(g => g.kind === 'net') ? 'Your internet was off' : 'Your GPS was off'}
          </h3>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted, #94a3b8)' }}>
          Tell us why. This goes to admin. You can carry on as soon as you send it.
        </p>

        <div style={{ marginBottom: 14 }}>
          {gaps.map(g => (
            <div
              key={g.id}
              style={{
                fontSize: 13, color: 'var(--text, #f1f5f9)', padding: '6px 0',
                borderBottom: '1px solid var(--border, #334155)',
              }}
            >
              {g.kind === 'net' ? 'Internet' : 'GPS'} · {fmtTime(g.startMs)} – {g.open ? 'still off' : fmtTime(g.endMs)}
              <span style={{ color: 'var(--text-muted, #94a3b8)' }}>
                {' '}· {Math.round((g.endMs - g.startMs) / 60000)} min
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {REASONS.map(r => {
            const on = reason === r.value
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => { setReason(r.value); setErr('') }}
                disabled={saving}
                aria-pressed={on}
                style={{
                  minHeight: 44, textAlign: 'left', padding: '10px 12px',
                  borderRadius: 'var(--radius, 10px)', cursor: 'pointer', fontFamily: 'inherit',
                  border: `1.5px solid ${on ? 'var(--accent, #FFE600)' : 'var(--border-strong, #475569)'}`,
                  background: on ? 'var(--accent-soft, rgba(255,230,0,0.14))' : 'transparent',
                  color: 'var(--text, #f1f5f9)', fontSize: 14, fontWeight: 600,
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>

        <textarea
          className="lead-inp"
          rows={2}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={reason === 'other' ? 'Write the reason (required)' : 'Add a note (optional)'}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, resize: 'vertical' }}
        />

        {err && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger, #EF4444)' }}>{err}</div>}
        {fails >= 2 && (
          <button
            type="button"
            onClick={() => { setSnoozeUntil(Date.now() + 15 * 60 * 1000); setFails(0); setErr('') }}
            style={{
              marginTop: 10, width: '100%', minHeight: 40, borderRadius: 10, cursor: 'pointer',
              border: '1px solid var(--border-strong, #475569)', background: 'transparent',
              color: 'var(--text-muted, #94a3b8)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            Can't send now (offline?) — ask me again in 15 min
          </button>
        )}

        <button
          type="button"
          onClick={send}
          disabled={saving || !reason}
          style={{
            marginTop: 14, width: '100%', minHeight: 46, borderRadius: 10, border: 'none',
            background: 'var(--accent, #FFE600)', color: 'var(--accent-fg, #0f172a)',
            fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
            cursor: saving || !reason ? 'default' : 'pointer',
            opacity: saving || !reason ? 0.6 : 1,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {saving
            ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
            : 'Send to admin'}
        </button>
      </div>
    </div>
  )
}
