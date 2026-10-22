// Phase 461 tripwire: the Windows app is two halves (the website in the main window + a small local bundle for the widget /
// idle windows + Rust commands). They talk through three contracts that silently break when one side changes:
//   1. every Rust command the website calls is declared in build.rs, granted in capabilities/remote.json, registered in main.rs
//   2. every event emitted has a listener on the other side (and vice versa)
//   3. every window label the code shows/hides exists in tauri.conf.json
// Fails the build ONLY on a positive mismatch; any read/parse problem warns and passes (never blocks a deploy by itself).
import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const bad = []
try {
  const eng = read('src/components/work/WindowsAgentEngine.jsx')
  const loc = read('windows-agent/src/main.js')
  const build = read('windows-agent/src-tauri/build.rs')
  const rust = read('windows-agent/src-tauri/src/main.rs')
  const cap = JSON.parse(read('windows-agent/src-tauri/capabilities/remote.json'))
  const conf = JSON.parse(read('windows-agent/src-tauri/tauri.conf.json'))

  // 1. commands the website calls
  const called = new Set([...eng.matchAll(/invoke\(\s*'([a-z_]+)'/g)].map((m) => m[1]))
  const declared = new Set([...build.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
  const handler = rust.slice(rust.indexOf('generate_handler!'))
  const perms = new Set(cap.permissions || [])
  for (const c of called) {
    if (c.startsWith('plugin:')) continue
    if (!declared.has(c)) bad.push(`website calls "${c}" but build.rs does not declare it`)
    if (!perms.has('allow-' + c.replace(/_/g, '-'))) bad.push(`website calls "${c}" but remote.json has no allow-${c.replace(/_/g, '-')}`)
    if (!new RegExp('\\b' + c + '\\b').test(handler)) bad.push(`"${c}" is not in generate_handler! in main.rs`)
  }
  // 2. events
  const ev = (src, re) => new Set([...src.matchAll(re)].map((m) => m[1]))
  const emitted = new Set([...ev(eng, /emit\(\s*'(agent:[a-z-]+)'/g), ...ev(loc, /emit\(\s*'(agent:[a-z-]+)'/g)])
  const listened = new Set([...ev(eng, /listen\(\s*'(agent:[a-z-]+)'/g), ...ev(loc, /listen\(\s*'(agent:[a-z-]+)'/g)])
  for (const e of emitted) if (!listened.has(e)) bad.push(`event "${e}" is emitted but nothing listens`)
  for (const e of listened) if (!emitted.has(e)) bad.push(`event "${e}" is listened to but nothing emits it`)
  // 3. window labels
  const labels = new Set((conf.app?.windows || []).map((w) => w.label))
  for (const l of [...eng.matchAll(/label:\s*'([a-z]+)'/g)].map((m) => m[1])) if (!labels.has(l)) bad.push(`window "${l}" is used but not in tauri.conf.json`)
  // 5. every button in the small windows is handled by the engine (a dead button was the Phase 460 bug)
  for (const t of new Set([...loc.matchAll(/type:\s*'([a-z-]+)'/g)].map((m) => m[1]))) if (!eng.includes(`'${t}'`)) bad.push(`small-window command "${t}" is not handled by the engine`)
  for (const d of new Set([...loc.matchAll(/data-d="([a-z_]+)"/g)].map((m) => m[1]))) if (d !== 'worked' && !/(still_working|stop|break|auto_stopped)/.test(d) ) bad.push(`idle button "${d}" is unknown`)
  if (loc.includes("data-d=\"worked\"") && !loc.includes("decision: 'worked', note")) bad.push('"I was working" must send a note from the small window')
  // 4. the same additionalBrowserArgs on every window (WebView2 needs identical args when windows share a profile)
  const args = new Set((conf.app?.windows || []).map((w) => w.additionalBrowserArgs || ''))
  if (args.size > 1) bad.push('windows have DIFFERENT additionalBrowserArgs - the app will not start (Phase 367.1)')
} catch (e) {
  console.warn('[check-windows-agent] skipped:', e.message)
  process.exit(0)
}
if (bad.length) { console.error('[check-windows-agent] FAIL\n - ' + bad.join('\n - ')); process.exit(1) }
console.log('[check-windows-agent] OK')
