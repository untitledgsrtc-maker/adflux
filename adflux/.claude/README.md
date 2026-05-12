# .claude/ — Hook and Subagent Layer

Phase 33Y → 33Z. Two layers that make the Phase 33 mistake pattern
impossible to repeat.

## Files

```
.claude/
├── README.md                ← you are here
├── settings.json            ← registers hooks with Claude Code / Cowork
├── hooks/
│   ├── PreToolUse.sh        ← before Write/Edit · blocks brand violations
│   ├── PostToolUse.sh       ← after Write/Edit · schema check + esbuild parse
│   └── SessionStart.sh      ← new session · loads git state + schema columns
└── agents/
    ├── code-reviewer.md     ← reviews proposed changes (read-only)
    ├── test-runner.md       ← runs validation scripts (esbuild + schema check)
    └── explorer.md          ← fast "where is X" lookups
```

## How they fit together

```
   ┌──────────────────────────────────────────────────────────┐
   │  New Claude session starts                               │
   │  └─→ SessionStart.sh primes context with:                │
   │       • git status + last 5 commits + pending push       │
   │       • schema columns for 6 critical tables             │
   └──────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Main Claude works in the repo                           │
   │  ├─→ Needs to find something fast?                       │
   │  │   └─→ delegate to `explorer` subagent                 │
   │  ├─→ About to Write/Edit?                                │
   │  │   └─→ PreToolUse.sh runs (blocks brand violations)    │
   │  └─→ Just finished a Write/Edit?                         │
   │      └─→ PostToolUse.sh runs (schema + esbuild check)    │
   └──────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Before committing                                       │
   │  ├─→ delegate to `code-reviewer` subagent                │
   │  │   └─→ returns PASS or FAIL with line numbers          │
   │  ├─→ delegate to `test-runner` subagent                  │
   │  │   └─→ returns PASS or FAIL per file                   │
   │  └─→ Only commit if both PASS                            │
   └──────────────────────────────────────────────────────────┘
```

## Pre-commit checklist (the contract)

The main Claude agent MUST run this sequence before any `git commit`:

1. **`code-reviewer`** — verifies CLAUDE.md compliance, brand
   tokens, foot-gun patterns. Returns PASS or FAIL.
2. **`test-runner`** — runs `scripts/check-sql-schema.sh` on SQL
   files and `scripts/check-jsx-brand.sh` + esbuild parse on JSX.
   Returns PASS or FAIL per file.
3. **Only commit if both PASS.** If either FAILs, fix the issues
   and re-run the subagents. Do not commit on a FAIL.

This is documented in `CLAUDE.md §15`.

## Why two layers?

| Layer | Trigger | Purpose |
|---|---|---|
| Hooks (PreToolUse / PostToolUse) | Per-file as Claude writes | Cheap, immediate, blocks the obvious mistakes |
| Subagents (code-reviewer / test-runner) | Pre-commit, batched | Holistic review across all changed files at once |

Hooks catch each individual brand violation. Subagents catch
patterns across files (e.g., "this PR adds 3 routes but only 2
are nav-registered").

## Subagent invocation

The main Claude agent calls subagents via the `Task` tool with
`subagent_type` set to one of: `code-reviewer`, `test-runner`,
`explorer`.

Each subagent runs in its own context window — what they read
doesn't pollute the main agent's context. They return a single
summary block when done.

**Subagents can't spawn subagents.** No infinite recursion.

## When NOT to call a subagent

- Trivial in-conversation questions ("what is JSX?") — answer directly
- Single-file lookups Claude can do with one Grep — just Grep
- Anything that would take less time inline than the round trip

The cost of delegation is real (~5-10s of latency). Use subagents
for parallel work or context isolation, not for every read.

## Manual run (without Claude)

```bash
bash scripts/check-sql-schema.sh path/to/migration.sql
bash scripts/check-jsx-brand.sh src/pages/v2/Foo.jsx
bash .claude/hooks/SessionStart.sh    # prints schema summary
```

## Adding a new agent

1. Create `.claude/agents/<name>.md` with frontmatter:
   ```
   ---
   name: <name>
   description: <when to use this agent>
   tools: Read, Grep, Glob, Bash    (or whichever)
   model: sonnet
   ---
   ```
2. Body is the system prompt for that agent.
3. Document it in this README + reference in CLAUDE.md.
4. Test by invoking it on a known input.

## Adding a new denylist entry to check-sql-schema.sh

When you discover a new "looks-like-a-column-but-isn't" pattern:

```bash
# Edit scripts/check-sql-schema.sh, append to DENY array:
DENY=(
  ...existing entries...
  "new_bad_col|where_it_should_be_instead"
)
```

Then commit with a `Phase {N}.checker: add denylist entry for X` message.

