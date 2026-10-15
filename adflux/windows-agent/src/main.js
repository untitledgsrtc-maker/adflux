// Untitled Work for Windows - Phase 383. One bundle, three windows (?view=main | widget | idle).
// The MAIN window is the engine: login, timer, tasks, recording (only while a timer runs AND the person is
// switched on AND has accepted consent), idle question, upload. Widget + idle are thin views fed by events.
import '../../src/styles/tokens.css'
import '../../src/styles/work.css'
import './agent.css'
import { createClient } from '@supabase/supabase-js'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { SUPABASE_URL, SUPABASE_ANON_KEY, AGENT_VERSION } from './config.js'

const view = new URLSearchParams(location.search).get('view') || 'main'
const root = document.getElementById('app')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pad = (n) => String(n).padStart(2, '0')
const clock = (s) => { s = Math.max(0, Math.floor(s)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}` }
const dur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${pad(m)}m` : `${m}m` }
const timeIST = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

if (view === 'widget') runWidget()
else if (view === 'idle') runIdle()
else runMain()

// ---------------------------------------------------------------- widget
function runWidget() {
  root.innerHTML = '<div class="wk" style="padding:10px"><div class="wk-hero" id="w"></div></div>'
  const w = document.getElementById('w')
  let s = { running: false }
  const paint = () => {
    if (!s.running) { w.innerHTML = '<span class="wk-eyb">Not running</span><div class="wk-timer" style="font-size:36px">00:00:00</div><button class="wk-btn y sm" id="open">Open</button>'; }
    else {
      w.innerHTML = `<div class="wk-row"><span class="wk-grp"><span class="wk-ldot"></span><span class="wk-eyb">${esc(s.client || 'No client')}</span></span><button class="wk-btn y sm" id="stop">Stop</button></div>
        <div class="wk-timer" style="font-size:36px;margin:4px 0">${clock(s.secs)}</div>
        <div class="wk-hs">${esc(s.label || '')}${s.recording ? ' · recording' : ''}</div>`
    }
    document.getElementById('stop')?.addEventListener('click', () => emit('agent:cmd', { type: 'stop' }))
    document.getElementById('open')?.addEventListener('click', () => emit('agent:cmd', { type: 'open' }))
  }
  listen('agent:state', (e) => { s = e.payload || { running: false }; paint() })
  paint()
}

// ---------------------------------------------------------------- idle question
function runIdle() {
  root.innerHTML = `<div class="wk" style="padding:16px"><div class="wk-card" style="border-color:var(--w-wat,#FBBF24)">
    <div class="wk-eyb" id="i-top">No activity</div>
    <div style="font-size:18px;margin:6px 0 12px" id="i-q">Still working?</div>
    <div style="display:grid;gap:8px">
      <button class="wk-btn y" data-d="still_working">Yes, still working</button>
      <button class="wk-btn o" data-d="break">It was a break</button>
      <button class="wk-btn o" data-d="stop">Stop timer</button>
    </div>
    <div class="wk-sm" style="margin-top:10px" id="i-note"></div></div></div>`
  root.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => emit('agent:idle-answer', { decision: b.dataset.d })))
  listen('agent:idle-ask', (e) => {
    const p = e.payload || {}
    document.getElementById('i-top').textContent = `No activity for ${p.minutes || 5} min`
    document.getElementById('i-q').textContent = `Still working on ${p.client || 'your task'}?`
    document.getElementById('i-note').textContent = `No answer in ${p.waitMin || 5} min: the timer stops at ${p.stopAt || 'when you went idle'}.`
  })
}

