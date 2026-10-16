// Untitled Work for Windows - Phase 384. The MAIN window shows the real website (app.untitledad.in), so the UI is
// the web UI exactly. This local bundle is only the two small always-on-top windows: the timer widget and the idle
// question. The recording engine runs inside the website page (src/components/work/WindowsAgentEngine.jsx) and
// feeds these windows through events.
import '../../src/styles/tokens.css'
import '../../src/styles/work.css'
import './agent.css'
import { emit, listen } from '@tauri-apps/api/event'

const view = new URLSearchParams(location.search).get('view') || 'widget'
const root = document.getElementById('app')
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const pad = (n) => String(n).padStart(2, '0')
const clock = (s) => { s = Math.max(0, Math.floor(s)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}` }

if (view === 'idle') runIdle()
else runWidget()

// ---------------------------------------------------------------- widget
function runWidget() {
  root.innerHTML = '<div class="wk" style="padding:8px"><div class="wk-hero" id="w" style="padding:12px 14px"></div></div>'
  const w = document.getElementById('w')
  let s = { running: false }
  const paint = () => {
    if (!s.running) {
      w.innerHTML = `<div class="wk-row"><span class="wk-eyb">Not running</span><button class="wk-btn y sm" id="open">Open</button></div>
        <div class="wk-timer" style="font-size:34px;margin:6px 0 0">00:00:00</div>`
    } else {
      w.innerHTML = `<div class="wk-row"><span class="wk-grp" style="min-width:0"><span class="wk-ldot"></span><span class="wk-eyb" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px">${esc(s.client || 'No client')}</span></span><button class="wk-btn y sm" id="stop">Stop</button></div>
        <div class="wk-timer" style="font-size:34px;margin:6px 0 2px">${clock(s.secs)}</div>
        <div class="wk-hs" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label || '')}${s.recording ? ' · recording' : (s.err ? ' · cannot record' : '')}</div>`
    }
    document.getElementById('stop')?.addEventListener('click', () => emit('agent:cmd', { type: 'stop' }))
    document.getElementById('open')?.addEventListener('click', () => emit('agent:cmd', { type: 'open' }))
  }
  listen('agent:state', (e) => { s = e.payload || { running: false }; paint() })
  paint()
}

// ---------------------------------------------------------------- idle question
function runIdle() {
  const card = (inner) => `<div class="wk" style="padding:16px"><div class="wk-card" style="border-color:var(--w-wat,#FBBF24)">${inner}</div></div>`
  const hms = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
  const askView = (p) => card(`<div class="wk-eyb">No activity for ${p.minutes || 5} min - timer waiting</div>
    <div class="wk-row" style="margin:8px 0 2px"><div><div class="wk-timer" style="font-size:44px;margin:0">${hms(p.worked)}</div>
      <div class="wk-hs">${esc(p.client || 'Your task')}${p.label ? ' - ' + esc(p.label) : ''}</div></div></div>
    <div class="wk-sm" style="margin:8px 0 12px">Are you still working? No answer in ${p.waitMin || 5} min: the timer stops at ${esc(p.stopAt || 'when you went idle')}.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <button class="wk-btn y" data-d="still_working" style="justify-content:center;min-height:48px">RESUME</button>
      <button class="wk-btn" data-d="stop" style="justify-content:center;min-height:48px;background:var(--danger,#EF4444);border-color:var(--danger,#EF4444);color:#fff">STOP</button>
    </div>
    <button class="wk-btn o" data-d="break" style="width:100%;justify-content:center;margin-top:10px">It was a break (take these minutes off)</button>`)
  const stoppedView = (p) => card(`<div class="wk-eyb" style="color:var(--w-dat,#F87171)">Your timer is stopped</div>
    <div style="font-size:18px;margin:6px 0 4px">Stopped at ${esc(p.stopAt || '')}${p.auto ? ' because you were away' : ''}.</div>
    <div class="wk-sm" style="margin-bottom:12px">${esc(p.client || '')}${p.label ? ' - ' + esc(p.label) : ''}. Time since then is not counted.</div>
    <div style="display:grid;gap:8px">
      <button class="wk-btn y" id="restart">Start the timer again</button>
      <button class="wk-btn o" id="closeit">Not now</button>
    </div>`)
  const bind = () => {
    root.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => emit('agent:idle-answer', { decision: b.dataset.d })))
    document.getElementById('restart')?.addEventListener('click', () => emit('agent:cmd', { type: 'restart' }))
    document.getElementById('closeit')?.addEventListener('click', () => emit('agent:cmd', { type: 'close-idle' }))
  }
  root.innerHTML = askView({})
  bind()
  listen('agent:idle-ask', (e) => { root.innerHTML = askView(e.payload || {}); bind() })
  listen('agent:idle-stopped', (e) => { root.innerHTML = stoppedView(e.payload || {}); bind() })
}
