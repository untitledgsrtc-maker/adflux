# Workspace backup (mirror of files that live OUTSIDE the git repo)

Made 16 Oct 2026 so a new computer needs no file copied by hand. These are COPIES; the live ones are one level above the repo
(the folder that contains `Untitled/`). After editing a live file, copy it here and commit.

| Here | Lives at (workspace root) |
|---|---|
| `workspace-CLAUDE.md` | `CLAUDE.md` (the old owner rules, sections 1-33) |
| `AGENTS.md`, `PHASE_33_BUILD_STATUS.md`, `SALES_REDESIGN_PROPOSAL.md`, `SALES_STRUCTURE.md` | same names |
| `mcp.json` | `.mcp.json` (its `cwd` is an old path: fix it for the new folder) |
| `workspace-gitignore.txt` | `.gitignore` |
| `claude-dot-dir/` (agents, skills, settings.json, launch.json) | `.claude/` |
| `memory/` | `~/.claude/projects/<folder-path-with-dashes>/memory/` (Claude's saved notes about the owner) |

Restore: copy each item back to the place in the right-hand column.
Secrets are NOT stored here (checked: no keys, tokens or passwords).
