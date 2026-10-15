// Phase 384 - Windows agent engine, running INSIDE the website page shown by the Windows program.
// Records ONLY while a timer runs AND the person is switched on (Team Work -> Activity) AND consent is accepted:
// program + window title + idle seconds per minute, a screenshot every N minutes, and the "Still working?" question.
// Talks to the database only through work_agent_* / work_clock_stop (same functions as step 1, phase 381).
import { useEffect, useRef, useState } from 'react'
import '../../styles/work.css'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { istTodayISO } from '../../utils/istDate'

const VERSION = '0.2.2'
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
  const [ask, setAsk] = useState(null)          // idle question also shown inside this page (backup for the small window)
  const [diag, setDiag] = useState(null)        // tiny status pill: idle seconds, recording, last error
  const S = useRef({
    device: 'Windows PC', config: null, running: null, projects: {}, buckets: new Map(),
    lastShot: 0, asking: null, askTimer: null, suppress: false, runId: null, ticking: false, lastTickAt: 0, lastSampleAt: 0, lastErr: '', idleNow: 0, answer: null,
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
        if (!s.runId && was) { invoke('hide_window', { label: 'widget' }).catch(() => {}); flushBuckets(true) }
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
    async function answerIdle(decision) {
      const a = s.asking
      if (!a) return
      clearTimeout(s.askTimer); s.asking = null; setAsk(null)
      invoke('hide_window', { label: 'idle' }).catch(() => {})
      const idleSecs = Math.round((Date.now() - new Date(a.began).getTime()) / 1000)
      if (decision === 'still_working') s.suppress = true
      try { await supabase.rpc('work_agent_idle', { p_entry: a.entry, p_idle_began: a.began, p_decision: decision, p_idle_seconds: idleSecs }) } catch { /* may be stopped */ }
      await loadAll()
      window.dispatchEvent(new Event('focus'))     // let the open page refresh its timer
    }
    async function maybeAskIdle(idle) {
      const mins = Number(s.config?.idle_minutes || 0)
      if (!mins || !s.running) return
      if (idle < 60) s.suppress = false
      if (s.asking || s.suppress || idle < mins * 60) return
      const began = new Date(Date.now() - idle * 1000)
      s.asking = { began: began.toISOString(), entry: s.running.id }
      const info = { minutes: mins, waitMin: 5, client: clientName(s.running.project_id) || s.running.task_label, stopAt: timeIST(began.toISOString()) }
      setAsk(info)
      await emit('agent:idle-ask', info)
      invoke('show_window', { label: 'idle' }).catch(() => {})
      invoke('show_window', { label: 'main' }).catch(() => {})
      s.askTimer = setTimeout(() => answerIdle('auto_stopped'), 5 * 60000)
    }
    async function tick() {
      // a call that never returned must not freeze recording for good
      if (s.ticking && Date.now() - (s.tickStart || 0) > 30000) s.ticking = false
      if (s.ticking || !s.running) return
      s.ticking = true; s.tickStart = Date.now()
      try {
        const [idle, win] = await Promise.all([invoke('idle_seconds'), invoke('active_window')])
        s.lastSampleAt = Date.now(); s.lastErr = ''; s.idleNow = idle
        if (recordOk()) {
          sample(win, idle)
          await flushBuckets(false)
          await maybeScreenshot()
          await maybeAskIdle(idle)
        }
        s.lastTickAt = Date.now()
      } catch (e) { s.lastErr = String(e?.message || e) } finally { s.ticking = false }
    }
    function pushState() {
      if (!s.running) { emit('agent:state', { running: false }); invoke('set_tray_tooltip', { text: 'Untitled Work - not running' }).catch(() => {}); return }
      const secs = (Date.now() - new Date(s.running.started_at).getTime()) / 1000 - (s.running.break_seconds || 0)
      emit('agent:state', { running: true, secs, client: clientName(s.running.project_id), label: s.running.task_label, recording: recordOk() && Date.now() - s.lastSampleAt < 30000, err: s.lastErr })
    }

    s.answer = answerIdle
    listen('agent:cmd', async (p) => {
      if (p?.type === 'stop') { await supabase.rpc('work_clock_stop', {}); await loadAll(); window.dispatchEvent(new Event('focus')) }
      if (p?.type === 'open') invoke('show_window', { label: 'main' }).catch(() => {})
    })
    listen('agent:idle-answer', (p) => answerIdle(p?.decision || 'still_working'))

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
      setDiag({ run: !!s.running, rec: recordOk() && Date.now() - s.lastSampleAt < 30000, idle: s.idleNow || 0, err: s.lastErr, asking: !!s.asking })
    }, 2000)
    const timers = [diagTimer, setInterval(tick, 5000), setInterval(pushState, 1000), setInterval(loadAll, 15000), setInterval(() => uploadQueue().catch(() => {}), 30000)]
    return () => { alive = false; timers.forEach(clearInterval) }
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
        {diag.rec ? 'Recording' : (diag.err ? 'Cannot record' : 'Not recording')} · idle {Math.floor(diag.idle / 60)}:{String(diag.idle % 60).padStart(2, '0')}
      </span>
    </div>
  ) : null
  const question = ask ? (
    <div className="wk" style={{ position: 'fixed', inset: 0, zIndex: 9001, background: 'rgba(7,11,22,.75)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="wk-card" style={{ maxWidth: 440, width: '100%', borderColor: 'var(--w-wat, #FBBF24)' }} role="dialog" aria-label="Still working?">
        <div className="wk-eyb">No activity for {ask.minutes} min</div>
        <div style={{ fontSize: 18, margin: '6px 0 12px' }}>Still working on {ask.client || 'your task'}?</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="wk-btn y" onClick={() => S.current.answer?.('still_working')}>Yes, still working</button>
          <button className="wk-btn o" onClick={() => S.current.answer?.('break')}>It was a break</button>
          <button className="wk-btn o" onClick={() => S.current.answer?.('stop')}>Stop timer</button>
        </div>
        <div className="wk-sm" style={{ marginTop: 10 }}>No answer in {ask.waitMin} min: the timer stops at {ask.stopAt}.</div>
      </div>
    </div>
  ) : null

  if (!needConsent) return <>{pill}{question}</>
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