// ---------------------------------------------------------------- main window / engine
function runMain() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } })
  const st = {
    user: null, profile: null, device: 'Windows PC', config: null, running: null, parts: [], projects: [], entries: [],
    tab: 'work', busy: false, msg: '', offline: false, member: true, loaded: false, autostart: false,
    project: localStorage.getItem('agent_last_project') || '', label: '', email: '',
  }
  const eng = { buckets: new Map(), lastShot: 0, asking: null, askTimer: null, suppress: false, runId: null, lastShotFor: null }
  const QKEY = 'agent_slice_queue'
  const loadQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]') } catch { return [] } }
  const saveQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-2000))) } catch { /* full */ } }

  const rpc = async (fn, args) => { const r = await sb.rpc(fn, args); if (r.error) throw r.error; return r.data }
  const recordOk = () => !!(st.config?.tracked && st.config?.consent_at)

  // ---- data
  async function loadAll() {
    if (!st.user) return
    try {
      const day0 = `${istToday()}T00:00:00+05:30`
      const [cfg, run, ent, parts, proj] = await Promise.all([
        sb.rpc('work_agent_config', { p_device: st.device }),
        sb.from('work_time_entries').select('*').eq('user_id', st.user.id).is('ended_at', null).maybeSingle(),
        sb.from('work_time_entries').select('*').eq('user_id', st.user.id).gte('started_at', day0).order('started_at'),
        sb.from('work_task_parts').select('id,task_id,label,due_date,status,task:work_tasks(title,project_id,due_date)')
          .eq('assignee_id', st.user.id).neq('status', 'finished').limit(100),
        sb.from('work_projects').select('id,name').eq('is_active', true).order('name').limit(400),
      ])
      if (cfg.error) throw cfg.error
      st.config = cfg.data
      st.running = run.data || null
      st.entries = ent.data || []
      st.parts = parts.data || []
      st.projects = proj.data || []
      st.offline = false; st.loaded = true
      // wake the right surfaces
      const was = eng.runId
      eng.runId = st.running?.id || null
      if (eng.runId && !was) { eng.lastShot = Date.now(); invoke('show_window', { label: 'widget' }).catch(() => {}) }
      if (!eng.runId && was) { invoke('hide_window', { label: 'widget' }).catch(() => {}); flushBuckets(true) }
    } catch (e) {
      st.offline = true
      st.msg = String(e?.message || e)
    }
    render()
  }

  // ---- timer actions
  async function act(fn) {
    if (st.busy) return
    st.busy = true; st.msg = ''; render()
    try { await fn() } catch (e) { st.msg = String(e?.message || e) }
    st.busy = false
    await loadAll()
  }
  const startTimer = (project, label, part) => act(() => rpc('work_clock_start', { p_project: project || null, p_label: label || null, p_part: part || null }))
  const stopTimer = () => act(() => rpc('work_clock_stop', {}))
  const finishPart = (id) => act(() => rpc('work_finish_part', { p_part: id, p_note: null }))

  // ---- recording
  const keyOf = (m, p, t) => `${m}|${p}|${t}`
  function sample(win, idle) {
    if (!st.running) return
    const minute = Math.floor(Date.now() / 60000) * 60000
    const k = keyOf(minute, win.program, win.title)
    const b = eng.buckets.get(k) || { minute, entry: st.running.id, program: win.program, title: win.title, active: 0, idle: 0 }
    if (idle >= 30) b.idle = Math.min(60, b.idle + 5); else b.active = Math.min(60, b.active + 5)
    eng.buckets.set(k, b)
  }
  async function flushBuckets(all) {
    const nowMin = Math.floor(Date.now() / 60000) * 60000
    const q = loadQ()
    for (const [k, b] of [...eng.buckets]) {
      if (all || b.minute < nowMin) {
        q.push({ entry: b.entry, start: new Date(b.minute).toISOString(), program: b.program, title: b.title, active: b.active, idle: b.idle })
        eng.buckets.delete(k)
      }
    }
    saveQ(q)
    await uploadQueue()
  }
  async function uploadQueue() {
    if (!st.user) return
    const q = loadQ()
    if (!q.length) return
    const batch = q.slice(0, 100)
    try {
      await rpc('work_agent_push_activity', { p_slices: batch })
      saveQ(q.slice(batch.length))
    } catch { /* offline: stays queued */ }
  }
  async function maybeScreenshot() {
    const every = Number(st.config?.screenshot_interval_min || 0)
    if (!every || !st.running) return
    if (Date.now() - eng.lastShot < every * 60000) return
    eng.lastShot = Date.now()
    try {
      const b64 = await invoke('take_screenshot')
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const takenAt = new Date().toISOString()
      const path = await rpc('work_agent_register_screenshot', { p_entry: st.running.id, p_taken_at: takenAt, p_bytes: bin.length })
      const up = await sb.storage.from('work-screenshots').upload(path, bin, { contentType: 'image/jpeg', upsert: true })
      if (up.error) throw up.error
    } catch { /* v1: a screenshot taken while offline is dropped */ }
  }

  // ---- idle question
  async function maybeAskIdle(idle) {
    const mins = Number(st.config?.idle_minutes || 0)
    if (!mins || !st.running) return
    if (idle < 60) eng.suppress = false
    if (eng.asking || eng.suppress || idle < mins * 60) return
    const began = new Date(Date.now() - idle * 1000)
    eng.asking = { began: began.toISOString(), entry: st.running.id, askedAt: Date.now() }
    const waitMin = 5
    await emit('agent:idle-ask', {
      minutes: mins, waitMin, client: projName(st.running.project_id) || st.running.task_label, stopAt: timeIST(began.toISOString()),
    })
    invoke('show_window', { label: 'idle' }).catch(() => {})
    eng.askTimer = setTimeout(() => answerIdle('auto_stopped'), waitMin * 60000)
  }
  async function answerIdle(decision) {
    const a = eng.asking
    if (!a) return
    clearTimeout(eng.askTimer); eng.asking = null
    invoke('hide_window', { label: 'idle' }).catch(() => {})
    const idleSecs = Math.round((Date.now() - new Date(a.began).getTime()) / 1000)
    if (decision === 'still_working') eng.suppress = true
    try {
      await rpc('work_agent_idle', { p_entry: a.entry, p_idle_began: a.began, p_decision: decision, p_idle_seconds: idleSecs })
    } catch { /* timer may already be stopped */ }
    await loadAll()
  }

  let ticking = false
  async function tick() {
    if (ticking || !st.user || !st.running) return
    ticking = true
    try {
      const [idle, win] = await Promise.all([invoke('idle_seconds'), invoke('active_window')])
      if (recordOk()) {
        sample(win, idle)
        await flushBuckets(false)
        await maybeScreenshot()
        await maybeAskIdle(idle)
      }
    } catch { /* ignore one bad sample */ } finally { ticking = false }
  }

  // ---- widget feed + commands
  function pushState() {
    if (!st.running) { emit('agent:state', { running: false }); invoke('set_tray_tooltip', { text: 'Untitled Work - not running' }).catch(() => {}); return }
    const secs = (Date.now() - new Date(st.running.started_at).getTime()) / 1000 - (st.running.break_seconds || 0)
    emit('agent:state', { running: true, secs, client: projName(st.running.project_id), label: st.running.task_label, recording: recordOk() })
    invoke('set_tray_tooltip', { text: `Untitled Work - running ${clock(secs)}` }).catch(() => {})
    const el = document.getElementById('run-clock'); if (el) el.textContent = clock(secs)
  }
  listen('agent:cmd', (e) => {
    if (e.payload?.type === 'stop') stopTimer()
    if (e.payload?.type === 'open') invoke('show_window', { label: 'main' })
  })
  listen('agent:idle-answer', (e) => answerIdle(e.payload?.decision || 'still_working'))

  const projName = (id) => st.projects.find((p) => p.id === id)?.name || ''

  // ---- UI
  function render() {
    if (!st.user) return renderLogin()
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return   // do not wipe what is being typed
    const dayTotal = st.entries.reduce((n, e) => n + Math.max(0, ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0)), 0)
    const first = st.entries[0]?.started_at
    const needConsent = st.config?.tracked && !st.config?.consent_at
    let body = ''
    if (needConsent) {
      body = `<div class="wk-card" style="max-width:520px;margin:24px auto">
        <div style="font-size:20px;font-weight:600">Before you start</div>
        <p class="ag-small">While your timer runs, this app records:</p>
        <ul class="ag-small" style="margin:0 0 0 18px"><li>the program and window title you are in</li><li>when you are idle</li><li>a screenshot every ${esc(st.config.screenshot_interval_min || 10)} minutes</li></ul>
        <p class="ag-small">Nothing is recorded when the timer is stopped. Admin and your team head can see it. Screenshots are deleted after 30 days.</p>
        <div class="wk-row" style="margin-top:14px"><button class="wk-btn o" data-act="signout">Not now</button><button class="wk-btn y" data-act="consent">I understand, continue</button></div></div>`
    } else if (st.tab === 'work') body = viewWork(dayTotal, first)
    else if (st.tab === 'tasks') body = viewTasks()
    else if (st.tab === 'hours') body = viewHours(dayTotal)
    else body = viewSettings()
    const tabs = [['work', 'My work'], ['tasks', `My tasks${st.parts.length ? ` <span class="wk-cnt">${st.parts.length}</span>` : ''}`], ['hours', 'My hours'], ['settings', 'Settings']]
    root.innerHTML = `${st.offline ? '<div class="ag-banner">No internet. Still recording, will upload when it is back.</div>' : ''}
      <div class="wk ag-pad">
        <div class="wk-head"><div><div class="wk-eyebrow">${esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }))}</div><h1 class="wk-title">My Work</h1></div></div>
        ${st.msg ? `<div class="wk-err" role="alert"><span>${esc(st.msg)}</span></div>` : ''}
        ${needConsent ? '' : `<div class="wk-tabs">${tabs.map(([k, l]) => `<button class="wk-tab${st.tab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`}
        ${st.loaded ? body : '<div class="wk-skel" style="height:190px;border-radius:16px"></div>'}
      </div>`
    bind()
  }

  function viewWork(dayTotal, first) {
    let hero
    if (st.running) {
      const secs = (Date.now() - new Date(st.running.started_at).getTime()) / 1000 - (st.running.break_seconds || 0)
      hero = `<div class="wk-hero"><div class="wk-row"><span class="wk-grp"><span class="wk-ldot"></span><span class="wk-eyb">Running · ${esc(projName(st.running.project_id) || 'No client')}</span></span><span class="wk-mono wk-hs">Started ${timeIST(st.running.started_at)}</span></div>
        <div class="wk-row" style="flex-wrap:wrap;align-items:flex-end;gap:20px"><div><div class="wk-timer" id="run-clock">${clock(secs)}</div><div class="wk-hs">${esc(st.running.task_label || '')}</div></div>
        <div class="wk-grp">${st.running.part_id ? '<button class="wk-btn y" data-act="finish-running">Finish</button>' : ''}<button class="wk-btn glass" data-act="stop">Pause</button></div></div>
        <div class="wk-hs" style="margin-top:8px">${recordOk() ? 'Recording: program, idle time and screenshots.' : 'Not recording (tracking is off for you).'}</div></div>`
    } else {
      hero = `<div class="wk-hero"><span class="wk-eyb">Not running · start work</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end;margin-top:14px">
          <div class="wk-field" style="margin:0"><label>Client</label><select class="wk-input" id="f-project"><option value="">Pick a client</option>
            ${st.projects.map((p) => `<option value="${p.id}"${p.id === st.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="wk-field" style="margin:0"><label>What are you doing</label><input class="wk-input" id="f-label" maxlength="80" value="${esc(st.label)}" placeholder="For example: Reel 1 edit"></div>
          <button class="wk-btn y" data-act="start"${st.busy ? ' disabled' : ''}>Start</button></div></div>`
    }
    return `<div class="wk-grid"><div class="wk-c8">${hero}</div>
      <div class="wk-c4"><div class="wk-card"><div class="wk-eyb">Today</div><div class="wk-num" style="font-size:32px;font-weight:600">${dur(dayTotal)}</div>
      <div class="wk-sm">${first ? `Check-in ${timeIST(first)}` : 'Your day starts with your first timer.'}</div></div></div></div>`
  }
  function viewTasks() {
    if (!st.parts.length) return '<div class="wk-card"><div class="wk-empty"><b>Nothing pending</b>Tasks given to you show here.</div></div>'
    return `<div class="wk-card flush">${st.parts.map((p) => {
      const title = p.task?.title || 'Task'; const due = p.due_date || p.task?.due_date
      const late = due && due < istToday()
      const mine = st.running?.part_id === p.id
      return `<div class="ag-list-row"><div style="min-width:0"><b>${esc(title)}</b><div class="wk-sm">${esc(projName(p.task?.project_id) || 'No client')}${p.label ? ' · ' + esc(p.label) : ''}</div>
        <div style="margin-top:6px"><span class="wk-pill ${late ? 'bad' : due === istToday() ? 'warn' : 'ok'}">${due ? (late ? 'Overdue, ' : due === istToday() ? 'Due today' : 'Due ') + (due === istToday() ? '' : esc(due)) : 'No due date'}</span></div></div>
        <div class="wk-grp">${mine ? '<span class="wk-pill y">Running</span>' : `<button class="wk-btn g sm" data-act="start-part" data-id="${p.id}">Start</button>`}
        <button class="wk-btn g sm" data-act="finish-part" data-id="${p.id}">Finish</button></div></div>`
    }).join('')}</div>`
  }
  function viewHours(dayTotal) {
    if (!st.entries.length) return '<div class="wk-card"><div class="wk-empty"><b>No time yet today</b>Start a timer on My work.</div></div>'
    return `<div class="wk-card flush"><div class="ag-list-row" style="background:var(--w-hov)"><b>Today</b><b class="wk-num">${dur(dayTotal)}</b></div>
      ${st.entries.map((e) => {
        const s = Math.max(0, ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 1000 - (e.break_seconds || 0))
        return `<div class="ag-list-row"><div><div>${esc(projName(e.project_id) || 'No client')}</div><div class="wk-sm">${esc(e.task_label || '')} · ${timeIST(e.started_at)} to ${e.ended_at ? timeIST(e.ended_at) : 'running'}</div></div><span class="wk-num">${dur(s)}</span></div>`
      }).join('')}</div>`
  }
  function viewSettings() {
    return `<div class="wk-card flush">
      <div class="ag-list-row"><span>Signed in as</span><b>${esc(st.profile?.name || st.user.email)}</b></div>
      <div class="ag-list-row"><span>This PC</span><span>${esc(st.device)}</span></div>
      <div class="ag-list-row"><span>Recording</span><span class="wk-pill ${recordOk() ? 'ok' : 'warn'}">${recordOk() ? 'On while a timer runs' : st.config?.tracked ? 'Waiting for consent' : 'Off'}</span></div>
      <div class="ag-list-row"><span>Start with Windows</span><button role="switch" aria-checked="${st.autostart}" class="wk-sw${st.autostart ? ' on' : ''}" data-act="autostart"><i></i></button></div>
      <div class="ag-list-row"><span>Version</span><span>${esc(AGENT_VERSION)}</span></div>
      <div class="ag-list-row"><button class="wk-btn o" data-act="signout">Sign out</button><button class="wk-btn o" data-act="quit">Quit the app</button></div></div>`
  }
  function renderLogin() {
    root.innerHTML = `<div class="wk ag-center"><div class="wk-card ag-narrow">
      <div class="wk-eyebrow">Untitled Work</div><h1 class="wk-title" style="font-size:26px">Sign in</h1>
      <div class="wk-field"><label>Email</label><input class="wk-input" id="l-email" type="email" autocomplete="username" value="${esc(st.email || '')}"></div>
      <div class="wk-field"><label>Password</label><input class="wk-input" id="l-pass" type="password" autocomplete="current-password"></div>
      ${st.msg ? `<div class="wk-err" role="alert"><span>${esc(st.msg)}</span></div>` : ''}
      <button class="wk-btn y ag-btn-full" id="l-go"${st.busy ? ' disabled' : ''}>Sign in</button>
      <div class="ag-small" style="margin-top:10px">Same email and password as the Untitled OS website.</div></div></div>`
    const go = async () => {
      // read the fields BEFORE re-rendering (a re-render empties them)
      const email = (document.getElementById('l-email')?.value || '').trim()
      const password = document.getElementById('l-pass')?.value || ''
      if (!email || !password) { st.msg = 'Type your email and password.'; st.email = email; return renderLogin() }
      st.busy = true; st.msg = ''; st.email = email; renderLogin()
      const r = await sb.auth.signInWithPassword({ email, password })
      st.busy = false
      if (r.error) { st.msg = r.error.message === 'Invalid login credentials' ? 'Wrong email or password.' : r.error.message; return renderLogin() }
      st.email = ''
      await afterLogin(r.data.user)
    }
    document.getElementById('l-go')?.addEventListener('click', go)
    document.getElementById('l-pass')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
  }

  function bind() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; render() }))
    root.querySelector('#f-project')?.addEventListener('change', (e) => { st.project = e.target.value; localStorage.setItem('agent_last_project', st.project) })
    root.querySelector('#f-label')?.addEventListener('input', (e) => { st.label = e.target.value })
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.act, id = b.dataset.id
      if (a === 'start') {
        if (!st.project) { st.msg = 'Pick a client.'; return render() }
        if (!st.label.trim()) { st.msg = 'Type what you are doing.'; return render() }
        const l = st.label.trim(); st.label = ''; startTimer(st.project, l, null)
      } else if (a === 'stop') stopTimer()
      else if (a === 'finish-running') finishPart(st.running.part_id)
      else if (a === 'start-part') { const p = st.parts.find((x) => x.id === id); startTimer(p?.task?.project_id, p?.task?.title, id) }
      else if (a === 'finish-part') finishPart(id)
      else if (a === 'consent') act(() => rpc('work_agent_consent', { p_device: st.device, p_version: AGENT_VERSION }))
      else if (a === 'autostart') { st.autostart = await invoke('set_autostart', { on: !st.autostart }); render() }
      else if (a === 'signout') { await sb.auth.signOut(); st.user = null; st.config = null; st.running = null; st.loaded = false; render() }
      else if (a === 'quit') invoke('quit_app')
    }))
  }

  async function afterLogin(user) {
    st.user = user
    const p = await sb.from('users').select('name,role').eq('id', user.id).maybeSingle()
    st.profile = p.data || null
    try {
      st.autostart = await invoke('autostart_enabled')
      if (!st.autostart && !localStorage.getItem('agent_autostart_asked')) {
        localStorage.setItem('agent_autostart_asked', '1')
        st.autostart = await invoke('set_autostart', { on: true })
      }
    } catch { /* not critical */ }
    await loadAll()
  }

  // ---- boot
  ;(async () => {
    try { st.device = await invoke('device_name') } catch { /* keep default */ }
    renderLogin()
    const { data } = await sb.auth.getSession()
    if (data?.session?.user) await afterLogin(data.session.user)
    setInterval(tick, 5000)
    setInterval(pushState, 1000)
    setInterval(() => { if (st.user) loadAll() }, 20000)
    setInterval(() => { if (st.user) uploadQueue() }, 30000)
  })()
}
