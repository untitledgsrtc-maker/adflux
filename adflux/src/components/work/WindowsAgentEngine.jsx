// Phase 384 - Windows agent engine, running INSIDE the website page shown by the Windows program.
// Records ONLY while a timer runs AND the person is switched on (Team Work -> Activity) AND consent is accepted:
// program + window title + idle seconds per minute, a screenshot every N minutes, and the "Still working?" question.
// Talks to the database only through work_agent_* / work_clock_stop (same functions as step 1, phase 381).
import { useEffect, useRef, useState } from 'react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'

const VERSION = '0.2.8'
const QKEY = 'agent_slice_queue'
const T = () => window.__TAURI_INTERNALS__
const invoke = (cmd, args) => T().invoke(cmd, args)
const emit = (event, payload) => invoke('plugin:event|emit', { event, payload }).catch(() => {})
const listen = (event, cb) => {
  try {
    const handler = T().transformCallback((e) => cb(e?.payload))
    invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler }).catch(() => {})
  } catch { /* ignore */ }
}
const timeIST = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]') } catch { return [] } }
const saveQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-2000))) } catch { /* full */ } }

export default function WindowsAgentEngine() {
  const profile = useAuthStore((s) => s.profile)
  const uid = profile?.id
  const [needConsent, setNeedConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [interval, setIntervalMin] = useState(10)
  const [claim, setClaim] = useState(null)   // 'I was working' request after the timer stopped: null | { text, busy, msg }
  const [stopped, setStopped] = useState(null)   // 'timer stopped' notice with a restart button
  const [ask, setAsk] = useState(null)          // idle question also shown inside this page (backup for the small window)
  const [reasonOpen, setReasonOpen] = useState(false)   // Phase 443: typed reason for "I was working"
  const [reasonText, setReasonText] = useState('')
  const [reasonErr, setReasonErr] = useState('')
  const [diag, setDiag] = useState(null)        // tiny status pill: idle seconds, recording, last error
  const S = useRef({
    device: 'Windows PC', config: null, running: null, projects: {}, buckets: new Map(),
    lastShot: 0, asking: null, askTimer: null, suppress: false, runId: null, ticking: false, lastTickAt: 0, lastSampleAt: 0, lastErr: '', idleNow: 0, sysIdle: null, injected: 0, answer: null, lastStopped: null,
  })

  useEffect(() => {
    if (!uid) return undefined
    const s = S.current
    let alive = true
    const recordOk = () => !!(s.config?.tracked && s.config?.consent_at)
    const clientName = (id) => s.projects[id] || ''

    async function loadAll() {
      try {
        const [cfg, run] = await Promise.all([
          supabase.rpc('work_agent_config', { p_device: s.device }),
          supabase.from('work_time_entries').select('*').eq('user_id', uid).is('ended_at', null).maybeSingle(),
        ])
        if (cfg.error || !alive) return
        s.config = cfg.data
        setIntervalMin(Number(cfg.data?.screenshot_interval_min || 10))
        setNeedConsent(!!(cfg.data?.tracked && !cfg.data?.consent_at))
        s.running = run.data || null
        if (s.running?.project_id && !s.projects[s.running.project_id]) {
          const p = await supabase.from('work_projects').select('id,name').eq('id', s.running.project_id).maybeSingle()
          if (p.data) s.projects[p.data.id] = p.data.name
        }
        const was = s.runId
        s.runId = s.running?.id || null
        if (s.runId && !was) { s.lastShot = Date.now(); invoke('show_window', { label: 'widget' }).catch(() => {}) }
        if (!s.runId && was) {
          invoke('hide_window', { label: 'widget' }).catch(() => {}); flushBuckets(true)
          // Phase 449: the SERVER can stop a timer too ("PC went quiet" - no activity for 20 min). Say so, with a restart button,
          // instead of leaving the person to find out later that the clock is off.
          try {
            const { data: last } = await supabase.from('work_time_entries').select('id,ended_at,auto_stopped,project_id,task_label,part_id').eq('id', was).maybeSingle()
            if (last?.auto_stopped && last.ended_at && !s.asking && !s.stoppedShown?.[last.id]) {
              s.stoppedShown = { ...(s.stoppedShown || {}), [last.id]: true }
              s.lastStopped = { project: last.project_id, label: last.task_label, part: last.part_id }
              const info = { stopIso: last.ended_at, stopAt: timeIST(last.ended_at), auto: true, client: clientName(last.project_id), label: last.task_label }
              setStopped(info)
              await emit('agent:idle-stopped', info)
              invoke('bring_to_front', { label: 'idle' }).catch(() => {})
            }
          } catch { /* best effort */ }
        }
      } catch { /* offline: keep last state */ }
    }

    const sample = (win, idle) => {
      if (!s.running) return
      const minute = Math.floor(Date.now() / 60000) * 60000
      const k = `${minute}|${win.program}|${win.title}`
      const b = s.buckets.get(k) || { minute, entry: s.running.id, program: win.program, title: win.title, active: 0, idle: 0 }
      // real elapsed time since the last sample (a hidden / busy window can tick late), not a fixed 5 s
      const now = Date.now()
      const dt = s.lastTickAt ? Math.min(65, Math.max(1, Math.round((now - s.lastTickAt) / 1000))) : 5
      if (idle >= 30) b.idle = Math.min(60, b.idle + dt); else b.active = Math.min(60, b.active + dt)
      s.buckets.set(k, b)
    }
    async function uploadQueue() {
      const q = loadQ()
      if (!q.length) return
      const batch = q.slice(0, 100)
      const { error } = await supabase.rpc('work_agent_push_activity', { p_slices: batch })
      if (!error) saveQ(q.slice(batch.length))
    }
    async function flushBuckets(all) {
      const nowMin = Math.floor(Date.now() / 60000) * 60000
      const q = loadQ()
      for (const [k, b] of [...s.buckets]) {
        if (all || b.minute < nowMin) {
          q.push({ entry: b.entry, start: new Date(b.minute).toISOString(), program: b.program, title: b.title, active: b.active, idle: b.idle })
          s.buckets.delete(k)
        }
      }
      saveQ(q)
      try { await uploadQueue() } catch { /* stays queued */ }
    }
    async function maybeScreenshot() {
      const every = Number(s.config?.screenshot_interval_min || 0)
      if (!every || !s.running || Date.now() - s.lastShot < every * 60000) return
      s.lastShot = Date.now()
      try {
        const b64 = await Promise.race([invoke('take_screenshot'), new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timed out')), 20000))])
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const takenAt = new Date().toISOString()
        const { data: path, error } = await supabase.rpc('work_agent_register_screenshot', { p_entry: s.running.id, p_taken_at: takenAt, p_bytes: bin.length })
        if (error) throw error
        const up = await supabase.storage.from('work-screenshots').upload(path, bin, { contentType: 'image/jpeg', upsert: true })
        if (up.error) throw up.error
      } catch { /* a screenshot taken offline is dropped */ }
    }
    async function answerIdle(decision, note) {
      const a = s.asking
      if (!a) return
      // Phase 443: "I was working" does NOT count by itself - ask for a typed reason first; it then goes to admin / a head for approval.
      if (decision === 'worked' && !note) {
        setReasonErr(''); setReasonOpen(true)
        invoke('hide_window', { label: 'idle' }).catch(() => {})
        invoke('show_window', { label: 'main' }).catch(() => {})
        invoke('bring_to_front', { label: 'main' }).catch(() => {})
        return
      }
      if (decision === 'worked') {
        const { error } = await supabase.rpc('work_agent_idle', { p_entry: a.entry, p_idle_began: a.began, p_decision: 'still_working', p_idle_seconds: Math.round((Date.now() - new Date(a.began).getTime()) / 1000), p_note: note })
        if (error) { setReasonErr(error.message || 'Could not send. Try again.'); await emit('agent:idle-error', { message: error.message || 'Could not send. Try again.' }); return }
        invoke('hide_window', { label: 'idle' }).catch(() => {})
        clearTimeout(s.askTimer); s.asking = null; setAsk(null); setReasonOpen(false); setReasonText(''); s.suppress = true
        window.dispatchEvent(new CustomEvent('wk-idle-freeze', { detail: null }))
        await loadAll()
        window.dispatchEvent(new Event('focus'))
        return
      }
      setReasonOpen(false)
      clearTimeout(s.askTimer); s.asking = null; setAsk(null)
      invoke('hide_window', { label: 'idle' }).catch(() => {})
      const idleSecs = Math.round((Date.now() - new Date(a.began).getTime()) / 1000)
      const run = s.running
      // Phase 406: the minutes she was away are NOT counted by default. RESUME (and the old "It was a break" button)
      // both send 'break'; only "I was working" ('worked') keeps the minutes. Old installers still send still_working.
      const serverDecision = decision === 'worked' ? 'still_working' : (decision === 'still_working' ? 'break' : decision)
      if (decision === 'still_working' || decision === 'worked' || decision === 'break') s.suppress = true
      window.dispatchEvent(new CustomEvent('wk-idle-freeze', { detail: null }))
      try { await supabase.rpc('work_agent_idle', { p_entry: a.entry, p_idle_began: a.began, p_decision: serverDecision, p_idle_seconds: idleSecs }) } catch { /* may be stopped */ }
      await loadAll()
      if ((decision === 'stop' || decision === 'auto_stopped') && run && !s.running) {
        // tell the person, on top of everything, that the timer is stopped and let them start it again
        s.lastStopped = { project: run.project_id, label: run.task_label, part: run.part_id }
        const info = { stopIso: new Date(a.began).toISOString(), stopAt: timeIST(a.began), auto: decision === 'auto_stopped', client: clientName(run.project_id), label: run.task_label }
        setStopped(info)
        await emit('agent:idle-stopped', info)
        invoke('bring_to_front', { label: 'idle' }).catch(() => {})
      }
      window.dispatchEvent(new Event('focus'))     // let the open page refresh its timer
    }
    async function maybeAskIdle(rawIdle) {
      const mins = Number(s.config?.idle_minutes || 0)
      if (!mins || !s.running) return
      // Phase 445: idle that began BEFORE this timer started is not idle time of this timer. Without this cap, starting a timer after a long
      // gap with no (real) keyboard/mouse input made "idle" already >= 5 min: the question opened at once and froze the clock at 00:00:00.
      const sinceStart = Math.max(0, (Date.now() - new Date(s.running.started_at).getTime()) / 1000)
      const idle = Math.min(rawIdle, sinceStart)
      if (idle < 60) s.suppress = false
      if (s.asking || s.suppress || idle < mins * 60) return
      const began = new Date(Date.now() - idle * 1000)
      s.asking = { began: began.toISOString(), entry: s.running.id }
      window.dispatchEvent(new CustomEvent('wk-idle-freeze', { detail: { began: began.toISOString() } }))
      const worked = Math.max(0, (began.getTime() - new Date(s.running.started_at).getTime()) / 1000 - (s.running.break_seconds || 0))
      const info = { minutes: mins, waitMin: 5, client: clientName(s.running.project_id) || s.running.task_label, label: s.running.task_label, worked, stopAt: timeIST(began.toISOString()) }
      setAsk(info)
      await emit('agent:idle-ask', info)
      invoke('bring_to_front', { label: 'idle' }).catch(() => { invoke('show_window', { label: 'idle' }).catch(() => {}) })
      invoke('show_window', { label: 'main' }).catch(() => {})
      s.askTimer = setTimeout(() => answerIdle('auto_stopped'), 5 * 60000)
    }
    async function tick() {
      // a call that never returned must not freeze recording for good
      if (s.ticking && Date.now() - (s.tickStart || 0) > 30000) s.ticking = false
      if (s.ticking || !s.running) return
      s.ticking = true; s.tickStart = Date.now()
      try {
        // idle = seconds since the last REAL keyboard / mouse use (hook); sys = Windows' own clock (also counts input that
        // other programs fake); injected = how many such fake events were seen. Old installers lack the last two.
        const [idle, win, sys, inj] = await Promise.all([
          invoke('idle_seconds'), invoke('active_window'),
          invoke('idle_system_seconds').catch(() => null), invoke('injected_input_count').catch(() => null),
        ])
        s.sysIdle = sys; s.injected = inj || 0
        s.lastSampleAt = Date.now(); s.lastErr = ''; s.idleNow = idle
        if (recordOk()) {
          sample(win, idle)
          await flushBuckets(false)
          await maybeScreenshot()
        }
        // Phase 436: the "Still working?" question is for EVERYONE with a running timer (it needs only the idle seconds);
        // programs / window titles / screenshots above stay for tracked people only.
        await maybeAskIdle(idle)
        s.lastTickAt = Date.now()
      } catch (e) { s.lastErr = String(e?.message || e) } finally { s.ticking = false }
    }
    function pushState() {
      if (!s.running) { emit('agent:state', { running: false }); invoke('set_tray_tooltip', { text: 'Untitled Work - not running' }).catch(() => {}); return }
      const upTo = s.asking ? new Date(s.asking.began).getTime() : Date.now()   // frozen while the question is open
      const secs = Math.max(0, (upTo - new Date(s.running.started_at).getTime()) / 1000 - (s.running.break_seconds || 0))
      emit('agent:state', { running: true, paused: !!s.asking, secs, client: clientName(s.running.project_id), label: s.running.task_label, recording: recordOk() && Date.now() - s.lastSampleAt < 30000, err: s.lastErr })
    }

    const restart = async () => {
      const L = s.lastStopped
      setStopped(null)
      invoke('hide_window', { label: 'idle' }).catch(() => {})
      if (!L) return
      try { await supabase.rpc('work_clock_start', { p_project: L.project || null, p_label: L.label || null, p_part: L.part || null }) } catch { /* shown by the page */ }
      await loadAll()
      window.dispatchEvent(new Event('focus'))
    }
    s.restart = restart
    s.answer = answerIdle
    listen('agent:cmd', async (p) => {
      if (p?.type === 'stop') { await supabase.rpc('work_clock_stop', {}); await loadAll(); window.dispatchEvent(new Event('focus')) }
      if (p?.type === 'open') invoke('show_window', { label: 'main' }).catch(() => {})
      if (p?.type === 'close-idle') { setStopped(null); invoke('hide_window', { label: 'idle' }).catch(() => {}) }
      if (p?.type === 'restart') await restart()
    })
    listen('agent:idle-answer', (p) => answerIdle(p?.decision || 'still_working', p?.note))

    ;(async () => {
      try { s.device = await invoke('device_name') } catch { /* keep default */ }
      try {
        // the REAL installed version of the Windows program (not this page's constant)
        const ver = await invoke('plugin:app|version')
        await supabase.rpc('work_agent_seen', { p_device: s.device, p_version: String(ver || VERSION) })
      } catch { /* not critical */ }
      try {
        if (!localStorage.getItem('agent_autostart_asked')) {
          localStorage.setItem('agent_autostart_asked', '1')
          if (!(await invoke('autostart_enabled'))) await invoke('set_autostart', { on: true })
        }
      } catch { /* not critical */ }
      await loadAll()
    })()

    const diagTimer = setInterval(() => {
      setDiag({ run: !!s.running, rec: recordOk() && Date.now() - s.lastSampleAt < 30000, idle: s.idleNow || 0, sys: s.sysIdle, inj: s.injected || 0, err: s.lastErr, asking: !!s.asking })
    }, 2000)
    const timers = [diagTimer, setInterval(tick, 5000), setInterval(pushState, 1000), setInterval(loadAll, 15000), setInterval(() => uploadQueue().catch(() => {}), 30000)]
    return () => { alive = false; timers.forEach(clearInterval) }
  }, [uid])

  // Phase 458: a task given to you shows a Windows notification on ANY page of the app (before, only My Work did, and
  // only if the browser had been allowed to notify - which it never asked for). Same tag as the My Work one so you get ONE.
  useEffect(() => {
    if (!uid) return undefined
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {}) } catch { /* ignore */ }
    const ch = supabase.channel(`agent-new-task-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'work_task_parts', filter: `assignee_id=eq.${uid}` }, async (ev) => {
        let title = 'A new task'
        try {
          const { data } = await supabase.from('work_tasks').select('title').eq('id', ev.new?.task_id).maybeSingle()
          if (data?.title) title = data.title
        } catch { /* generic */ }
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('New task for you', { body: title, tag: `wk-part-${ev.new?.id}` }) } catch { /* ignore */ }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'work_task_parts' }, async (ev) => {
        // someone declined a task I created -> tell me on this PC
        const n = ev.new || {}
        if (n.reject_kind !== 'declined' || !n.rejected_at || Date.now() - new Date(n.rejected_at).getTime() > 30000) return
        try {
          const { data } = await supabase.from('work_tasks').select('title,created_by').eq('id', n.task_id).maybeSingle()
          if (data?.created_by !== uid) return
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Task declined', { body: `${data.title}: ${n.reject_reason || ''}`, tag: `wk-dec-${n.id}` })
          window.dispatchEvent(new Event('focus'))
        } catch { /* ignore */ }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [uid])

  const accept = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('work_agent_consent', { p_device: S.current.device, p_version: VERSION })
    setBusy(false)
    if (!error) {
      S.current.config = { ...(S.current.config || {}), consent_at: new Date().toISOString() }
      setNeedConsent(false)
    }
  }

  const pill = diag && diag.run ? (
    <div className="wk" style={{ position: 'fixed', left: 12, bottom: 12, zIndex: 8999, pointerEvents: 'none' }}>
      <span className={`wk-pill ${diag.rec ? 'ok' : 'warn'}`} style={{ opacity: .9 }}>
        {diag.rec ? 'Recording' : (diag.err ? 'Cannot record' : 'Not recording')} · idle {Math.floor(diag.idle / 60)}:{String(diag.idle % 60).padStart(2, '0')}{diag.sys != null && Math.abs(diag.sys - diag.idle) > 20 ? ` (PC clock ${Math.floor(diag.sys / 60)}:${String(diag.sys % 60).padStart(2, '0')}, ${diag.inj} faked)` : ''}
      </span>
    </div>
  ) : null
  const stoppedNotice = stopped ? (
    <div className="wk" style={{ position: 'fixed', inset: 0, zIndex: 9001, background: 'rgba(7,11,22,.75)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="wk-card" style={{ maxWidth: 440, width: '100%', borderColor: 'var(--w-dat, #F87171)' }} role="dialog" aria-label="Timer stopped">
        <div className="wk-eyb" style={{ color: 'var(--w-dat, #F87171)' }}>Your timer is stopped</div>
        <div style={{ fontSize: 18, margin: '6px 0 4px' }}>Stopped at {stopped.stopAt}{stopped.auto ? ' because you were away' : ''}.</div>
        <div className="wk-sm" style={{ marginBottom: 12 }}>{stopped.client}{stopped.label ? ` - ${stopped.label}` : ''}. Time since then is not counted.</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="wk-btn y" onClick={() => S.current.restart?.()}>Start the timer again</button>
          {stopped.stopIso && !claim && <button className="wk-btn o" onClick={() => setClaim({ text: '', busy: false, msg: '' })}>I was still working - ask for these minutes</button>}
          {claim && (
            <div style={{ display: 'grid', gap: 8 }}>
              <textarea className="wk-input" rows={3} placeholder="What were you doing? (10 letters or more)" value={claim.text} onChange={(e) => setClaim({ ...claim, text: e.target.value })} aria-label="Reason" />
              {claim.msg && <div className="wk-sm" style={{ color: 'var(--w-dat, #F87171)' }}>{claim.msg}</div>}
              <button className="wk-btn y" disabled={claim.busy || claim.text.trim().length < 10} onClick={async () => {
                setClaim({ ...claim, busy: true, msg: '' })
                try {
                  const L = S.current.lastStopped || {}
                  const { error } = await supabase.rpc('work_add_manual_time', { p_project: L.project || null, p_label: L.label || null, p_start: stopped.stopIso, p_end: new Date().toISOString(), p_note: 'Said working after the timer stopped: ' + claim.text.trim() })
                  if (error) throw error
                  setClaim(null); setStopped(null); invoke('hide_window', { label: 'idle' }).catch(() => {})
                } catch (e) { setClaim((c) => ({ ...c, busy: false, msg: (e && e.message) || 'Could not send. Try again.' })) }
              }}>Send request to my head</button>
            </div>
          )}
          <button className="wk-btn o" onClick={() => { setClaim(null); setStopped(null) }}>Not now</button>
        </div>
      </div>
    </div>
  ) : null
  const reasonBox = reasonOpen && ask ? (
    <div className="wk" style={{ position: 'fixed', inset: 0, zIndex: 9002, background: 'rgba(7,11,22,.8)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="wk-card" style={{ maxWidth: 460, width: '100%', borderColor: 'var(--w-wat, #FBBF24)' }} role="dialog" aria-label="Why were you away?">
        <div className="wk-eyb">Away since {ask.stopAt}</div>
        <div style={{ fontSize: 18, margin: '6px 0 8px' }}>What were you doing?</div>
        <div className="wk-sm" style={{ marginBottom: 10 }}>These minutes are not counted yet. Your reason goes to admin / HR, and the minutes count only if they approve.</div>
        <textarea className="wk-input" style={{ height: 96, padding: 10 }} value={reasonText} maxLength={300} autoFocus aria-label="Reason"
          placeholder="For example: checking the printed file with the client" onChange={(e) => { setReasonText(e.target.value); setReasonErr('') }} />
        {reasonErr && <div className="wk-sm" style={{ color: 'var(--w-dat, #F87171)', marginTop: 6 }} role="alert">{reasonErr}</div>}
        <div className="wk-row" style={{ marginTop: 12 }}>
          <button className="wk-btn o" onClick={() => { setReasonOpen(false); setReasonErr('') }}>Back</button>
          <button className="wk-btn y" disabled={reasonText.trim().length < 10} onClick={() => S.current.answer?.('worked', reasonText.trim())}>Send for approval</button>
        </div>
        {reasonText.trim().length < 10 && <div className="wk-sm" style={{ marginTop: 6 }}>Write at least 10 letters.</div>}
      </div>
    </div>
  ) : null
  const question = ask ? (
    <div className="wk" style={{ position: 'fixed', inset: 0, zIndex: 9001, background: 'rgba(7,11,22,.75)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="wk-card" style={{ maxWidth: 440, width: '100%', borderColor: 'var(--w-wat, #FBBF24)' }} role="dialog" aria-label="Still working?">
        <div className="wk-eyb">No activity for {ask.minutes} min</div>
        <div style={{ fontSize: 18, margin: '6px 0 12px' }}>Still working on {ask.client || 'your task'}?</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="wk-btn y" onClick={() => S.current.answer?.('still_working')}>Resume - I am here</button>
          <button className="wk-btn o" onClick={() => S.current.answer?.('worked')}>I was working (write the reason)</button>
          <button className="wk-btn o" onClick={() => S.current.answer?.('stop')}>Stop timer</button>
        </div>
        <div className="wk-sm" style={{ marginTop: 10 }}>The timer is paused. Resume does not count the minutes you were away. No answer in {ask.waitMin} min: the timer stops at {ask.stopAt}.</div>
      </div>
    </div>
  ) : null

  if (!needConsent) return <>{pill}{question}{reasonBox}{stoppedNotice}</>
  return (
    <div className="wk" style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(7,11,22,.7)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="wk-card" style={{ maxWidth: 520, width: '100%' }} role="dialog" aria-label="Before you start">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Before you start</div>
        <p className="wk-sm" style={{ marginTop: 8 }}>While your timer runs, this app records:</p>
        <ul className="wk-sm" style={{ margin: '0 0 0 18px', lineHeight: 1.7 }}>
          <li>the program and window title you are in</li>
          <li>when you are idle</li>
          <li>a screenshot every {interval} minutes</li>
        </ul>
        <p className="wk-sm" style={{ marginTop: 10 }}>Nothing is recorded when the timer is stopped. Admin and your team head can see it. Screenshots are deleted after 30 days.</p>
        <div className="wk-row" style={{ marginTop: 14 }}>
          <button className="wk-btn o" onClick={() => invoke('hide_window', { label: 'main' }).catch(() => {})}>Not now</button>
          <button className="wk-btn y" disabled={busy} onClick={accept}>I understand, continue</button>
        </div>
      </div>
    </div>
  )
}
