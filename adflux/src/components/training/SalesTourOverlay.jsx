// SalesTourOverlay — a guided "tap here → next → next" walkthrough that runs
// ON the real app. It navigates the rep's real routes (/work, /leads,
// /follow-ups, /quotes, /my-performance, /my-offer), shows a coaching card,
// and spotlights the real button on screen. Nothing is redrawn — it IS the app.
//
// SAFETY (§45): this renders NULL unless a tour is active (?tour=sales in the
// URL, or the sessionStorage flag set while a tour is running). So for every
// normal rep on every normal page it is completely inert — no UI, no cost.
// The ONLY frozen-file touch is a single mount line in V2AppShell.
//
// Design: uses the --v2-* shell tokens + --v2-r radii + Lucide icons to match
// the sibling shell overlays (Toast / ConfirmDialog / AppUpdateBanner). z-index
// 1000 (the §29 FilterDrawer tier) so the app's own modals (9000) still win.
//
// v1 scope: SALES track. TC + ops tracks reuse this component with their own
// STEPS once sales is approved. Completion is remembered per-device
// (localStorage); a DB "who finished" record is the next small step.

import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check, X, GraduationCap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

const TRACK = 'sales'

// Each step walks a real, stable route + coaches what to do there.
// `find` = text on a real button/link to spotlight (best-effort; if the
// element isn't found the card still shows — never breaks).
const STEPS = [
  {
    route: '/work',
    title: 'This is your day',
    body: 'Everything for today lives here — your plan, your meetings and your reminders. Each morning you check in, then tap Start My Day.',
    find: 'Start My Day',
  },
  {
    route: '/work',
    title: 'Your target & your pay',
    body: 'The purple card is your incentive. The green ring shows meetings done vs your daily target. Close deals and both climb — live.',
    find: 'Proposed Incentive',
  },
  {
    route: '/leads',
    title: 'Your leads land here',
    body: 'Every lead assigned to you shows in this list. Tap any lead to open it and start working it.',
    find: 'New Lead',
  },
  {
    route: '/leads',
    title: 'Call the lead',
    body: 'Open a lead and tap Call — your phone dials and the call is logged for you. No diary, no writing it down.',
    find: 'My Leads',
  },
  {
    route: '/follow-ups',
    title: 'Log the call, then chase',
    body: 'After a call you pick the outcome — Good / Maybe / Lost — and the next step. The app reminds you here so no deal is ever lost.',
    find: 'Follow',
  },
  {
    route: '/quotes',
    title: 'Send a quote',
    body: 'Build a quote and send the PDF straight on WhatsApp in a minute. The deal moves to Quote Sent, then Won when it closes.',
    find: 'Quotes',
  },
  {
    route: '/my-performance',
    title: 'Watch your score grow',
    body: 'Your monthly score, salary projection and incentive — all live, all month. Every meeting and deal builds it.',
    find: 'My Performance',
  },
  {
    route: '/my-offer',
    title: 'Your money',
    body: 'Salary, incentive, travel pay and your downloadable salary slip all live here. That is what the work adds up to.',
    find: 'Offer',
  },
]

const SS_ACTIVE = 'salesTourActive'
const SS_STEP = 'salesTourStep'
const SS_DISMISSED = 'salesTourDismissed'
const LS_DONE = 'salesTourDone'

function safeGet(store, key) {
  try { return window[store].getItem(key) } catch { return null }
}
function safeSet(store, key, val) {
  try { window[store].setItem(key, val) } catch { /* ignore */ }
}
function safeDel(store, key) {
  try { window[store].removeItem(key) } catch { /* ignore */ }
}

// Best-effort "who finished" record so the owner can see completions in the
// training_completions table (in addition to the per-device localStorage flag).
// One upsert on finish only — never on a hot path, never blocks the UI.
function recordCompletion() {
  try {
    const uid = useAuthStore.getState().profile?.id
    if (!uid) return
    supabase
      .from('training_completions')
      .upsert({ user_id: uid, track: TRACK }, { onConflict: 'user_id,track', ignoreDuplicates: true })
      .then(() => {}, () => {})
  } catch { /* ignore */ }
}

