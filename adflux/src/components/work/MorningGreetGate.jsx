import { useState, useEffect, useRef, useCallback } from 'react'
import { Sunrise, MessageCircle, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { openWhatsApp } from '../../utils/whatsapp'
import { istTodayISO } from '../../utils/istDate'

// Phase 314 — message-first check-in gate. A mapped field rep must greet the
// WhatsApp assistant (95 815 78261) before starting the day. Greeting opens the
// 24h WhatsApp window so the P3 every-2h pending nudge can reach them (§197/§198).
//
// Design (owner, 2026-08-17): "when they open the app for check-in, first they
// message." A blocking overlay — but with a safety valve so a WhatsApp/signal
// failure NEVER locks a rep out of starting work.
//
// SAFE-BY-DESIGN:
//  • FAIL-OPEN — if the assistant_greeted_today RPC errors, the gate does NOT
//    show. A backend hiccup can never block check-in. Deploy-before-SQL safe (§45).
//    A transient blip retries (up to ERR_CAP) so a recovered connection can still
//    surface the gate; a persistent failure gives up fail-open (bounds the poll).
//  • MAPPED reps only — an UNMAPPED user messaging the 95 number would hit the
//    customer flow (lead + customer AI), so we never prompt them. The mapped test
//    matches the webhook's last-10-digit expectation, so a MALFORMED whatsapp_number
//    (whitespace / too short) also doesn't prompt.
//  • Field roles only (sales / telecaller / agency). Admin / co_owner / hr /
//    accounts don't check in and never see it.
//  • Self-hides once greeted today (per-IST-day), or once the valve is used
//    (per-IST-day, localStorage) — prompts once each morning, not all day.

const ASSISTANT_WA = '9581578261'           // 95 815 78261 → +91 = 919581578261
const GREET_TEXT = 'Good morning'
const POLL_MS = 4000                        // re-check while the gate is open
const VALVE_AFTER_SEND_MS = 20000           // escape after they tried + it didn't register
const VALVE_HARD_MS = 60000                 // ultimate escape (WhatsApp won't even open)
const ERR_CAP = 4                           // give up fail-open after N consecutive RPC errors
const FIELD_ROLES = ['sales', 'telecaller', 'agency']

export default function MorningGreetGate({ enabled = true }) {
  const profile = useAuthStore(s => s.profile)

  const isRep = FIELD_ROLES.includes(profile?.role)
  // Match the webhook's last-10-digit expectation — a malformed/garbage number
  // must NOT be treated as mapped (else we'd prompt a rep whose greeting won't
  // match → customer flow).
  const mapped = String(profile?.whatsapp_number || '').replace(/\D/g, '').length >= 10
  const active = enabled && isRep && mapped

  const bypassKey = profile?.id ? `greetGateBypass:${profile.id}:${istTodayISO()}` : null
  const [bypassed, setBypassed] = useState(false)
  const [greeted, setGreeted] = useState(null)   // null = unknown (no flash), true/false
  const [sent, setSent] = useState(false)        // tapped "Say good morning"
  const [showValve, setShowValve] = useState(false)

  const mountedRef = useRef(true)
  const errRef = useRef(0)
  const sendTimerRef = useRef(null)
  useEffect(() => () => {
    mountedRef.current = false
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
  }, [])

  // Read the per-day bypass once we know who the user is.
  useEffect(() => {
    if (!bypassKey) return
    try { setBypassed(localStorage.getItem(bypassKey) === '1') } catch { /* ignore */ }
  }, [bypassKey])

  const check = useCallback(async () => {
    if (!active) return
    try {
      const { data, error } = await supabase.rpc('assistant_greeted_today')
      if (!mountedRef.current) return
      if (error) {
        // FAIL-OPEN, but don't latch on a transient blip — keep greeted at its
        // current value (gate stays hidden while unknown) and let the poll retry.
        // Give up fail-open only after a run of errors, to bound the poll.
        errRef.current += 1
        if (errRef.current >= ERR_CAP) setGreeted(true)
        return
      }
      errRef.current = 0
      setGreeted(data === true)
    } catch {
      if (!mountedRef.current) return
      errRef.current += 1
      if (errRef.current >= ERR_CAP) setGreeted(true)   // FAIL-OPEN (bounded)
    }
  }, [active])

  // Poll while the gate is (or may be) open + re-check the moment the rep returns
  // from WhatsApp. Stops once greeted / bypassed / not active.
  const doneRef = useRef(false)
  doneRef.current = !active || bypassed || greeted === true
  useEffect(() => {
    if (!active || bypassed) return
    check()
    const iv = setInterval(() => { if (!doneRef.current) check() }, POLL_MS)
    const onVis = () => { if (!doneRef.current && document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [active, bypassed, check])

  // Ultimate safety valve — even if WhatsApp never opens, the rep escapes after a
  // minute so they're never stranded from starting work.
  useEffect(() => {
    if (!active || bypassed) return
    const t = setTimeout(() => { if (mountedRef.current) setShowValve(true) }, VALVE_HARD_MS)
    return () => clearTimeout(t)
  }, [active, bypassed])

  function sayGoodMorning() {
    openWhatsApp(ASSISTANT_WA, GREET_TEXT)
    setSent(true)
    // Reveal the "start anyway" escape if their message doesn't register shortly
    // (they tried, but WhatsApp/signal failed to deliver).
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current)
    sendTimerRef.current = setTimeout(() => { if (mountedRef.current) setShowValve(true) }, VALVE_AFTER_SEND_MS)
  }

  function skip() {
    try { if (bypassKey) localStorage.setItem(bypassKey, '1') } catch { /* ignore */ }
    setBypassed(true)
  }

  if (!active || bypassed || greeted !== false) return null

  return (
    <div className="lead-modal-back" style={{ zIndex: 9000 }}>
      <div className="lead-modal" style={{ maxWidth: 380, textAlign: 'center' }}>
        <div className="lead-modal-body" style={{ padding: '28px 22px 22px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 999, margin: '0 auto 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-soft, rgba(255,230,0,0.14))',
            color: 'var(--v2-yellow, #FFE600)',
          }}>
            <Sunrise size={22} strokeWidth={1.6} />
          </div>

          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--v2-ink-0, #f5f7fb)' }}>
            Good morning!
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 8, color: 'var(--v2-ink-1, #a9b3c7)' }}>
            Say good morning to your assistant to start the day — it sends back your
            plan, and keeps your reminders coming through the day.
          </div>

          <button
            onClick={sayGoodMorning}
            style={{
              marginTop: 18, width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '13px 16px', borderRadius: 'var(--v2-r-sm, 10px)', border: 'none', cursor: 'pointer',
              fontSize: 15, fontWeight: 700,
              background: 'var(--v2-yellow, #FFE600)', color: 'var(--v2-yellow-ink, #0b1220)',
            }}
          >
            <MessageCircle size={18} strokeWidth={1.6} />
            Say good morning
          </button>

          {sent && (
            <div style={{
              marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 13, color: 'var(--v2-ink-2, #6a7590)',
            }}>
              <Loader2 size={14} strokeWidth={1.6} style={{ animation: 'spin 1s linear infinite' }} />
              Waiting for your message…
            </div>
          )}

          {showValve && (
            <button
              onClick={skip}
              style={{
                marginTop: 16, background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', textDecoration: 'underline',
              }}
            >
              Start my day without it
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
