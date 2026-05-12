# .claude/ — Claude Code / Cowork hooks

Phase 33Y. Hook layer for catching the schema-assumption mistakes
that cost ~4 hours of round-tripping in Phase 33.

## What this is

Three shell scripts that Claude Code / Cowork can run automatically:

| Hook | When | What it catches |
|---|---|---|
| `hooks/PreToolUse.sh`   | Before Write / Edit / MultiEdit | JSX brand violations (#facc15 / #0a0e1a) |
| `hooks/PostToolUse.sh`  | After Write / Edit / MultiEdit  | SQL column references that don't exist + esbuild parse errors on JSX |
| `hooks/SessionStart.sh` | New Claude session              | Loads git status + recent commits + schema column summary |

`settings.json` registers them with Claude Code / Cowork.

## Manual run

Even without Claude auto-invocation, you can run the checks yourself:

```bash
bash scripts/check-sql-schema.sh supabase_phase33h_ta_module.sql
bash scripts/check-jsx-brand.sh src/pages/v2/MasterV2.jsx
```

## The 6 bugs this catches

From Phase 33's painful session:

1. `quotes.valid_until` — never existed
2. `quotes.ref_number`  — never existed
3. `payments.recorded_by` — actual column is `received_by`
4. `leads.next_follow_up_at` — data lives in `follow_ups` table
5. `users.email NOT NULL` — assumed nullable on inserts
6. `next_workday(timestamp)` — signature mismatch (was `date`)

The `check-sql-schema.sh` grep would have caught #1-4.
The `PostToolUse` esbuild parse-check would have caught Phase 11d's
TDZ crash on `checklist`.

## Limitations

* Schema check is grep-based — false positives possible on aliased
  joins. When in doubt, override with a comment in the SQL file.
* Brand check only looks for `#facc15` and `#0a0e1a`. Other hardcoded
  hex values pass. Add to `scripts/check-jsx-brand.sh` if more
  rules emerge.