// Find the first visible element whose text contains `text` (case-insensitive).
function findByText(text) {
  if (!text) return null
  const t = text.toLowerCase()
  const nodes = document.querySelectorAll('button, a, [role="button"], summary')
  for (const el of nodes) {
    const label = (el.textContent || '').trim().toLowerCase()
    if (!label.includes(t)) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) return el
  }
  return null
}

export default function SalesTourOverlay() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const params = new URLSearchParams(location.search)
  const paramActive = params.get('tour') === TRACK
  const ssActive = safeGet('sessionStorage', SS_ACTIVE) === '1'
  const active = paramActive || ssActive

  const initStep = (() => {
    const p = parseInt(params.get('step') || safeGet('sessionStorage', SS_STEP) || '0', 10)
    return Number.isFinite(p) ? Math.max(0, Math.min(STEPS.length - 1, p)) : 0
  })()

  const [step, setStep] = useState(initStep)
  const [rect, setRect] = useState(null)
  const [done, setDone] = useState(false)

  // Arm the session flag the moment a tour starts (so it survives the rep
  // tapping a real element that navigates away without the query params).
  useEffect(() => {
    if (paramActive) {
      safeSet('sessionStorage', SS_ACTIVE, '1')
      safeSet('sessionStorage', SS_STEP, String(initStep))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramActive])

  const routeWithParams = useCallback((i) => `${STEPS[i].route}?tour=${TRACK}&step=${i}`, [])

  // On activation, make sure we're on the current step's route.
  useEffect(() => {
    if (!active || done) return
    const target = STEPS[step].route
    if (location.pathname !== target) navigate(routeWithParams(step))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, done])

  const go = useCallback((i) => {
    if (i >= STEPS.length) {
      safeSet('localStorage', LS_DONE, '1')
      safeDel('sessionStorage', SS_ACTIVE)
      safeDel('sessionStorage', SS_STEP)
      setDone(true)
      recordCompletion()
      return
    }
    const clamped = Math.max(0, Math.min(STEPS.length - 1, i))
    setStep(clamped)
    safeSet('sessionStorage', SS_STEP, String(clamped))
    navigate(routeWithParams(clamped))
  }, [navigate, routeWithParams])

  const exit = useCallback(() => {
    safeDel('sessionStorage', SS_ACTIVE)
    safeDel('sessionStorage', SS_STEP)
    // Skipping hides the launch pill for the rest of this session (a gentle
    // nudge that returns next session unless they actually finish).
    safeSet('sessionStorage', SS_DISMISSED, '1')
    setDone(false)
    navigate(location.pathname, { replace: true })
  }, [navigate, location.pathname])

  // Spotlight: after the route settles, find + ring the target button.
  useEffect(() => {
    if (!active || done) { setRect(null); return }
    let alive = true
    const update = () => {
      if (!alive) return
      const el = findByText(STEPS[step].find)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      } else {
        setRect(null)
      }
    }
    const timers = [setTimeout(update, 200), setTimeout(update, 550), setTimeout(update, 1100)]
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      alive = false
      timers.forEach(clearTimeout)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, done, step, location.pathname])

  if (!active) {
    // Launch affordance (§45-safe): a sales rep who hasn't finished gets a
    // one-tap "Start training" pill on their home page — so they don't need
    // the ?tour=sales URL. Everyone else, every other page, after completion,
    // or after a same-session skip → inert (null), exactly as before.
    const alreadyDone = safeGet('localStorage', LS_DONE) === '1'
    const dismissed = safeGet('sessionStorage', SS_DISMISSED) === '1'
    const showLaunch = !alreadyDone && !dismissed &&
      profile?.role === 'sales' && location.pathname === '/work'
    if (!showLaunch) return null
    return (
      <div style={launchWrap}>
        <button style={launchBtn} onClick={() => navigate(routeWithParams(0))} aria-label="Start training">
          <GraduationCap size={16} strokeWidth={2} /> Start training
        </button>
      </div>
    )
  }

  const S = STEPS[step]

  if (done) {
    return (
      <div style={overlayCardWrap}>
        <div style={card}>
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 18, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Check size={18} strokeWidth={2} color="var(--v2-green, #22c55e)" /> Training complete
          </div>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', lineHeight: 1.5, marginBottom: 14 }}>
            You’ve seen the whole flow — login to first paycheck. You can restart it any time from the training link.
          </div>
          <button style={btnPrimary} onClick={exit}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <>
      {rect && (
        <div style={{
          position: 'fixed',
          top: rect.top - 6, left: rect.left - 6,
          width: rect.width + 12, height: rect.height + 12,
          border: '2.5px solid var(--v2-yellow, #FFE600)',
          borderRadius: 'var(--v2-r, 14px)',
          boxShadow: '0 0 0 9999px rgba(2,6,23,0.55), 0 0 22px rgba(255,230,0,0.55)',
          pointerEvents: 'none',
          zIndex: 1000,
          transition: 'all .25s ease',
        }} />
      )}
      <div style={overlayCardWrap}>
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--v2-display)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--v2-yellow, #FFE600)', fontWeight: 700 }}>
              Training · Step {step + 1} of {STEPS.length}
            </span>
            <button style={linkBtn} onClick={exit} aria-label="Close training">
              Skip <X size={13} strokeWidth={2} />
            </button>
          </div>
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 17, marginBottom: 5 }}>{S.title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--v2-ink-2, #6a7590)', lineHeight: 1.5, marginBottom: 14 }}>{S.body}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnGhost} onClick={() => go(step - 1)} disabled={step === 0}>
              <ChevronLeft size={16} strokeWidth={2} /> Back
            </button>
            <button style={{ ...btnPrimary, flex: 1 }} onClick={() => go(step + 1)}>
              {step === STEPS.length - 1
                ? (<><Check size={16} strokeWidth={2} /> Finish</>)
                : (<>Next <ChevronRight size={16} strokeWidth={2} /></>)}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginTop: 12 }}>
            {STEPS.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 18 : 6, height: 6, borderRadius: 999,
                background: i === step ? 'var(--v2-yellow, #FFE600)' : (i < step ? 'var(--v2-green, #22c55e)' : 'var(--v2-line, #475569)'),
                transition: 'all .25s ease',
              }} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

