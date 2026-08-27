# Operations Auto-Ticket Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the aiadflux sync detects a station's screens go offline, auto-open one fault ticket per station, assign it to that depot's tech, alert them (in-app + push + WhatsApp), and run it through a guarded lifecycle (open → in_progress → resolved → approved) where a tech can't close and the head can't approve while the screens are still offline.

**Architecture:** One `SECURITY DEFINER` DB engine (`ops_reconcile_offline_tickets()`) called at the end of every sync run opens/auto-cancels tickets; four `SECURITY DEFINER` RPCs enforce the guarded transitions + role gates; the two ops frontends (OpsWorkV2, OpsHeadV2) call the RPCs; push fires in-DB via `enqueue_push`; WhatsApp fires via a pg_net POST to a new Edge endpoint. Everything is additive to the Operations module (§230–§242) — no §28-frozen sales file, no money path.

**Tech Stack:** Postgres (Supabase) + PL/pgSQL, Vercel Edge functions (`api/ops/*.js`), React (Vite) ops pages, `enqueue_push` (§96 push pipeline), `pg_net` (async HTTP from Postgres), the aiadflux sync (`api/ops/sync.js`, §241).

**Environment note (read first):** This project has NO automated Postgres test harness — the owner runs every `.sql` file by hand in Supabase Studio (§14/§154), and the sandbox cannot run Postgres. So each SQL task's "test" is: (a) `bash scripts/check-sql-schema.sh <file>` passes (idempotency/structure lint), (b) a logic self-review against the checklist in that task, and (c) the VERIFY block is present. The REAL acceptance test is the owner's manual Studio smoke, fully scripted in **Task 9**. For JS/Edge tasks the test is `npx --yes esbuild` parse / `node --check` + `npm run build`. Ops files are NOT §28-frozen, so no guardian audit is required (the sales-module-guardian is only for §28 files).

**Working directory for all commands:** `/Users/apple/Documents/untitled-os2/Untitled/adflux`

**Commit discipline:** stage ONLY the files named in each task — NEVER `git add -A` (the working tree has unrelated unstaged changes: deleted `_design_reference` files, Android assets, `.DS_Store`). Self-push after each commit (`git push origin untitled-os`) then verify `git log origin/untitled-os..HEAD` is empty.

---

### Task 1: SQL migration — ops_tickets schema (status/source CHECK + approver + down_count)

**Files:**
- Create: `supabase_ops_p2_auto_tickets.sql` (this task writes SECTION 1 of a file that grows across Tasks 1–3 and 8; the owner runs the FINAL file once).

- [ ] **Step 1: Create the file with the header + SECTION 1 (schema)**

```sql
-- supabase_ops_p2_auto_tickets.sql
-- OPERATIONS Phase 2 — auto-ticket flow (spec: docs/superpowers/specs/2026-08-27-ops-auto-ticket-flow-design.md).
-- Offline screen -> one ticket per station -> assign the depot's tech -> guarded
-- lifecycle (open -> in_progress -> resolved -> approved; cancelled for auto-recovered blips).
-- Additive to the Operations module (§230). Idempotent, re-runnable. Owner runs in Studio.
-- Sections: 1 schema · 2 engine · 3 guard RPCs · 4 WhatsApp dispatch (Task 8).
-- ═════════════════════════════════════════════════════════════════════════

-- ==== SECTION 1 · schema ====================================================
-- status gains 'approved'; source gains 'auto_offline'; add approver + down_count.
ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_status_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_status_check
  CHECK (status IN ('open','in_progress','resolved','approved','cancelled'));

ALTER TABLE public.ops_tickets DROP CONSTRAINT IF EXISTS ops_tickets_source_check;
ALTER TABLE public.ops_tickets ADD  CONSTRAINT ops_tickets_source_check
  CHECK (source IN ('manual','api_webhook','sales_request','auto_offline'));

ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.ops_tickets ADD COLUMN IF NOT EXISTS down_count  int;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Run the SQL structure lint**

Run: `bash scripts/check-sql-schema.sh supabase_ops_p2_auto_tickets.sql`
Expected: no structure error. (It may WARN about the missing `-- VERIFY` block — that's fine, the VERIFY block is added in Task 3; the DROP+ADD CONSTRAINT and ADD COLUMN IF NOT EXISTS are idempotent so no idempotency warning.)

- [ ] **Step 3: Logic self-review**

Confirm: the two `DROP CONSTRAINT IF EXISTS` names are the Postgres auto-generated inline-CHECK names (`ops_tickets_status_check`, `ops_tickets_source_check` — table_column_check is the default for an inline `CHECK` in `CREATE TABLE`). Both new CHECK sets are supersets of the originals (`open/in_progress/resolved/cancelled` + `approved`; `manual/api_webhook/sales_request` + `auto_offline`) so no existing row violates them. All three `ADD COLUMN` use `IF NOT EXISTS`.

- [ ] **Step 4: Commit**

```bash
git add supabase_ops_p2_auto_tickets.sql
git commit -m "Ops p2: ops_tickets schema for auto-ticket flow (approved status + approver + down_count)"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: the `git log` prints nothing (origin is up to date).

