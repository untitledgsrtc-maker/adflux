// TrainingOverlay — a guided "tap here → next → next" walkthrough that runs ON
// the real app. It navigates the rep's real routes, shows a coaching card, and
// spotlights the real on-screen button. Nothing is redrawn — it IS the app.
//
// (The file is still named SalesTourOverlay.jsx so the V2AppShell mount import
//  — a §28-frozen line — needs no change. The component is now generic.)
//
// SAFETY (§45): renders NULL unless a track is active (?tour=<track> in the URL,
// or the sessionStorage flag armed while a tour runs) — so for every normal rep
// on every normal page it is completely inert. The launch pill is the only thing
// it draws when idle, and only for the matching role on that role's home page.
//
// TRACKS (one registry, §71 single source):
//   sales → /work        (English)   role 'sales'
//   tc    → /telecaller  (English)   role 'telecaller'
//   ops   → /ops-home    (Gujarati)  role 'operation_executive'  (§231 ops = gu)
// Completion → localStorage (per device) + a best-effort training_completions
// row (who finished, for the owner). Same table/RLS across all tracks.
//
// Design: --v2-* shell tokens + --v2-r radii + Lucide icons; z-index 1000 (the
// §29 FilterDrawer tier) so the app's own modals (9000) still win.

import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check, X, GraduationCap } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'

// Each step walks a real, static route + coaches what to do there.
// `find` = visible text of a real button/link to spotlight (best-effort; if the
// element isn't on screen the coaching card still shows — never breaks). '' = no ring.
const TRACKS = {
  sales: {
    role: 'sales', home: '/work', lang: 'en',
    steps: [
      { route: '/work', title: 'This is your day', body: 'Everything for today lives here — your plan, your meetings and your reminders. Each morning you check in, then tap Start My Day.', find: 'Start My Day' },
      { route: '/work', title: 'Your target & your pay', body: 'The purple card is your incentive. The green ring shows meetings done vs your daily target. Close deals and both climb — live.', find: 'Proposed Incentive' },
      { route: '/leads', title: 'Your leads land here', body: 'Every lead assigned to you shows in this list. Tap any lead to open it and start working it.', find: 'New Lead' },
      { route: '/leads', title: 'Call the lead', body: 'Open a lead and tap Call — your phone dials and the call is logged for you. No diary, no writing it down.', find: 'My Leads' },
      { route: '/follow-ups', title: 'Log the call, then chase', body: 'After a call you pick the outcome — Good / Maybe / Lost — and the next step. The app reminds you here so no deal is ever lost.', find: 'Follow' },
      { route: '/quotes', title: 'Send a quote', body: 'Build a quote and send the PDF straight on WhatsApp in a minute. The deal moves to Quote Sent, then Won when it closes.', find: 'Quotes' },
      { route: '/my-performance', title: 'Watch your score grow', body: 'Your monthly score, salary projection and incentive — all live, all month. Every meeting and deal builds it.', find: 'My Performance' },
      { route: '/my-offer', title: 'Your money', body: 'Salary, incentive, travel pay and your downloadable salary slip all live here. That is what the work adds up to.', find: 'Offer' },
    ],
  },
  tc: {
    role: 'telecaller', home: '/telecaller', lang: 'en',
    steps: [
      { route: '/telecaller', title: 'This is your call day', body: 'Every lead waiting for a call lines up here, hottest first. The top card is your next call — tap Call now to dial, then log what they said when you hang up.', find: 'Call now' },
      { route: '/telecaller', title: 'Reach them on WhatsApp', body: "Couldn't get them on the phone? Tap WhatsApp to send a message straight from the lead card.", find: 'WhatsApp' },
      { route: '/telecaller', title: 'Callbacks you promised', body: "Told someone you'd call them back? It's counted here. Tap this tile to open everyone due today so no promise slips.", find: 'Callbacks due' },
      { route: '/follow-ups', title: 'Your follow-ups', body: 'Every callback and follow-up you owe shows here — overdue first, then today and this week. Work them top to bottom each day.', find: '' },
      { route: '/leads', title: 'All your leads', body: 'Every lead assigned to you lives here. Tap any lead to open and work it, or add a fresh one with New Lead.', find: 'New Lead' },
      { route: '/quotes', title: 'Send a quote', body: 'When a lead is ready to buy, build their quote here. Tap New Quote to make and send it.', find: 'New Quote' },
      { route: '/my-performance', title: 'Track your score', body: 'Your calls, connect rate and daily score all sit here. Check it to see how your day is stacking up against your target.', find: '' },
      { route: '/my-offer', title: 'Your pay and claims', body: 'See your salary and incentive, and file expense claims here. Tap Request leave whenever you need a day off.', find: 'Request leave' },
    ],
  },
  ops: {
    role: 'operation_executive', home: '/ops-home', lang: 'gu',
    steps: [
      { route: '/ops-home', title: 'તમારું નેટવર્ક અહીં', body: 'તમારા બધા સ્ટેશન અને સ્ક્રીન એક નજરમાં — કેટલી ચાલુ, કેટલી બંધ, શું ધ્યાન માંગે છે. રોજ સવારે અહીંથી શરૂ કરો.', find: 'કુલ સ્ક્રીન' },
      { route: '/ops', title: 'દિવસ શરૂ કરો', body: 'કામ શરૂ કરતાં પહેલાં ચેક-ઇન કરો. તમારું લોકેશન નોંધાય છે અને ટ્રાવેલ કિમી ગણાય છે.', find: 'હાજરી પુરો (ચેક-ઇન)' },
      { route: '/ops-log', title: 'ખરાબી નોંધાવો', body: 'કોઈ સ્ક્રીન બગડે તો અહીં નોંધો: શહેર પસંદ કરો → સ્ક્રીન → શું ખરાબ છે → ફોટો → સાચવો. બસ.', find: '' },
      { route: '/ops-tickets', title: 'તમારી ખરાબી', body: "તમારી બધી ખરાબી અહીં — ખુલ્લી, ચાલુ અને સુધારેલી. ખુલ્લી ટૅપ કરો, સંપર્કને ફોન કરો, અને પૂરું થાય ત્યારે 'સુધારાયું' કરો.", find: 'ખુલ્લા' },
      { route: '/ops-station', title: 'સ્ટેશન બોર્ડ', body: 'કોઈ પણ સ્ટેશનની બધી સ્ક્રીન એક નજરમાં — લીલી ચાલુ, લાલ બંધ — સાથે કોને ફોન કરવો. અહીંથી ખરાબી પણ નોંધાવી શકાય.', find: 'Log fault' },
      { route: '/ops-performance', title: 'તમારું પરફોર્મન્સ', body: 'આ મહિને તમારી સ્ક્રીન કેટલી ચાલુ રહી, તમારો પગાર, સુધારેલી ખરાબી અને ફોન — બધું અહીં. વધુ અપટાઇમ = વધુ પગાર.', find: '' },
    ],
  },
}

