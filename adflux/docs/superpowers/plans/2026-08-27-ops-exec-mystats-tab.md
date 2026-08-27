# Ops-exec "My stats" tab + responsive layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add a 4th "My stats" tab to the operation_executive dashboard (uptime + pay + my stations up/down + fixed-this-month + avg time-to-fix + worst stations, all scoped to my stations), and make the whole page use desktop width (skinny-column fix).

**Architecture:** One file — `src/pages/v2/OpsTicketsV2.jsx` (NOT §28-frozen). The tab reuses the live `ops_my_uptime_pay()` RPC (§233) + adds two small self-scoped read queries (screen-status counts, this-month resolved tickets); worst stations derive from the offline screens already loaded. Responsive via the existing `useIsDesktop` hook: single column on phone, `repeat(auto-fill, minmax(340px, 1fr))` grid on desktop. No SQL, no APK, no frozen-file touch → no guardian.

**Tech Stack:** React + Supabase JS, `opsStrings` (Gujarati-first §231), `useIsDesktop`, `istDate.js`, lucide, v2 tokens.

**Design:** approved clickable mockup this session (`ops_exec_mystats_tab`). Discipline: commit only named files (never `git add -A`); self-push + verify each (§211).

---

### Task 1: Responsive width (kill the skinny-column-on-desktop)

**Files:** Modify `src/pages/v2/OpsTicketsV2.jsx`

- [ ] **Step 1: Import the hook** (already may be present from a prior partial edit — ensure exactly one)

After the `confirmDialog` import:
```jsx
import { useIsDesktop } from '../../hooks/useIsDesktop'
```

- [ ] **Step 2: Add `isDesktop` + a grid style** — right after `const uid = profile?.id`:
```jsx
  const isDesktop = useIsDesktop()
  const gridWrap = { display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(340px, 1fr))' : '1fr', gap: 12, alignItems: 'start' }
```

- [ ] **Step 3: Widen the container** — change the outer wrapper:
```jsx
    <div style={{ padding: '14px 14px 40px', maxWidth: isDesktop ? 1120 : 480, margin: '0 auto' }}>
```

- [ ] **Step 4: Grid the Open-tab cards.** In `OpenTab`, wrap the grouped station cards AND the individual list in `<div style={gridWrap}>…</div>`, and remove the per-card `marginBottom` (the grid `gap` handles spacing):
  - grouped: `<div style={gridWrap}>{Object.entries(byDepot).map(([did, list]) => (<div key={did} style={card}> … </div>))}</div>` (card was `{...card, marginBottom: 10}` → `card`).
  - individual: `<div style={gridWrap}>{cityScreens.map(s => (<button … style={{ ...btnBase, justifyContent:'space-between', padding:12 }}> … </button>))}</div>` where the button previously had `marginBottom: 8` — drop it. (Keep the `className="btn"`; a button inside a grid cell fills the cell.)

- [ ] **Step 5: Grid the Proc + Fixed tabs.** `ProcTab`: `return <div style={gridWrap}>{cityProc.map(tk => (… card without marginBottom …))}</div>`. `FixedTab`: `return <div style={gridWrap}>{cityFixed.map(f => (… card without marginBottom …))}</div>`. (Each card style `{...card, marginBottom: N}` → `card`.)

- [ ] **Step 6: Parse.** `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/OpsTicketsV2.jsx >/dev/null` → silent.