---

### Task 2: SQL engine — ops_reconcile_offline_tickets() (opens + auto-cancels + push)

**Files:**
- Modify: `supabase_ops_p2_auto_tickets.sql` (append SECTION 2).

- [ ] **Step 1: Append SECTION 2 (the engine) to the file**

```sql

-- ==== SECTION 2 · engine ====================================================
-- Called at the end of every aiadflux sync run (api/ops/sync.js), the cron, and
-- the /ops-admin "Record uptime" button. Per depot: open ONE auto-ticket if it
-- has offline screens and no open auto-ticket; auto-cancel an UNTOUCHED (open)
-- auto-ticket once the depot is fully back online. Never touches in_progress /
-- resolved / approved / manual / sales_request tickets. EXCEPTION-wrapped so a
-- reconcile failure can never break the sync.
CREATE OR REPLACE FUNCTION public.ops_reconcile_offline_tickets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d           record;
  v_down      int;
  v_ticket    uuid;
  v_row       int;
  v_opened    int := 0;
  v_cancelled int := 0;
BEGIN
  FOR d IN SELECT id, name, assigned_to FROM public.ops_depots WHERE is_active LOOP
    SELECT count(*) INTO v_down
      FROM public.ops_screens
     WHERE depot_id = d.id AND is_active AND status = 'offline';

    IF v_down > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.ops_tickets
         WHERE depot_id = d.id AND source = 'auto_offline'
           AND status IN ('open','in_progress')
      ) THEN
        INSERT INTO public.ops_tickets
          (type, source, status, depot_id, screen_id, issue_type_id,
           assigned_to, down_count, priority, opened_at)
        VALUES
          ('fault','auto_offline','open', d.id, NULL, NULL,
           d.assigned_to, v_down,
           CASE WHEN v_down >= 5 THEN 'high' ELSE 'normal' END, now())
        RETURNING id INTO v_ticket;
        v_opened := v_opened + 1;

        -- native push to the assigned tech (best-effort; enqueue_push is §96)
        IF d.assigned_to IS NOT NULL THEN
          BEGIN
            PERFORM public.enqueue_push(
              d.assigned_to,
              'New ticket',
              d.name || ' — ' || v_down || ' screen(s) offline',
              '/ops',
              'ops-ticket-' || v_ticket::text);
          EXCEPTION WHEN OTHERS THEN NULL; END;
        END IF;
      END IF;

    ELSE
      -- depot fully back online: cancel an UNTOUCHED auto-ticket (a blip)
      UPDATE public.ops_tickets
         SET status = 'cancelled',
             resolved_at = now(),
             notes = COALESCE(notes,'') || ' [auto-recovered]',
             updated_at = now()
       WHERE depot_id = d.id AND source = 'auto_offline' AND status = 'open';
      GET DIAGNOSTICS v_row = ROW_COUNT;
      v_cancelled := v_cancelled + v_row;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'cancelled', v_cancelled);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.ops_reconcile_offline_tickets() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ops_reconcile_offline_tickets() TO authenticated, service_role;
```

- [ ] **Step 2: Run the SQL structure lint**

