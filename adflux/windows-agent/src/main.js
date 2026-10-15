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
        <div class="wk-hs" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.label || '')}${s.recording ? ' · recording' : ''}</div>`
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