- [ ] **Step 7: Commit + push.**
```bash
git add src/pages/v2/OpsTicketsV2.jsx
git commit -m "Ops tickets: responsive width (desktop grid, phone single column)"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 2: opsStrings — My-stats labels

**Files:** Modify `src/utils/opsStrings.js`

- [ ] **Step 1: Append keys** inside `STR` (before the closing `}`):
```js
  // — my stats tab —
  tab_mystats:     { gu: 'મારું',                     en: 'My stats' },
  my_uptime_mo:    { gu: 'સ્ક્રીન ચાલુ · આ મહિને',      en: 'Uptime · this month' },
  my_pay_so_far:   { gu: 'તમારો પગાર (અંદાજ)',         en: 'Your pay so far' },
  pay_more_uptime: { gu: 'વધુ ચાલુ → વધુ પગાર',        en: 'more uptime → more pay' },
  my_stations:     { gu: 'મારા સ્ટેશન',                en: 'My stations' },
  up_word:         { gu: 'ચાલુ',                       en: 'up' },
  fixed_this_mo:   { gu: 'આ મહિને સુધાર્યા',            en: 'Fixed this month' },
  avg_fix:         { gu: 'સરેરાશ સુધારવાનો સમય',        en: 'avg to fix' },
  worst_now:       { gu: 'અત્યારે સૌથી ખરાબ',           en: 'Worst stations right now' },
  scoped_note:     { gu: 'ફક્ત તમારા સ્ટેશન · નેટવર્ક રિપોર્ટ પ્રમાણે અપડેટ', en: 'Your stations only · updates as the network reports' },
  no_stats:        { gu: 'હજી પૂરતી માહિતી નથી',        en: 'Not enough data yet' },
  hrs:             { gu: 'ક',                           en: 'h' },
```

- [ ] **Step 2: Parse + key-count.** `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/utils/opsStrings.js >/dev/null` (pre-existing dup-key warnings for `screen`/`no_contacts`/`pick_screen` are §244-known, ignore). Then `for k in tab_mystats my_uptime_mo worst_now no_stats; do grep -c "  $k:" src/utils/opsStrings.js; done` → `1` each.

- [ ] **Step 3: Commit + push.**
```bash
git add src/utils/opsStrings.js
git commit -m "Ops: opsStrings keys for the My-stats tab"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 3: The My-stats tab (data + render)

**Files:** Modify `src/pages/v2/OpsTicketsV2.jsx`

- [ ] **Step 1: Import IST helper** — add near the top imports:
```jsx
import { istTodayISO } from '../../utils/istDate'
```

- [ ] **Step 2: Add state** (near the other `useState`s):
```jsx
  const [stats, setStats] = useState(null)   // { uptimePct, pay, hasPay, up, down, fixedMo, avgFixH } | null
```

- [ ] **Step 3: Load the stats inside `load()`** — after the `setScreens(...)` / call-history block, before the `catch`. All self-scoped, best-effort (a failure leaves the previous stats):
```jsx
      // ── My-stats (self-scoped; RPC + two small reads) ──
      try {
        const monthStart = istTodayISO().slice(0, 8) + '01'
        const [payRes, cntRes, fixRes] = await Promise.all([
          supabase.rpc('ops_my_uptime_pay'),
          supabase.from('ops_screens').select('status').in('depot_id', depotIds).eq('is_active', true),
          supabase.from('ops_tickets').select('created_at, resolved_at').eq('assigned_to', uid).eq('source', 'manual').eq('status', 'resolved').gte('resolved_at', monthStart),
        ])
        const pay = Array.isArray(payRes.data) ? payRes.data[0] : payRes.data
        const cnt = cntRes.data || []
        const up = cnt.filter(s => s.status === 'online').length
        const down = cnt.filter(s => s.status === 'offline').length
        const fx = fixRes.data || []
        const durs = fx.map(r => (r.resolved_at && r.created_at) ? (new Date(r.resolved_at) - new Date(r.created_at)) / 3600000 : null).filter(v => v != null && v >= 0)
        const avgFixH = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null
        setStats({
          uptimePct: pay && pay.has_data ? Math.round(Number(pay.uptime_pct) || 0) : null,
          pay: pay && pay.has_data ? Number(pay.salary) || 0 : null,
          hasPay: !!(pay && pay.has_data),
          up, down, fixedMo: fx.length, avgFixH,
        })
      } catch { /* keep prior stats */ }
```
Note: `depotIds` is in scope (defined earlier in `load()`); this block sits inside the `if (depotIds.length)` region. In the early-return no-depots branch, also `setStats(null)`.