Run: `bash scripts/check-sql-schema.sh supabase_ops_p2_auto_tickets.sql`
Expected: no structure error. (A known false-positive: `check-sql-schema.sh` flags PL/pgSQL record fields like `d.assigned_to` as "alias.column" — documented §72#15, not a real error. Ignore any such line.)

- [ ] **Step 3: Logic self-review**

Confirm: (a) `GET DIAGNOSTICS v_row = ROW_COUNT; v_cancelled := v_cancelled + v_row` accumulates across loop iterations (not overwrites). (b) The open-dedup checks `status IN ('open','in_progress')` so a still-down station never re-tickets and an in-progress ticket is respected. (c) The auto-cancel only touches `status='open'` (untouched) — a tech's `in_progress` ticket survives a flicker. (d) `enqueue_push` signature matches `enqueue_push(p_user_id, p_title, p_body, p_url, p_tag)` (verified in `db/functions/enqueue_push.sql:47`) and its call is EXCEPTION-wrapped. (e) The whole body is EXCEPTION-wrapped so the sync can't break.

- [ ] **Step 4: Commit**

```bash
git add supabase_ops_p2_auto_tickets.sql
git commit -m "Ops p2: ops_reconcile_offline_tickets engine (per-station open + auto-cancel + push)"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 3: SQL guards — the 4 lifecycle RPCs (start/resolve/approve/reject) + VERIFY

**Files:**
- Modify: `supabase_ops_p2_auto_tickets.sql` (append SECTION 3 + the file's VERIFY block).

- [ ] **Step 1: Append SECTION 3 (the guard RPCs) to the file**

```sql

-- ==== SECTION 3 · guarded lifecycle RPCs ====================================
-- All SECURITY DEFINER, fail-closed on NULL role (§41), verify the FROM-state so
-- a stale UI can't skip steps. "Screens still offline" = a live check against
-- ops_screens for the ticket's depot.

-- open -> in_progress (assigned tech OR head/admin)
CREATE OR REPLACE FUNCTION public.ops_ticket_start(p_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_assigned uuid; v_status text;
BEGIN
  SELECT assigned_to, status INTO v_assigned, v_status FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR NOT (v_role IN ('admin','co_owner','operation_head') OR (v_assigned IS NOT NULL AND v_assigned = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_status <> 'open' THEN RAISE EXCEPTION 'ticket is not open'; END IF;
  UPDATE public.ops_tickets SET status = 'in_progress', updated_at = now() WHERE id = p_ticket;
END $$;

-- in_progress -> resolved (assigned tech OR head/admin) — BLOCKED while offline
CREATE OR REPLACE FUNCTION public.ops_ticket_resolve(p_ticket uuid, p_cause text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_assigned uuid; v_status text; v_depot uuid;
BEGIN
  SELECT assigned_to, status, depot_id INTO v_assigned, v_status, v_depot FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR NOT (v_role IN ('admin','co_owner','operation_head') OR (v_assigned IS NOT NULL AND v_assigned = auth.uid())) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_status <> 'in_progress' THEN RAISE EXCEPTION 'ticket must be in progress to close'; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_screens WHERE depot_id = v_depot AND is_active AND status = 'offline') THEN
    RAISE EXCEPTION 'screens still offline — cannot close yet';
  END IF;
  UPDATE public.ops_tickets
     SET status = 'resolved', resolved_at = now(),
         cause = COALESCE(NULLIF(btrim(p_cause), ''), cause),
         notes = COALESCE(NULLIF(btrim(p_notes), ''), notes),
         updated_at = now()
   WHERE id = p_ticket;
END $$;

-- resolved -> approved (HEAD/admin only) — BLOCKED while offline
CREATE OR REPLACE FUNCTION public.ops_ticket_approve(p_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_status text; v_depot uuid;
BEGIN
  SELECT status, depot_id INTO v_status, v_depot FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin','co_owner','operation_head') THEN RAISE EXCEPTION 'head only'; END IF;
  IF v_status <> 'resolved' THEN RAISE EXCEPTION 'ticket must be resolved to approve'; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_screens WHERE depot_id = v_depot AND is_active AND status = 'offline') THEN
    RAISE EXCEPTION 'screens still offline — cannot approve';
  END IF;
  UPDATE public.ops_tickets SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_ticket;
END $$;

-- resolved -> in_progress (HEAD/admin only) — send back to the tech
CREATE OR REPLACE FUNCTION public.ops_ticket_reject(p_ticket uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text := public.get_my_role(); v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ops_tickets WHERE id = p_ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket not found'; END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin','co_owner','operation_head') THEN RAISE EXCEPTION 'head only'; END IF;
  IF v_status <> 'resolved' THEN RAISE EXCEPTION 'ticket must be resolved to reject'; END IF;
  UPDATE public.ops_tickets
     SET status = 'in_progress',
         notes = COALESCE(notes,'') || CASE WHEN p_reason IS NOT NULL AND btrim(p_reason) <> ''
                   THEN ' [rejected: ' || btrim(p_reason) || ']' ELSE ' [rejected]' END,
         updated_at = now()
   WHERE id = p_ticket;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'ops_ticket_start(uuid)','ops_ticket_resolve(uuid,text,text)',
    'ops_ticket_approve(uuid)','ops_ticket_reject(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ==== VERIFY (run this SELECT in Studio after the file) =====================
-- Expect: five_fns = 5 · statuses/sources include the new values · all four RPCs prosecdef=true.
-- SELECT
--   (SELECT count(*) FROM pg_proc WHERE proname IN
--      ('ops_reconcile_offline_tickets','ops_ticket_start','ops_ticket_resolve','ops_ticket_approve','ops_ticket_reject')) AS five_fns,
--   (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ops_tickets_status_check') AS status_check,
--   (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ops_tickets_source_check') AS source_check;
```

- [ ] **Step 2: Run the SQL structure lint**

Run: `bash scripts/check-sql-schema.sh supabase_ops_p2_auto_tickets.sql`
Expected: no structure error, VERIFY block now present. (Ignore the documented `alias.column` false-positives on `v_role`/`d.assigned_to` etc.)

- [ ] **Step 3: Logic self-review**

Confirm: (a) every RPC RAISEs on NULL role (`v_role IS NULL OR ...`) — fail-closed (§41). (b) `start`/`resolve` allow the assigned tech OR head/admin; `approve`/`reject` are head/admin ONLY. (c) `resolve` + `approve` both `RAISE` when `EXISTS(... status='offline')` for the ticket's depot (the guard). (d) each RPC verifies the current status equals the expected FROM-state. (e) all four are REVOKEd from PUBLIC/anon + GRANTed to authenticated (the internal role gate is the control; `enqueue_push` stays service_role via the engine).

- [ ] **Step 4: Commit**

```bash
git add supabase_ops_p2_auto_tickets.sql
git commit -m "Ops p2: guarded lifecycle RPCs (start/resolve/approve/reject) + VERIFY"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 4: Wire the engine into the sync

**Files:**
- Modify: `api/ops/sync.js` (add one best-effort rpc call after the uptime recompute, ~line 259).

- [ ] **Step 1: Add the reconcile call after the uptime recompute**

In `api/ops/sync.js`, find this block (currently ~line 255–259):

```js
  // 4 · recompute today's uptime (the Phase-4 pay signal) — best-effort
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_recompute_uptime_today`, { method: 'POST', headers: sbH, body: JSON.stringify({}) })
  } catch { /* Phase 4 SQL not run yet — statuses still synced */ }
```

Add immediately AFTER it:

```js
  // 5 · reconcile offline tickets (open/auto-cancel per station) — best-effort
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/ops_reconcile_offline_tickets`, { method: 'POST', headers: sbH, body: JSON.stringify({}) })
  } catch { /* Phase 2 SQL not run yet — statuses still synced */ }
```

- [ ] **Step 2: Parse-check**

Run: `node --check api/ops/sync.js`
Expected: no output (exit 0).

- [ ] **Step 3: Logic self-review**

Confirm: the call reuses `sbH` (the service-role headers already built in the handler) and the `${SUPABASE_URL}/rest/v1/rpc/...` shape (identical to the uptime call one line above). It's best-effort (try/catch) so a not-yet-run SQL or a reconcile error never fails the sync response.

- [ ] **Step 4: Commit**

```bash
git add api/ops/sync.js
git commit -m "Ops p2: call ops_reconcile_offline_tickets at end of each sync run"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 5: Frontend — OpsWorkV2 tech actions via the guarded RPCs

**Files:**
- Modify: `src/pages/v2/OpsWorkV2.jsx` (the ticket query ~line 191, the `setStatus` handler ~line 468, the resolve cause/notes save ~line 483, the ticket card render ~line 579–585).

- [ ] **Step 1: Add `source` to the ticket query**

In `src/pages/v2/OpsWorkV2.jsx`, the ticket `.select(...)` (~line 192) currently starts:
```js
          .select('id, type, status, priority, cause, notes, photo_path, opened_at, ' +
```
Change it to include `source, down_count`:
```js
          .select('id, type, status, source, down_count, priority, cause, notes, photo_path, opened_at, ' +
```

- [ ] **Step 2: Replace `setStatus` with the guarded RPC calls**

Find (~line 468):
```js
  async function setStatus(status) {
```
Replace the WHOLE function body so `in_progress` calls `ops_ticket_start` and `resolved` calls `ops_ticket_resolve` (folding the cause/notes save into the resolve RPC), surfacing the block error:

```js
  async function setStatus(status) {
    setBusy(true)
    try {
      let error
      if (status === 'in_progress') {
        ;({ error } = await supabase.rpc('ops_ticket_start', { p_ticket: tk.id }))
      } else if (status === 'resolved') {
        ;({ error } = await supabase.rpc('ops_ticket_resolve', {
          p_ticket: tk.id, p_cause: cause.trim() || null, p_notes: notes.trim() || null,
        }))
      }
      if (error) { toastError(error, t('save_failed', lang)); return }
      toastSuccess(t(status === 'resolved' ? 'st_resolved' : 'st_in_progress', lang))
      onChanged && onChanged()
    } finally { setBusy(false) }
  }
```

NOTE: this preserves the existing call sites `setStatus('in_progress')` and `setStatus('resolved')` (the buttons at ~line 579/583) and the existing `onChanged` refresh callback — check both exist in the component; if the refresh callback has a different name (e.g. `reload`, `onSaved`), use that name instead. The resolve RPC now saves `cause`/`notes` server-side, so the SEPARATE cause/notes save (the `saveNotes`/`.update({ cause, notes })` block ~line 483) becomes redundant for the resolve path — leave that block as-is (it's used for editing notes on an already-open ticket) unless it ONLY runs on resolve, in which case remove it.

- [ ] **Step 3: Add an "auto" chip when `source === 'auto_offline'`**

In the ticket card header render (near the ticket title / status chip, ~line 560–575), add a small chip so the tech knows it's system-generated. Find the ticket title element and add beside it:

```jsx
        {tk.source === 'auto_offline' && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
            background: 'var(--v2-tint-blue, rgba(59,130,246,.12))', color: 'var(--v2-blue, #3B82F6)' }}>
            {t('auto', lang)}
          </span>
        )}
```

Then add the `auto` label to `src/utils/opsStrings.js` STR table (gu-first per §231):
```js
  auto: { gu: 'ઓટો', en: 'Auto' },
```

- [ ] **Step 4: Parse-check + build**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/OpsWorkV2.jsx >/dev/null && echo OK`
Expected: `OK`.
Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built` (no error).

- [ ] **Step 5: Logic self-review**

Confirm: `toastError`/`toastSuccess`/`t` are already imported in the file (they are — used elsewhere in it). The RPC error path toasts the server message (e.g. "screens still offline — cannot close yet") so a blocked resolve is visible. The button call sites are unchanged (`setStatus('in_progress')`, `setStatus('resolved')`).

- [ ] **Step 6: Commit**

```bash
git add src/pages/v2/OpsWorkV2.jsx src/utils/opsStrings.js
git commit -m "Ops p2: tech Start/Resolve via guarded RPCs + auto chip on auto-tickets"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 6: Frontend — OpsHeadV2 "Awaiting approval" section (Approve/Reject)

**Files:**
- Modify: `src/pages/v2/OpsHeadV2.jsx` (add a `resolved` tickets query to `load()` ~line 89, add an `approvals` state ~line 65, add the Approve/Reject handlers near `reassignTicket` ~line 191, add the render section before the Tickets board ~line 407).

- [ ] **Step 1: Add the `approvals` state**

Near the other `useState` (~line 65, beside `const [tickets, setTickets] = useState([])`):
```js
  const [approvals, setApprovals] = useState([])
```

- [ ] **Step 2: Fetch resolved tickets in `load()`**

In the `Promise.all([...])` in `load()` (~line 86–94), the current ticket query is `.in('status', ['open', 'in_progress'])`. Add a SECOND query to the array for resolved tickets:
```js
        supabase.from('ops_tickets')
          .select('id, type, priority, assigned_to, down_count, resolved_at, cause, notes, ' +
                  'depot:ops_depots!ops_tickets_depot_id_fkey(id,name), ' +
                  'tech:users!ops_tickets_assigned_to_fkey(id,name)')
          .eq('status', 'resolved')
          .order('resolved_at', { ascending: true }),
```
Then destructure its result alongside the others and `setApprovals(<that>.data || [])`. (Match the existing destructuring style in `load()` — the other results use `tickRes` etc.; name this one `apprRes` and add `setApprovals(apprRes.data || [])`.)

- [ ] **Step 3: Add the Approve/Reject handlers**

Near `reassignTicket` (~line 191):
```js
  async function approveTicket(id) {
    const { error } = await supabase.rpc('ops_ticket_approve', { p_ticket: id })
    if (error) return toastError(error, 'Could not approve')
    toastSuccess('Approved'); load()
  }
  async function rejectTicket(id) {
    const reason = window.prompt('Reason for sending back to the tech (optional):') // simple v1
    if (reason === null) return
    const { error } = await supabase.rpc('ops_ticket_reject', { p_ticket: id, p_reason: reason || null })
    if (error) return toastError(error, 'Could not reject')
    toastSuccess('Sent back'); load()
  }
```
NOTE: `window.prompt` is a deliberate v1 shortcut on an ADMIN-only page (OpsHeadV2 is head/admin — not a rep-facing §26 surface, and not §28 frozen). If a nicer inline reason modal is wanted, that's a follow-up; do NOT block this task on it.

- [ ] **Step 4: Render the "Awaiting approval" section**

Immediately BEFORE the `{/* Tickets board — reassign a ticket */}` section (~line 407), add:
```jsx
      {/* Awaiting approval — resolved tickets the head signs off */}
      {approvals.length > 0 && (
        <div className="lead-card" style={{ marginTop: 16 }}>
          <div className="lead-card-head">
            <div><div className="lead-card-title">Awaiting approval</div>
              <div className="lead-card-sub">{approvals.length} resolved ticket(s) to sign off.</div></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="lead-table" style={{ width: '100%' }}>
              <thead><tr><th style={th}>Station</th><th style={th}>Tech</th><th style={th}>Cause</th><th style={th}>Resolved</th><th style={th}></th></tr></thead>
              <tbody>
                {approvals.map(a => (
                  <tr key={a.id}>
                    <td style={td}>{a.depot?.name || '—'}</td>
                    <td style={td}>{a.tech?.name || 'Unassigned'}</td>
                    <td style={td}>{a.cause || '—'}</td>
                    <td style={td}>{a.resolved_at ? new Date(a.resolved_at).toLocaleDateString('en-GB') : '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => approveTicket(a.id)} style={{ background: 'var(--success)', color: 'var(--accent-fg, #0f172a)', marginRight: 6 }}>Approve</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => rejectTicket(a.id)}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
```
NOTE: reuse the existing `th`/`td` style objects already defined in OpsHeadV2 (they're used by the Tickets board table). If the FK embed alias `users!ops_tickets_assigned_to_fkey` errors at runtime (a different constraint name), fall back to selecting `assigned_to` and mapping the tech name from the already-loaded `reps`/team list in the component — but the `ops_tickets_assigned_to_fkey` name matches the other embeds in this file, so it should resolve.

- [ ] **Step 5: Parse-check + build**

Run: `npx --yes esbuild --loader:.jsx=jsx --log-level=warning src/pages/v2/OpsHeadV2.jsx >/dev/null && echo OK`
Expected: `OK`.
Run: `npm run build 2>&1 | tail -3`
Expected: `✓ built`.

- [ ] **Step 6: Logic self-review**

Confirm: `toastError`/`toastSuccess` are imported in OpsHeadV2 (they are — used by `reassignDepot`/`reassignTicket`). The section self-hides when `approvals.length === 0`. Approve/Reject call the RPCs and `load()` on success (the guard errors — "screens still offline — cannot approve" — surface via `toastError`).

- [ ] **Step 7: Commit**

```bash
git add src/pages/v2/OpsHeadV2.jsx
git commit -m "Ops p2: head Awaiting-approval section (approve/reject via guarded RPCs)"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 7: WhatsApp Edge endpoint (sends the ticket-alert template)

**Files:**
- Create: `api/ops/ticket-wa.js` (Edge — the alert sender the engine POSTs to).

- [ ] **Step 1: Create the Edge endpoint**

```js
// api/ops/ticket-wa.js — send a WhatsApp ticket-alert template to a tech.
// Called by the DB engine via pg_net (Task 8). Edge (§219 12-Node cap — must NOT
// be a Node fn). Secret-gated with OPS_SYNC_SECRET (same as the sync). Best-effort.
export const config = { runtime: 'edge' }

export default async function handler(req) {
  const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
  if (req.method !== 'POST') return j({ error: 'method' }, 405)

  const secret = req.headers.get('x-ops-secret')
  const OPS_SECRET = process.env.OPS_SYNC_SECRET
  if (!OPS_SECRET || secret !== OPS_SECRET) return j({ error: 'forbidden' }, 403)

  const TOKEN = process.env.CAMPAIGN_WA_TOKEN
  const PNID  = process.env.OPS_WA_PHONE_NUMBER_ID  // the sending number's phone_number_id
  const TPL   = process.env.OPS_WA_TEMPLATE || 'ops_ticket_alert'
  if (!TOKEN || !PNID) return j({ ok: true, skipped: 'wa not configured' })

  let body = {}
  try { body = await req.json() } catch { return j({ error: 'bad json' }, 400) }
  const phone = String(body.phone || '').replace(/\D/g, '')
  const depot = String(body.depot || '').slice(0, 60)
  const count = String(body.count ?? '').replace(/\D/g, '') || '0'
  if (phone.length < 10) return j({ ok: true, skipped: 'no phone' })

  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PNID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: phone, type: 'template',
        template: { name: TPL, language: { code: 'gu' },
          components: [{ type: 'body', parameters: [
            { type: 'text', text: depot }, { type: 'text', text: count },
          ] }] },
      }),
    })
    const out = await r.json().catch(() => ({}))
    return j({ ok: r.ok, meta: out?.error?.message || out?.messages?.[0]?.id || null })
  } catch (e) { return j({ ok: false, error: String(e?.message || e).slice(0, 160) }) }
}
```

- [ ] **Step 2: Parse-check**

Run: `node --check api/ops/ticket-wa.js`
Expected: no output (exit 0).

- [ ] **Step 3: Logic self-review**

Confirm: Edge runtime (`config.runtime='edge'`, §219 — a Node fn would break every Vercel deploy). Secret-gated on `OPS_SYNC_SECRET` (already set, §241). Returns `{skipped}` (never errors) when `CAMPAIGN_WA_TOKEN` / `OPS_WA_PHONE_NUMBER_ID` are unset → the endpoint is inert until the owner configures WhatsApp. `phone` is digits-only; the template name + language (`gu`) + 2 body params ({{1}}=depot, {{2}}=count) match the template created in Task 8's script.

- [ ] **Step 4: Commit**

```bash
git add api/ops/ticket-wa.js
git commit -m "Ops p2: WhatsApp ticket-alert Edge endpoint (inert until configured)"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 8: WhatsApp — Meta template script + wire the engine's pg_net dispatch