// Chrome labels per language (ops = Gujarati, §231).
const L = {
  en: {
    training: 'Training', step: 'Step', of: 'of', skip: 'Skip', back: 'Back',
    next: 'Next', finish: 'Finish', doneTitle: 'Training complete',
    doneBody: 'You’ve seen the whole flow. You can start it again any time from the training button.',
    doneBtn: 'Done', launch: 'Start training',
  },
  gu: {
    training: 'તાલીમ', step: 'સ્ટેપ', of: '/', skip: 'છોડો', back: 'પાછળ',
    next: 'આગળ', finish: 'પૂરું', doneTitle: 'તાલીમ પૂરી',
    doneBody: 'તમે આખો ફ્લો જોઈ લીધો. તાલીમ બટનથી ગમે ત્યારે ફરી શરૂ કરી શકો.',
    doneBtn: 'થઈ ગયું', launch: 'તાલીમ શરૂ કરો',
  },
}

const SS_ACTIVE = 'tourActive'
const SS_STEP = 'tourStep'
const SS_TRACK = 'tourTrack'
const lsDone = (tr) => `tourDone_${tr}`
const ssDismissed = (tr) => `tourDismissed_${tr}`

function safeGet(store, key) {
  try { return window[store].getItem(key) } catch { return null }
}
function safeSet(store, key, val) {
  try { window[store].setItem(key, val) } catch { /* ignore */ }
}
function safeDel(store, key) {
  try { window[store].removeItem(key) } catch { /* ignore */ }
}

function clampStep(n, tr) {
  const len = (tr && TRACKS[tr]) ? TRACKS[tr].steps.length : 0
  if (!len) return 0
  return Math.max(0, Math.min(len - 1, Number.isFinite(n) ? n : 0))
}

