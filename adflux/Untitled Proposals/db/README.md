# Untitled Proposals — Database

Postgres / Supabase schema for the Untitled Proposals app.

## Run order

Apply migrations top-down in the Supabase SQL Editor. Each migration is idempotent (uses `if not exists`) so re-running won't break anything, but order matters because later migrations reference earlier objects.

```
001_core_tables.sql       Users, team_members, clients, contacts, media_types, helpers
002_masters.sql           GSRTC stations, auto_districts, auto_rate_master, rate_type enum
003_proposals.sql         proposal_status enum, ref_no_counters, proposals, line_items,
                          attachments, versions, followups, expire_stale_proposals()
004_receipts.sql          proposal_receipts (with TDS auto-compute + rollup trigger)
005_pnl_and_audit.sql     proposal_pnl, monthly_admin_expenses, P&L views,
                          pnl_access_log, audit_log
006_rls_policies.sql      Row-level security on every table; RPC grants
007_seed_data.sql         Media types, 20 GSRTC stations, 33 districts, DAVP rate,
                          sample team_member (Brijesh as default signer)
```

## Role model (4 roles)

| Role | Operational data | P&L view | P&L edit | Admin expenses | User mgmt | Receipt delete |
|------|-----|-----|-----|-----|-----|-----|
| `owner` (Brijesh) | RW | yes | yes | yes (RW) | yes | yes (with reason) |
| `co_owner` (Vishal) | RW | yes | no | yes (read only) | no | no |
| `admin` | RW | no | no | no | no | no |
| `user` | read only | no | no | no | no | no |

## Sensitive surfaces

- **P&L data** → owner+co_owner read, owner-only write, plus TOTP step-up enforced in the API. Every access is logged to `pnl_access_log`.
- **Receipt deletion** → owner-only via `soft_delete_receipt(id, reason)` RPC. Reason is mandatory (≥5 chars). Soft-delete only; hard delete is denied at the RLS layer.
- **Admin expenses** → owner-only writes. co_owner can see them.

## Atomic ref numbers

`next_ref_number(series, media_code, financial_year)` — SECURITY DEFINER, `INSERT … ON CONFLICT` so two concurrent callers can't collide on the same number. Series:
- `PROPOSAL` × media_code (`AUTO`, `GSRTC`) × FY → `UA/AUTO/2026-27/0001`
- `RECEIPT` × `RV` × FY → `UA/RV/2026-27/0001`

## Indian financial year

`fy_for_date(d)` returns `'2026-27'` for any date between 2026-04-01 and 2027-03-31. Used by the consolidated P&L view `v_pnl_summary_fy` to roll up by FY.

## Auto-expiry

`expire_stale_proposals()` returns the number of rows it expired. Schedule via Supabase pg_cron daily; transitions `SENT → EXPIRED` if no follow-up activity in `expire_after_days` (default 120, per-proposal override).

## Triggers (high-level)

- `proposal_receipts` insert/update → recompute proposal payment rollup → maybe transition status (`WON → PARTIAL_PAID → PAID`).
- `proposal.status → WON` → auto-create `proposal_pnl` row (idempotent).
- `proposal.status` change → audit_log entry.
- `proposal_receipts.deleted_at` set → audit_log entry with reason.
- Any update to proposal payment totals → sync `proposal_pnl` revenue snapshot (unless P&L is finalized).

## Append-only tables

`pnl_access_log` and `audit_log` have NO update/delete RLS policies. The only writers are SECURITY DEFINER functions/triggers. Reads are gated to owner (P&L log) and owner+co_owner (audit log).