**Files:**
- Create: `scripts/create-ops-ticket-template.py` (owner runs to create the Meta template).
- Modify: `supabase_ops_p2_auto_tickets.sql` (append SECTION 4: a `ops_ticket_wa_dispatch` fn + call it from the engine — a CREATE OR REPLACE of `ops_reconcile_offline_tickets`).

- [ ] **Step 1: Create the Meta template script**

```python
#!/usr/bin/env python3
# scripts/create-ops-ticket-template.py
# Creates the Gujarati UTILITY WhatsApp template 'ops_ticket_alert' on the
# marketing WABA. Owner runs with a FRESH Meta System User token (§119):
#   TOKEN='<fresh token>' python3 scripts/create-ops-ticket-template.py
# 2 body vars: {{1}} = station/depot name, {{2}} = number of screens down.
import json, os, urllib.request

WABA = '2870129030006085'  # marketing WABA (§119)
TOKEN = os.environ.get('TOKEN')
if not TOKEN:
    raise SystemExit('set TOKEN=<fresh Meta System User token>')

payload = {
    'name': 'ops_ticket_alert',
    'language': 'gu',
    'category': 'UTILITY',
    'components': [
        {'type': 'BODY',
         'text': 'નવી ટિકિટ: *{{1}}* — {{2}} સ્ક્રીન બંધ છે. ઍપ ખોલીને ટિકિટ જુઓ.',
         'example': {'body_text': [['આણંદ', '14']]}},
    ],
}
req = urllib.request.Request(
    f'https://graph.facebook.com/v21.0/{WABA}/message_templates',
    data=json.dumps(payload).encode(),
    headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
try:
    with urllib.request.urlopen(req) as r:
        print('OK', r.read().decode())
except urllib.error.HTTPError as e:
    print('ERR', e.code, e.read().decode())
```

