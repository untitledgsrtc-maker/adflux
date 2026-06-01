// src/components/work/DaySummaryCard.jsx
//
// Phase 76 — evening day summary card.
//
// Owner directive (22 May 2026):
//   "let do at evening clik on summry, we detect all activity and
//    share via whats app... 7 PM trigger auto-appear with manual
//    close option"
//
// Behavior:
//   • After 7 PM IST the card auto-renders above the V2Hero on /work.
//   • Before 7 PM the card is hidden by default but rep can still
//     trigger it via the "Wrap up day" smart-task chip (Phase 77).
//   • Card shows plan vs actual + activity + tracking integrity.
//   • Primary CTA: "Share to your group" → opens WhatsApp with text
//     pre-filled, rep picks role group manually.
//   • Stamp evening_summary_sent_at on share so the optional 7:30 PM
//     auto-send (Phase 77) doesn't duplicate.
//
// Role-aware: telecaller hides Meetings/Site Visits rows. Sales /
// agency / sales_manager see everything.

import React, { useMemo, useState } from 'react'
import {
  ClipboardList, Phone, Users, Map as MapIcon,
  Mic, BadgeCheck, Wifi, WifiOff, AlertTriangle, Send,
  X, ChevronRight, Activity, Satellite, LogOut, Calendar,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'
import useDaySummary from '../../hooks/useDaySummary'
import { formatDaySummaryText, openWhatsAppShare } from '../../utils/whatsappSummary'

function fmt(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Row({ icon, label, value, tone }) {
  // tone: undefined | 'success' | 'warn' | 'danger'
  const color =
    tone === 'success' ? 'var(--v2-green, #10B981)' :
    tone === 'warn'    ? 'var(--v2-amber, #F59E0B)' :
    tone === 'danger'  ? 'var(--v2-rose,  #EF4444)' :
                         'var(--v2-ink-0, #f1f5f9)'
  return (
    <div
      style={{
        display:        'flex',
        alignItems:     'center',
        gap:            10,
        padding:        '7px 0',
        borderBottom:   '1px solid var(--v2-line, #1e293b)',
      }}
    >
      <span
        style={{
          display:      'inline-flex',
          width:        20,
          flexShrink:   0,
          color:        'var(--v2-ink-2, #94a3b8)',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          flex:       1,
          fontSize:   13,
          color:      'var(--v2-ink-1, #cbd5e1)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize:     14,
          fontWeight:   600,
          fontFamily:   'var(--v2-display, "Space Grotesk")',
          color,
        }}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * @param {object} props
 * @param {boolean} props.forceShow — bypass the 7 PM gate (used by
 *                                    the manual "wrap up day" entry
 *                                    point)
 * @param {() => void} [props.onClose] — fires when rep taps X
 */
export default function DaySummaryCard({
  forceShow = false,
  onClose,
  // Phase 90.4 — evening check-out wired into the card. Owner
  // directive: "Option B — show only evening — after showimg
  // today report at 7 pm". Card already auto-mounts at 19:00 IST,
  // so adding the Check Out CTA inside it gives the evening-only
  // visibility without adding a separate time gate. Parent passes
  // doCheckOut + current state.
  onCheckOut,
  checkedOut = false,
  checkOutBusy = false,
}) {
  const profile = useAuthStore(s => s.profile)
  const { data, loading, refresh } = useDaySummary()
  const [sending, setSending] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // 7 PM IST = 13:30 UTC. Use Intl to read current IST hour cleanly
  // — same approach as src/utils/istDate.js, but inline since we
  // only need the hour-of-day check.
  const istHourNow = useMemo(() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour:    '2-digit',
      hour12:  false,
    }).formatToParts(new Date())
    const hh = parts.find(p => p.type === 'hour')?.value || '00'
    return parseInt(hh, 10)
  }, [])

  const isAfter7PM = istHourNow >= 19
  const shouldShow = !dismissed && (forceShow || isAfter7PM)

  // Hide for admin / co_owner — they don't punch a personal day, they
  // watch the team dashboard. (Owner can still see the v1 card for
  // QA but no point auto-pushing it into the admin /work view.)
  const role = (profile?.role || '').toLowerCase()
  if (role === 'admin' || role === 'co_owner') return null
  if (!shouldShow) return null
  if (!data && !loading) return null

  async function handleShare() {
    if (!data) return
    setSending(true)
    try {
      // Phase 109.2 — refetch BEFORE building the message so the share
      // never sends a stale snapshot (daily_ta + counters grow through
      // the day; the old code shared load-time state, forcing a reshare).
      // Falls back to current state if the refetch fails.
      const fresh = await refresh()
      const text = formatDaySummaryText(fresh || data)
      openWhatsAppShare(text)
      // Stamp the work_sessions row so server-side auto-send (Phase 77)
      // doesn't double-fire. Best-effort — don't block the share if
      // RLS/network hiccups.
      try {
        await supabase.from('work_sessions')
          .upsert({
            user_id:                 profile.id,
            work_date:               istTodayISO(),
            evening_summary_sent_at: new Date().toISOString(),
          }, { onConflict: 'user_id,work_date' })
        refresh()
      } catch (e) {
        console.warn('[DaySummaryCard] stamp failed:', e?.message || e)
      }
      // Phase 92a (24 May 2026) — auto-checkout on summary share.
      // Owner directive: "share = end of day, no separate tap." If
      // parent supplied onCheckOut AND the rep hasn't already checked
      // out, fire the same checkout flow the manual button uses. That
      // captures GPS + writes check_out_at + invokes parent load() so
      // session.check_out_at updates and the manual button auto-hides
      // (UI flips to "Checked out · day closed").
      //
      // Best-effort: errors swallowed — the share already succeeded;
      // failed checkout would just leave the manual button visible
      // for the rep to tap as fallback.
      if (onCheckOut && !checkedOut && !checkOutBusy) {
        try {
          // Phase 92c — tag the audit row so admin can split manual
          // taps from share-chained closes from cron auto-closes.
          await onCheckOut('auto_share')
        } catch (e) {
          console.warn('[DaySummaryCard] auto-checkout on share failed:', e?.message || e)
        }
      }
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    setDismissed(true)
    if (onClose) onClose()
  }

  const t = data?.tracking || {}
  const p = data?.plan || {}
  const a = data?.actual || {}
  const isTC = role === 'telecaller'

  const meetingsTone = !isTC
    ? (a.meetings >= p.meetings ? 'success' : a.meetings === 0 ? 'danger' : 'warn')
    : undefined
  const callsTone   = a.calls >= p.calls ? 'success' : a.calls < (p.calls / 2) ? 'danger' : 'warn'
  const leadsTone   = a.leads >= p.leads ? 'success' : a.leads === 0 ? 'danger' : 'warn'
  const gpsOffTone  = (t.gps_off_count || 0) === 0 ? 'success' : (t.gps_off_count || 0) >= 5 ? 'danger' : 'warn'
  const netOffTone  = (t.network_off_count || 0) === 0 ? 'success' : 'warn'
  const fsTone      = (t.force_stop_count || 0) === 0 ? undefined : 'danger'

  return (
    <div
      id="day-summary-card"
      style={{
        background:    'var(--v2-bg-1, #1e293b)',
        border:        '1px solid var(--v2-line, #334155)',
        borderRadius:  14,
        padding:       16,
        marginBottom:  14,
        position:      'relative',
        scrollMarginTop: 80,
      }}
    >
      <button
        type="button"
        onClick={handleClose}
        aria-label="Dismiss day summary"
        style={{
          position:      'absolute',
          top:           10,
          right:         10,
          background:    'transparent',
          border:        'none',
          color:         'var(--v2-ink-2, #94a3b8)',
          cursor:        'pointer',
          padding:       4,
          borderRadius:  6,
        }}
      >
        <X size={16} strokeWidth={1.6} />
      </button>

      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            8,
          marginBottom:   10,
        }}
      >
        <Activity size={18} strokeWidth={1.6} color="var(--v2-yellow, #FFE600)" />
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.2 }}>
          Today&rsquo;s day summary
        </div>
      </div>

      {loading && !data ? (
        <div style={{ padding: 12, color: 'var(--v2-ink-2, #94a3b8)', fontSize: 13 }}>
          Loading today&rsquo;s activity…
        </div>
      ) : (
        <>
          {/* PLAN vs ACTUAL */}
          <div
            style={{
              fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
              color: 'var(--v2-ink-2, #94a3b8)', textTransform: 'uppercase',
              margin: '4px 0 4px',
            }}
          >
            Plan vs actual
          </div>
          {!isTC && (
            <Row
              icon={<ClipboardList size={14} strokeWidth={1.6} />}
              label="Meetings"
              value={`${a.meetings || 0}/${p.meetings || 0}`}
              tone={meetingsTone}
            />
          )}
          <Row
            icon={<Phone size={14} strokeWidth={1.6} />}
            label="Calls"
            value={`${a.calls || 0}/${p.calls || 0}`}
            tone={callsTone}
          />
          <Row
            icon={<Users size={14} strokeWidth={1.6} />}
            label="New leads"
            value={`${a.leads || 0}/${p.leads || 0}`}
            tone={leadsTone}
          />
          <Row
            icon={<BadgeCheck size={14} strokeWidth={1.6} />}
            label="Follow-ups"
            value={`${a.follow_ups_done || 0}/${a.follow_ups_total || 0}`}
          />
          {isTC && (
            <Row
              icon={<BadgeCheck size={14} strokeWidth={1.6} />}
              label="Qualified"
              value={a.qualified || 0}
            />
          )}
          <Row
            icon={<ChevronRight size={14} strokeWidth={1.6} />}
            label="Quotes sent"
            value={a.quotes_sent || 0}
          />

          {/* ACTIVITY */}
          <div
            style={{
              fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
              color: 'var(--v2-ink-2, #94a3b8)', textTransform: 'uppercase',
              margin: '12px 0 4px',
            }}
          >
            Activity
          </div>
          {!isTC && (
            <Row
              icon={<MapIcon size={14} strokeWidth={1.6} />}
              label="Site visits"
              value={a.site_visits || 0}
            />
          )}
          <Row
            icon={<Send size={14} strokeWidth={1.6} />}
            label="WhatsApp sent"
            value={a.whatsapp_sent || 0}
          />
          <Row
            icon={<Mic size={14} strokeWidth={1.6} />}
            label="Voice notes"
            value={a.voice_notes || 0}
          />
          <Row
            icon={<BadgeCheck size={14} strokeWidth={1.6} />}
            label="Quotes won"
            value={a.quotes_won || 0}
            tone={(a.quotes_won || 0) > 0 ? 'success' : undefined}
          />

          {/* TRACKING */}
          <div
            style={{
              fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
              color: 'var(--v2-ink-2, #94a3b8)', textTransform: 'uppercase',
              margin: '12px 0 4px',
            }}
          >
            Tracking integrity
          </div>
          <Row
            icon={<Satellite size={14} strokeWidth={1.6} />}
            label="GPS uptime"
            value={fmt(t.gps_uptime_seconds)}
          />
          <Row
            icon={<AlertTriangle size={14} strokeWidth={1.6} />}
            label="GPS turned off"
            value={`${t.gps_off_count || 0} times${t.gps_off_count > 0 ? ` · ${fmt(t.gps_off_duration_seconds)}` : ''}`}
            tone={gpsOffTone}
          />
          <Row
            icon={(t.network_off_count || 0) > 0 ? <WifiOff size={14} strokeWidth={1.6} /> : <Wifi size={14} strokeWidth={1.6} />}
            label="Internet lost"
            value={`${t.network_off_count || 0} times${t.network_off_count > 0 ? ` · ${fmt(t.network_off_duration_seconds)}` : ''}`}
            tone={netOffTone}
          />
          {(t.force_stop_count || 0) > 0 && (
            <Row
              icon={<AlertTriangle size={14} strokeWidth={1.6} />}
              label="App force-stopped"
              value={`${t.force_stop_count} times`}
              tone={fsTone}
            />
          )}
          {t.km_traveled != null && (
            <Row
              icon={<MapIcon size={14} strokeWidth={1.6} />}
              label="KM traveled"
              value={`${Number(t.km_traveled).toFixed(1)} km`}
            />
          )}

          {/* Phase 91a — Tomorrow preview. Exception-rendered: only
              shows when at least one of (follow-ups due tomorrow,
              planned meetings drafted for tomorrow) is non-zero. Lets
              the rep see their next-day load before sleeping without
              opening /follow-ups or scrolling /leads. */}
          {data?.tomorrow && (data.tomorrow.followUps > 0 || data.tomorrow.meetings > 0) && (
            <>
              <div
                style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
                  color: 'var(--v2-ink-2, #94a3b8)', textTransform: 'uppercase',
                  margin: '12px 0 4px',
                }}
              >
                Tomorrow
              </div>
              {data.tomorrow.followUps > 0 && (
                <Row
                  icon={<BadgeCheck size={14} strokeWidth={1.6} />}
                  label="Follow-ups due"
                  value={data.tomorrow.followUps}
                />
              )}
              {data.tomorrow.meetings > 0 && (
                <Row
                  icon={<Calendar size={14} strokeWidth={1.6} />}
                  label="Planned meetings"
                  value={data.tomorrow.meetings}
                />
              )}
            </>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={handleShare}
            disabled={sending}
            style={{
              marginTop:    14,
              width:        '100%',
              display:      'inline-flex',
              alignItems:   'center',
              justifyContent: 'center',
              gap:          8,
              padding:      '12px 16px',
              background:   'var(--v2-yellow, #FFE600)',
              color:        'var(--accent-fg, #0f172a)',
              fontWeight:   700,
              fontSize:     14,
              border:       'none',
              borderRadius: 10,
              cursor:       sending ? 'wait' : 'pointer',
              opacity:      sending ? 0.7 : 1,
            }}
          >
            <Send size={16} strokeWidth={1.6} />
            {sending ? 'Opening WhatsApp…' : 'Share to your group'}
          </button>
          {data?.sentAt && (
            <div
              style={{
                marginTop: 6,
                fontSize:  11,
                color:     'var(--v2-ink-2, #94a3b8)',
                textAlign: 'center',
              }}
            >
              Last shared {new Date(data.sentAt).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
              })} IST
            </div>
          )}

          {/* Phase 90.4 — Check Out CTA below Share. Only shows when
              parent flagged the rep as still checked-in (checkedOut
              prop false) AND wired the onCheckOut handler. Hidden
              once stamped so the same card serves as a "day done"
              confirmation. Ghost styling so it doesn't compete
              with Share for visual weight. */}
          {onCheckOut && !checkedOut && (
            <>
              <button
                type="button"
                onClick={() => onCheckOut('manual')}
                disabled={checkOutBusy}
                style={{
                  marginTop:    10,
                  width:        '100%',
                  display:      'inline-flex',
                  alignItems:   'center',
                  justifyContent: 'center',
                  gap:          8,
                  padding:      '11px 16px',
                  background:   'transparent',
                  color:        'var(--v2-ink-0, var(--text))',
                  fontWeight:   600,
                  fontSize:     13.5,
                  border:       '1px solid var(--v2-line, var(--border))',
                  borderRadius: 10,
                  cursor:       checkOutBusy ? 'wait' : 'pointer',
                  opacity:      checkOutBusy ? 0.7 : 1,
                  fontFamily:   'inherit',
                }}
              >
                <LogOut size={16} strokeWidth={1.6} />
                {checkOutBusy ? 'Capturing GPS…' : 'Check out — end day'}
              </button>
              <div style={{
                marginTop: 4, fontSize: 10.5,
                color: 'var(--v2-ink-2, var(--text-subtle))', textAlign: 'center',
              }}>
                Stamps your end-of-day GPS + closes the work session.
              </div>
            </>
          )}
          {checkedOut && (
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: 'var(--success-soft, rgba(16,185,129,0.10))',
              border: '1px solid var(--success, #10B981)',
              borderRadius: 10,
              fontSize: 12, color: 'var(--success, #10B981)',
              textAlign: 'center', fontWeight: 600,
            }}>
              Checked out · day closed
            </div>
          )}
        </>
      )}
    </div>
  )
}
