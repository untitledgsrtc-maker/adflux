// scripts/check-sw-denylist.mjs
//
// Phase 224 — SERVICE-WORKER DENYLIST TRIPWIRE.
//
// WHY THIS EXISTS (CLAUDE.md §76 / §223):
// "Which same-origin paths are SERVER routes, not the React SPA" is written in
// TWO files that drift:
//   • vercel.json  — redirects + rewrites (the server's truth)
//   • public/sw.js — the NavigationRoute `denylist` (the offline app's truth)
// When they disagree, the service worker on a rep's phone serves the SPA login
// shell for a real server link → the rep sees the LOGIN page instead of the
// thing (APK, deck, quote PDF...). This class has recurred 4× (34Z.27 assets/
// fonts, 76 api/apk, 181 deck, 223 pdf). This check makes the two lists
// impossible to silently drift again: if vercel.json treats a path as a server
// route but sw.js's denylist doesn't exempt it, the BUILD FAILS with the fix.
//
// FAIL-SAFE CONTRACT (§45 — never brick the live-app deploy):
//   • A POSITIVELY-detected missing path is the ONLY thing that exits 1.
//   • Any internal error (missing/garbled file, regex parse fail) prints a
//     WARNING and exits 0 — a bug in THIS checker can never block a good build.

import fs from 'node:fs'

const WARN = (m) => console.warn('[check-sw-denylist] WARN (not blocking): ' + m)

try {
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
  const sw = fs.readFileSync('public/sw.js', 'utf8')

  // ── 1. Paths vercel.json treats as SERVER routes → concrete test URLs ──
  const serverPaths = new Set()
  const sample = (src) => {
    const seg = String(src).replace(/^\//, '').split('/')[0]
      .replace(/[:*(].*/, '').replace(/[^A-Za-z0-9_-].*/, '')
    if (!seg) return null
    const nested = String(src).replace(/^\//, '').includes('/')
    return '/' + seg + (nested ? '/x' : '')
  }
  // a redirect source is a server path (e.g. /apk → /api/apk)
  for (const r of vercel.redirects || []) { const p = sample(r.source); if (p) serverPaths.add(p) }
  for (const r of vercel.rewrites || []) {
    // a rewrite whose destination is a function → its source is a server path
    if (String(r.destination || '').startsWith('/api/')) { const p = sample(r.source); if (p) serverPaths.add(p) }
    // the SPA catch-all's negative lookahead (?!api/|pdf/) lists exactly the
    // server prefixes it must NOT swallow — the SW must skip the same ones.
    const lk = String(r.source || '').match(/\(\?\!([^)]*)\)/)
    if (lk) for (const t of lk[1].split('|')) { const s = t.trim().replace(/\/+$/, ''); if (s) serverPaths.add('/' + s + '/x') }
  }
  if (!serverPaths.size) { WARN('no server paths found in vercel.json — nothing to check'); process.exit(0) }

  // ── 2. Extract the NavigationRoute denylist regexes from sw.js ──
  const block = sw.match(/denylist:\s*\[([\s\S]*?)\n\s*\]/)
  if (!block) { WARN('could not locate the NavigationRoute denylist array in public/sw.js'); process.exit(0) }
  // drop full-line comments so a path mentioned in a // comment can't be
  // mistaken for a real denylist regex (that would hide a genuine drift).
  const body = block[1].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  const denylist = [...body.matchAll(/\/((?:\\.|\[[^\]]*\]|[^/\n\\])+)\/([a-z]*)/g)]
    .map((m) => { try { return new RegExp(m[1], m[2]) } catch { return null } })
    .filter(Boolean)
  if (!denylist.length) { WARN('parsed zero denylist regexes from public/sw.js'); process.exit(0) }

  // ── 3. Every vercel server path MUST be covered by a denylist regex ──
  const missing = [...serverPaths].filter((p) => !denylist.some((re) => re.test(p)))
  if (missing.length) {
    const first = missing[0].replace(/^\//, '').split('/')[0]
    console.error('\n[check-sw-denylist] BUILD BLOCKED — service-worker denylist drift\n')
    console.error('vercel.json serves these as SERVER routes, but the NavigationRoute denylist in')
    console.error('public/sw.js does NOT exempt them — so a rep with the app installed gets the')
    console.error('LOGIN page when opening these links on their phone (CLAUDE.md §76 / §223):\n')
    for (const p of missing) console.error('   ' + p)
    console.error('\nFIX: add a matching entry to the denylist array in public/sw.js, e.g.')
    console.error('   /^\\/' + first + '(?:[/?#]|$)/,')
    console.error('then bump nothing else — reps reopen the app once to pick up the new SW.\n')
    process.exit(1)
  }

  console.log('[check-sw-denylist] OK — sw.js denylist covers all ' + serverPaths.size +
    ' vercel.json server path(s): ' + [...serverPaths].join(', '))
  process.exit(0)
} catch (e) {
  WARN('checker errored (' + (e && e.message) + ') — skipping, build not blocked')
  process.exit(0)
}