- [ ] **Step 2: Append SECTION 4 to the SQL file — the WA dispatch fn + engine call**

Append to `supabase_ops_p2_auto_tickets.sql`:

```sql

-- ==== SECTION 4 · WhatsApp dispatch (fast-follow; inert until api/ops/ticket-wa live) ====
-- Fires a WhatsApp ticket-alert to the assigned tech via pg_net -> api/ops/ticket-wa.
-- The secret is PULLED from the live ops_aiadflux_sync_dispatch (§197 trick) so no
-- literal secret sits in this file. Best-effort; a failure never affects ticket creation.
CREATE OR REPLACE FUNCTION public.ops_ticket_wa_dispatch(p_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp, extensions AS $$
DECLARE
  v_phone text; v_depot text; v_count int; v_secret text; v_url text;
BEGIN
  SELECT u.whatsapp_number, d.name, t.down_count
    INTO v_phone, v_depot, v_count
    FROM public.ops_tickets t
    JOIN public.ops_depots  d ON d.id = t.depot_id
    LEFT JOIN public.users  u ON u.id = t.assigned_to
   WHERE t.id = p_ticket;
  IF v_phone IS NULL OR length(regexp_replace(v_phone, '\D', '', 'g')) < 10 THEN RETURN; END IF;

  -- pull the ops secret + build the endpoint url from the live sync-dispatch fn
  v_secret := substring(pg_get_functiondef('public.ops_aiadflux_sync_dispatch()'::regprocedure)
                        FROM 'x-ops-secret''\s*,\s*''([^'']+)''');
  v_url    := substring(pg_get_functiondef('public.ops_aiadflux_sync_dispatch()'::regprocedure)
                        FROM 'https://[^'']+/api/ops/sync');
  IF v_secret IS NULL OR v_url IS NULL THEN RETURN; END IF;
  v_url := replace(v_url, '/api/ops/sync', '/api/ops/ticket-wa');

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-ops-secret', v_secret),
    body := jsonb_build_object('phone', v_phone, 'depot', v_depot, 'count', COALESCE(v_count,0)));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

REVOKE ALL ON FUNCTION public.ops_ticket_wa_dispatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_ticket_wa_dispatch(uuid) TO service_role;
```

