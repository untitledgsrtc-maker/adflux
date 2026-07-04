#!/usr/bin/env node
// ============================================================================
// Phase 197 — 1000-row-cap guard.
// ============================================================================
// PostgREST silently caps any response at ~1000 rows. A .limit(20000) does NOT
// override it — you must page with .range(). This is invisible in testing (it
// only shows once a table crosses 1000 rows in production), which is why the
// same bug came back three times (Phase 151/152/196).
//
// This scans changed .jsx/.js files for supabase.from('<high-volume table>')
// ...select(...) chains that page with NEITHER .range() NOR a small .limit(),
// and warns. Heuristic (a rep/date filter can bound a query the script can't
// see), so it WARNS by default — exit 0. Pass --strict to fail the commit.
//
// Mark a query the human has confirmed is bounded with a  // cap-ok  comment
// anywhere in its chain to silence it.
//
// Usage:  node scripts/check-query-cap.mjs [--strict] <file1> <file2> ...
// ============================================================================

import fs from 'node:fs'

const BIG = ['leads', 'quotes', 'call_logs', 'gps_pings', 'lead_activities', 'follow_ups', 'payments']
// A chain is considered bounded/safe if it contains any of these markers.
const SAFE = ['.range(', '.limit(', '.single(', '.maybeSingle(', 'count:', 'head:', 'cap-ok']

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const files = args.filter(a => !a.startsWith('--'))

let warnings = 0

for (const file of files) {
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { continue }
  if (!/\.(jsx?|mjs|cjs|ts|tsx)$/.test(file)) continue
  const lines = src.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\.from\(\s*['"`](\w+)['"`]\s*\)/)
    if (!m || !BIG.includes(m[1])) continue

    // Collect ONLY this supabase statement's chain: keep extending while the
    // next line continues the chain (starts with `.` or `//`) OR a method call
    // is still open across lines (unbalanced parens). Stop the moment the
    // statement is complete — balanced parens AND the chunk ends with `,`/`;`
    // (e.g. one element of a Promise.all array). Without this the chunk bleeds
    // into the NEXT query and picks up its .limit()/.range() (false-safe).
    const balanced = (s) => (s.match(/\(/g) || []).length <= (s.match(/\)/g) || []).length
    let chunk = lines[i]
    let j = i
    while (j < lines.length - 1 && j < i + 25) {
      if (balanced(chunk) && /[,;]\s*$/.test(chunk.trimEnd())) break
      const nt = lines[j + 1].trim()
      if (nt.startsWith('.') || nt.startsWith('//') || !balanced(chunk)) {
        chunk += '\n' + lines[j + 1]
        j++
      } else break
    }

    // Only a READ can hit the row cap. If the chain isn't a .select(), skip
    // (it's an .update()/.delete()/.insert()).
    if (!/\.select\(/.test(chunk)) continue
    if (SAFE.some(s => chunk.includes(s))) continue

    warnings++
    const preview = lines[i].trim().slice(0, 90)
    console.log(`  ⚠  ${file}:${i + 1}  from('${m[1]}').select() with no .range()/.limit() — confirm it can't exceed 1000 rows, or add paging.`)
    console.log(`       ${preview}`)
  }
}

if (warnings === 0) {
  console.log('check-query-cap: OK — no unpaged big-table selects in the scanned files.')
  process.exit(0)
}
console.log(`\ncheck-query-cap: ${warnings} potential 1000-row-cap query(ies). Add .range() paging, a small .limit(), a server-side count RPC, or mark  // cap-ok  if bounded.`)
process.exit(strict ? 1 : 0)
