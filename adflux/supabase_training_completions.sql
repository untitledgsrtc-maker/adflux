-- Training completions — "who finished the guided tour" record.
-- Additive + inert: no existing table/flow touched (§45). The SalesTourOverlay
-- writes ONE upsert here when a rep finishes the whole tour; the owner reads it
-- to see which reps completed training. Per-device localStorage still works
-- independently, so the app is unaffected until this table exists.

create table if not exists public.training_completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  track        text not null,                      -- 'sales' now; 'tc' / 'ops' later
  completed_at timestamptz not null default now(),
  unique (user_id, track)                          -- one completion per rep per track
);

alter table public.training_completions enable row level security;

-- A rep records + reads only their OWN completion.
drop policy if exists training_completions_self_write on public.training_completions;
create policy training_completions_self_write on public.training_completions
  for insert with check (user_id = auth.uid());

-- Rep sees own; admin / co_owner see everyone (so the owner can see who finished).
drop policy if exists training_completions_read on public.training_completions;
create policy training_completions_read on public.training_completions
  for select using (
    user_id = auth.uid()
    or public.get_my_role() in ('admin', 'co_owner')
  );

notify pgrst, 'reload schema';

-- ============================================================================
-- VERIFY (run after the CREATE):
--   select count(*) as rls_policies from pg_policies where tablename = 'training_completions';
--   -- expect 2
--
-- WHO FINISHED (owner runs anytime, admin/co_owner only):
--   select u.name, tc.track, tc.completed_at
--     from public.training_completions tc
--     join public.users u on u.id = tc.user_id
--    order by tc.completed_at desc;
-- ============================================================================