const overlayCardWrap = {
  position: 'fixed',
  left: 0, right: 0, bottom: 0,
  padding: '0 12px calc(14px + env(safe-area-inset-bottom, 0px))',
  display: 'flex', justifyContent: 'center',
  zIndex: 1000,
  pointerEvents: 'none',
}
const card = {
  pointerEvents: 'auto',
  width: '100%', maxWidth: 440,
  background: 'var(--v2-bg-1, #111a2e)',
  border: '1px solid var(--v2-line, #1f2b47)',
  borderRadius: 'var(--v2-r-lg, 20px)',
  padding: '16px 16px 14px',
  boxShadow: '0 -8px 40px rgba(0,0,0,.5)',
  color: 'var(--v2-ink-0, #f5f7fb)',
  fontFamily: 'var(--v2-sans)',
}
const btnBase = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  borderRadius: 'var(--v2-r, 14px)', padding: '12px 16px',
  fontFamily: 'var(--v2-sans)', fontSize: 14, cursor: 'pointer',
}
const btnPrimary = {
  ...btnBase, border: 0,
  background: 'var(--v2-yellow, #FFE600)', color: 'var(--v2-yellow-ink, #0b1220)', fontWeight: 700,
}
const btnGhost = {
  ...btnBase,
  border: '1px solid var(--v2-line, #475569)', background: 'transparent',
  color: 'var(--v2-ink-0, #f5f7fb)', fontWeight: 600,
}
const linkBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  border: 0, background: 'transparent', color: 'var(--v2-ink-2, #6a7590)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 4,
}
const launchWrap = {
  position: 'fixed',
  right: 12,
  bottom: 'calc(74px + env(safe-area-inset-bottom, 0px))',
  zIndex: 1000,
  pointerEvents: 'none',
}
const launchBtn = {
  pointerEvents: 'auto',
  display: 'inline-flex', alignItems: 'center', gap: 6,
  border: 0, cursor: 'pointer',
  background: 'var(--v2-yellow, #FFE600)', color: 'var(--v2-yellow-ink, #0b1220)',
  fontFamily: 'var(--v2-sans)', fontWeight: 700, fontSize: 13,
  padding: '10px 15px', borderRadius: 'var(--v2-r-pill, 999px)',
  boxShadow: '0 8px 24px rgba(0,0,0,.4)',
}