- [ ] **Step 4: Add the 4th tab button.** In the tab bar `.map`, append a 4th entry (keep the pattern — count is optional; My stats has no count):
```jsx
        {[['open', t('tab_open', lang), 'var(--danger)'], ['proc', t('tab_proc', lang), 'var(--v2-amber, #F59E0B)'], ['fixed', t('tab_fixed', lang), 'var(--v2-green, #10B981)'], ['mystats', t('tab_mystats', lang), '']].map(([k, label, col]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: 'none', border: 'none', borderBottom: `2px solid ${tab === k ? yellow : 'transparent'}`, padding: '9px 0', fontSize: 13, fontWeight: tab === k ? 700 : 400, color: tab === k ? 'var(--v2-ink-0, #f1f5f9)' : ink2, cursor: 'pointer' }}>
            {label}{col ? <> <span style={{ color: col }}>{cnt[k]}</span></> : null}
          </button>
        ))}
```
(`cnt` has no `mystats` key → guarded by the `col ?` check so no count renders.)

- [ ] **Step 5: Render the tab.** Add after `{tab === 'fixed' && <FixedTab />}`:
```jsx
      {tab === 'mystats' && <MyStatsTab />}
```

- [ ] **Step 6: Add the `MyStatsTab` component** (a nested function alongside OpenTab/ProcTab/FixedTab). Reuses `screens` (offline) for worst-stations, `stats` for the rest, `gridWrap` for desktop width:
```jsx
  function MyStatsTab() {
    const s = stats
    // worst stations right now = offline screens grouped by depot, top 3
    const byDepot = {}; screens.forEach(sc => { byDepot[sc.depot_id] = (byDepot[sc.depot_id] || 0) + 1 })
    const worst = Object.entries(byDepot).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const ring = s?.uptimePct != null ? s.uptimePct : 0
    return (
      <div style={gridWrap}>
        {/* uptime + pay */}
        <div style={{ ...card, display: 'flex', gap: 12 }}>
          <div style={{ width: 92, height: 92, flexShrink: 0, borderRadius: '50%', background: `conic-gradient(var(--v2-green, #10B981) 0 ${ring}%, var(--v2-bg-2, #0f172a) ${ring}% 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 70, height: 70, borderRadius: '50%', background: 'var(--v2-bg-1, #1e293b)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 21, fontWeight: 700 }}>{s?.uptimePct != null ? `${s.uptimePct}%` : '—'}</span>
              <span style={{ fontSize: 10, color: ink2 }}>{t('my_uptime_mo', lang)}</span>
            </div>
          </div>
          <div style={{ flex: 1, background: 'var(--success-soft, rgba(16,185,129,.12))', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--v2-green, #10B981)' }}>{t('my_pay_so_far', lang)}</span>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--v2-green, #10B981)' }}>{s?.hasPay ? `₹${(s.pay).toLocaleString('en-IN')}` : t('no_stats', lang)}</span>
            {s?.hasPay && <span style={{ fontSize: 11, color: 'var(--v2-green, #10B981)' }}>{t('pay_more_uptime', lang)}</span>}
          </div>
        </div>
        {/* my stations + fixed */}
        <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: ink2 }}>{t('my_stations', lang)}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{depots.length}</div>
            <div style={{ fontSize: 11, color: ink2 }}><span style={{ color: 'var(--v2-green, #10B981)' }}>{s?.up ?? 0} {t('up_word', lang)}</span> · <span style={{ color: 'var(--danger)' }}>{s?.down ?? 0} {t('down_word2', lang)}</span></div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: ink2 }}>{t('fixed_this_mo', lang)}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s?.fixedMo ?? 0}</div>
            <div style={{ fontSize: 11, color: ink2 }}>{s?.avgFixH != null ? `${t('avg_fix', lang)} ${s.avgFixH}${t('hrs', lang)}` : '—'}</div>
          </div>
        </div>
        {/* worst stations */}
        {worst.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 12, color: ink2, marginBottom: 8 }}>{t('worst_now', lang)}</div>
            {worst.map(([did, n], i) => (
              <div key={did} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: i ? '1px solid var(--v2-line, #334155)' : 'none' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{depotName(did)}</span>
                <span style={{ fontSize: 11, background: 'var(--danger-soft, rgba(239,68,68,.12))', color: 'var(--danger)', borderRadius: 999, padding: '2px 10px' }}>{n} {t('down_word2', lang)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--v2-ink-3, #64748b)', textAlign: 'center' }}>{t('scoped_note', lang)}</div>
      </div>
    )
  }
```

- [ ] **Step 7: Parse + build.** `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/OpsTicketsV2.jsx >/dev/null && npm run build 2>&1 | tail -2` → parse silent, build ends `files generated` / `dist/sw.js`.

- [ ] **Step 8: Commit + push.**
```bash
git add src/pages/v2/OpsTicketsV2.jsx
git commit -m "Ops tickets: My-stats tab (uptime + pay + stations + fixes + worst, self-scoped)"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

---

### Task 4: Document (§93)

**Files:** Modify `CLAUDE.md` (append §247)

- [ ] **Step 1: Append** a `## 247 · Ops-exec dashboard — My-stats tab + responsive (…date…)` section: the 4th tab (self-scoped uptime/pay/stations/fixes/worst via `ops_my_uptime_pay` + 2 reads), the responsive fix (useIsDesktop → desktop grid), zero SQL/APK (reuses the §233 RPC), and the foot-guns: (a) all stats are `assigned_to=me` / my-depots scoped — never widen to network data (that's the admin cockpit §233, RLS-gated); (b) uptime/pay show "—/not enough data yet" until uptime-pay (p4) is on — station health + fixes are real immediately; (c) IST month start via `istTodayISO().slice(0,8)+'01'`, not UTC.

- [ ] **Step 2: Commit + push.**
```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md §247 — ops-exec My-stats tab + responsive"
git push origin untitled-os
git log origin/untitled-os..HEAD --oneline   # expect empty
```

- [ ] **Step 3: Owner handoff** — plain language: nothing to run (no SQL, no APK — reuses the pay RPC you ran in §233). It deploys on push. Smoke: as testope on **desktop** → the cards now fill the width; a 4th **My stats** tab shows your stations' up/down, fixed-this-month, worst stations (real now), and uptime/pay ("not enough data yet" until uptime recording is turned on).

---

## Self-review

- **Coverage:** responsive (T1) · strings (T2) · 4th tab + data + render (T3) · docs (T4). All approved-mockup elements (uptime ring, pay, my stations up/down, fixed + avg, worst stations, scoped note) → T3 `MyStatsTab`. ✓
- **Placeholders:** none — complete code each step. ✓
- **Consistency:** `stats` shape (`uptimePct/pay/hasPay/up/down/fixedMo/avgFixH`) set in T3-Step3 and read identically in T3-Step6. `gridWrap` defined T1-Step2, used in every tab. `tab_mystats`/`my_*`/`worst_now`/`no_stats`/`hrs`/`up_word` added T2, used T3. `down_word2` reused (exists from §246). `depotIds` in scope (from `load()`). ✓
- **No SQL/frozen/guardian:** `ops_my_uptime_pay` is live (§233 RUN); OpsTicketsV2 is not §28-frozen; no App.jsx/V2AppShell change (the tab is internal). ✓
- **Scoping (security):** every stats query is `assigned_to = uid` or `depot_id IN (my depots)`; `ops_my_uptime_pay` is self-scoped DEFINER (§233). No network-wide/other-tech/P&L data. ✓