Then, in the SAME file, add ONE line to the engine (SECTION 2) so `ops_reconcile_offline_tickets` fires the WA dispatch right after the push. Change the push block inside the engine's INSERT branch from ending at the push `END IF;` to also call the WA dispatch. Locate (in SECTION 2):

```sql
        END IF;
      END IF;
```
(the first `END IF;` closes the `IF d.assigned_to IS NOT NULL` push block; the second closes the `IF NOT EXISTS` open block). Insert the WA dispatch call BETWEEN them:

```sql
        END IF;
        BEGIN
          PERFORM public.ops_ticket_wa_dispatch(v_ticket);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
```

- [ ] **Step 3: Run the SQL structure lint + node check**

Run: `bash scripts/check-sql-schema.sh supabase_ops_p2_auto_tickets.sql`
Expected: no structure error (ignore the documented `alias.column` false-positives, and the `net.http_post` / dotted-URL literal false-positives — §72#15/§212).
Run: `python3 -c "import ast; ast.parse(open('scripts/create-ops-ticket-template.py').read()); print('OK')"`
Expected: `OK`.

- [ ] **Step 4: Logic self-review**

Confirm: (a) `ops_ticket_wa_dispatch` returns early when the tech has no `whatsapp_number` (§197 column). (b) The secret + base URL are PULLED from `ops_aiadflux_sync_dispatch` (§241 fn) via `pg_get_functiondef` regex — no literal secret in the file. (c) It's REVOKEd from all client roles + GRANTed service_role only (the engine, a DEFINER owned by postgres, reaches it). (d) The engine calls it best-effort (EXCEPTION-wrapped) so a WA failure never blocks ticket creation. (e) `search_path` includes `extensions` (where `net.http_post` lives). (f) The template name (`ops_ticket_alert`), language (`gu`), and 2 body params match `api/ops/ticket-wa.js` (Task 7) and the Python script.

- [ ] **Step 5: Commit**

```bash
git add supabase_ops_p2_auto_tickets.sql scripts/create-ops-ticket-template.py
git commit -m "Ops p2: WhatsApp ticket-alert template script + engine pg_net dispatch"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

---

### Task 9: Owner run-list + acceptance smoke + CLAUDE.md §243

**Files:**
- Modify: `CLAUDE.md` (append §243 per the §93 standing rule).

- [ ] **Step 1: Append the §243 record to CLAUDE.md**

Append a `## 243 · Operations auto-ticket flow (2026-08-27)` section capturing: the spec link, the state machine, the engine/RPCs/alerts, the frozen contracts (per-station dedup, the CMS guards on resolve+approve, the auto-cancel-if-untouched rule, source='auto_offline'), the owner run-list below, and any foot-guns (e.g. the constraint-name assumption in Task 1; the WA template must be Active before the SQL's dispatch is useful — but it's inert/skipped until then, no hazard).

- [ ] **Step 2: Commit the doc**

```bash
git add CLAUDE.md
git commit -m "docs: §243 Operations auto-ticket flow"
git push origin untitled-os && git log origin/untitled-os..HEAD --oneline
```
Expected: empty `git log`.

- [ ] **Step 3: OWNER run-list (hand to the owner — not an engineer step)**

1. **Run the SQL** — paste `supabase_ops_p2_auto_tickets.sql` into Supabase Studio (ONE file, all 4 sections). Then run the VERIFY SELECT at the bottom → expect `five_fns = 5` and both CHECK defs listing the new values.
2. **Frontend** is already deployed (Vercel auto-deploys the push). The tech `/ops` + head `/ops-dashboard` pick up the new flow on next app open.
3. **WhatsApp (optional, fast-follow)** — create the template: `TOKEN='<fresh Meta token>' python3 scripts/create-ops-ticket-template.py` → wait for `ops_ticket_alert` to show **Active** in WhatsApp Manager. Set Vercel env `OPS_WA_PHONE_NUMBER_ID` (the marketing number's phone_number_id, `1209093615625212` §119) — `CAMPAIGN_WA_TOKEN` + `OPS_SYNC_SECRET` are already set. Put each tech's number in `users.whatsapp_number` (§197 column). Until this is done the WA alert is silently skipped; in-app + push work regardless.
4. **Depot → tech** — assign each depot to a tech (head console `/ops-dashboard` → Screens by station → Assigned tech, §240) so auto-tickets auto-assign. Unassigned depots open unassigned tickets the head assigns.

- [ ] **Step 4: ACCEPTANCE smoke (owner, in Studio + the app)**

- **Auto-open**: pick a depot with an assigned tech; set its screens offline —
  `UPDATE public.ops_screens SET status='offline' WHERE depot_id = '<depot>' AND is_active;`
  then `SELECT public.ops_reconcile_offline_tickets();` → expect `{"opened":1,"cancelled":0}`. Confirm one `open` `source='auto_offline'` ticket assigned to the depot's tech: `SELECT status, source, assigned_to, down_count FROM ops_tickets WHERE depot_id='<depot>' ORDER BY created_at DESC LIMIT 1;`
- **Dedup**: run `SELECT public.ops_reconcile_offline_tickets();` again → `{"opened":0}` (no duplicate).
- **Auto-cancel (blip)**: `UPDATE ops_screens SET status='online' WHERE depot_id='<depot>';` then reconcile → the UNTOUCHED ticket goes `cancelled`. (Re-offline + reconcile to make a fresh one, then `SELECT public.ops_ticket_start('<ticket>');` before flipping online → it now STAYS.)
- **Resolve guard**: with screens still offline, in the app tap Mark Resolved on the tech's `/ops` → expect the toast "screens still offline — cannot close yet". Flip all online (`UPDATE ... status='online'`) → Resolve succeeds.
- **Approve guard**: as the head on `/ops-dashboard` → Awaiting approval → Approve. With a screen offline it blocks; all-online it moves to `approved`.
- **Role gate**: as a NON-head, `SELECT public.ops_ticket_approve('<ticket>');` → `ERROR: head only`.
- **App surfaces**: the ticket shows an "Auto" chip in the tech queue; the head sees it in Awaiting approval; the Station board (`/ops-station`) "Open issues" KPI + screen-wall reflect it.

---

## Self-Review

**Spec coverage** — every spec section maps to a task: §1 schema → Task 1; §2 engine → Task 2 (+ wired Task 4); §3 guard RPCs → Task 3; §4 alerts (in-app → Tasks 5/6, push → Task 2, WhatsApp → Tasks 7/8); §5 where-it-shows → Tasks 5/6 (+ Station board §242 already reads ops_tickets, no change); RLS → existing Phase-0 policies (noted, no new policy); edge cases → covered by the engine (dedup, auto-cancel, no-tech) + guards; testing → Task 9 acceptance smoke; build order → Tasks 1–8 in order; owner deps → Task 9 run-list. No gap.

**Placeholder scan** — no TBD/TODO. Every code step has complete code. The two "NOTE" callouts (OpsWorkV2 refresh-callback name, OpsHeadV2 FK-alias fallback) are explicit contingency instructions with the concrete fallback stated, not placeholders — they exist because the exact local variable name can only be confirmed when the engineer opens the file, and the fallback is spelled out.

**Type/name consistency** — `ops_reconcile_offline_tickets` / `ops_ticket_start` / `ops_ticket_resolve` / `ops_ticket_approve` / `ops_ticket_reject` / `ops_ticket_wa_dispatch` are spelled identically in the SQL, the sync fetch (Task 4), the frontend `supabase.rpc(...)` calls (Tasks 5/6), and the VERIFY block. The RPC param names (`p_ticket`, `p_cause`, `p_notes`, `p_reason`) match between the SQL definitions and the `supabase.rpc('...', { p_... })` calls. `source='auto_offline'`, `status='approved'`, `down_count`, `approved_by`, `approved_at` are consistent across schema, engine, guards, and frontend queries. The template name `ops_ticket_alert` + language `gu` + 2 body params match across the Python script, the Edge endpoint, and the SQL dispatch.