// Best-effort "who finished" record so the owner can see completions in the
// training_completions table (in addition to the per-device localStorage flag).
// One upsert on finish only — never on a hot path, never blocks the UI.
function recordCompletion(track) {
  try {
    const uid = useAuthStore.getState().profile?.id
    if (!uid) return
    supabase
      .from('training_completions')
      .upsert({ user_id: uid, track }, { onConflict: 'user_id,track', ignoreDuplicates: true })
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

export default function TrainingOverlay() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)

  const params = new URLSearchParams(location.search)
  const paramTrack = params.get('tour')
  const paramValid = paramTrack && TRACKS[paramTrack]
  const ssActive = safeGet('sessionStorage', SS_ACTIVE) === '1'
  const ssTrack = safeGet('sessionStorage', SS_TRACK)
  const track = paramValid ? paramTrack
    : (ssActive && ssTrack && TRACKS[ssTrack]) ? ssTrack
      : null
  const active = !!track
  const steps = track ? TRACKS[track].steps : []
  const t = L[track ? TRACKS[track].lang : 'en']

  // step is DERIVED from the URL (when the tour drives) or the session backup
  // (when the rep taps a real app button and the ?tour params fall off the URL).
  // No useState → no stale-step race when the launch pill fires on an already-
  // mounted component.
  const rawStep = paramValid ? params.get('step')
    : (active ? safeGet('sessionStorage', SS_STEP) : null)
  const step = clampStep(parseInt(rawStep ?? '', 10), track)

  const [rect, setRect] = useState(null)
  const [done, setDone] = useState(false)

  const routeWith = useCallback((tr, i) => `${TRACKS[tr].steps[i].route}?tour=${tr}&step=${i}`, [])

  // Arm the session the moment a track starts via the URL (so it survives the
  // rep tapping a real element that navigates away without the query params).
  useEffect(() => {
    if (!paramValid) return
    const n = clampStep(parseInt(params.get('step') ?? '', 10), paramTrack)
    safeSet('sessionStorage', SS_ACTIVE, '1')
    safeSet('sessionStorage', SS_TRACK, paramTrack)
    safeSet('sessionStorage', SS_STEP, String(n))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTrack])

  // On activation / track switch, make sure we're on the current step's route.
  // Deps intentionally exclude step + pathname so tapping a real app button
  // mid-tour lets the rep roam without being yanked back.
  useEffect(() => {
    if (!active || done) return
    const target = steps[step]?.route
    if (target && location.pathname !== target) navigate(routeWith(track, step))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, done, track])

  const go = useCallback((i) => {
    if (!track) return
    if (i >= TRACKS[track].steps.length) {
      safeSet('localStorage', lsDone(track), '1')
      safeDel('sessionStorage', SS_ACTIVE)
      safeDel('sessionStorage', SS_STEP)
      safeDel('sessionStorage', SS_TRACK)
      setDone(true)
      recordCompletion(track)
      return
    }
    const clamped = clampStep(i, track)
    safeSet('sessionStorage', SS_STEP, String(clamped))
    navigate(routeWith(track, clamped))
  }, [navigate, routeWith, track])

  const exit = useCallback(() => {
    safeDel('sessionStorage', SS_ACTIVE)
    safeDel('sessionStorage', SS_STEP)
    safeDel('sessionStorage', SS_TRACK)
    // Skipping hides this track's launch pill for the rest of the session (a
    // gentle nudge that returns next session unless they actually finish).
    if (track) safeSet('sessionStorage', ssDismissed(track), '1')
    setDone(false)
    navigate(location.pathname, { replace: true })
  }, [navigate, location.pathname, track])

  // Spotlight: after the route settles, find + ring the target button.
  useEffect(() => {
    if (!active || done) { setRect(null); return }
    let alive = true
    const update = () => {
      if (!alive) return
      const el = findByText(steps[step]?.find)
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
    // Launch affordance (§45-safe): a rep who hasn't finished gets a one-tap
    // "Start training" pill on their role's home page — so they don't need the
    // ?tour= URL. Everyone else, every other page, after completion, or after a
    // same-session skip → inert (null).
    const role = profile?.role
    const pillTrack = Object.keys(TRACKS).find(
      (k) => TRACKS[k].role === role && TRACKS[k].home === location.pathname
    )
    if (!pillTrack) return null
    const doneLS = safeGet('localStorage', lsDone(pillTrack)) === '1'
    const dismissed = safeGet('sessionStorage', ssDismissed(pillTrack)) === '1'
    if (doneLS || dismissed) return null
    const pl = L[TRACKS[pillTrack].lang]
    return (
      <div style={launchWrap}>
        <button style={launchBtn} onClick={() => navigate(routeWith(pillTrack, 0))} aria-label={pl.launch}>
          <GraduationCap size={16} strokeWidth={2} /> {pl.launch}
        </button>
      </div>
    )
  }

  const S = steps[step]

  if (done) {
    return (
      <div style={overlayCardWrap}>
        <div style={card}>
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 18, marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Check size={18} strokeWidth={2} color="var(--v2-green, #22c55e)" /> {t.doneTitle}
          </div>
          <div style={{ fontSize: 13, color: 'var(--v2-ink-2, #6a7590)', lineHeight: 1.5, marginBottom: 14 }}>
            {t.doneBody}
          </div>
          <button style={btnPrimary} onClick={exit}>{t.doneBtn}</button>
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
              {t.training} · {t.step} {step + 1} {t.of} {steps.length}
            </span>
            <button style={linkBtn} onClick={exit} aria-label={t.skip}>
              {t.skip} <X size={13} strokeWidth={2} />
            </button>
          </div>
          <div style={{ fontFamily: 'var(--v2-display)', fontWeight: 700, fontSize: 17, marginBottom: 5 }}>{S.title}</div>
          <div style={{ fontSize: 13.5, color: 'var(--v2-ink-2, #6a7590)', lineHeight: 1.5, marginBottom: 14 }}>{S.body}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnGhost} onClick={() => go(step - 1)} disabled={step === 0}>
              <ChevronLeft size={16} strokeWidth={2} /> {t.back}
            </button>
            <button style={{ ...btnPrimary, flex: 1 }} onClick={() => go(step + 1)}>
              {step === steps.length - 1
                ? (<><Check size={16} strokeWidth={2} /> {t.finish}</>)
                : (<>{t.next} <ChevronRight size={16} strokeWidth={2} /></>)}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginTop: 12 }}>
            {steps.map((_, i) => (
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
