-- Fleet supervisor — review decisions (Level 1)
-- ADDITIVE ONLY: the Day-0 `traces` columns are untouched. One row per supervisor
-- decision on a run, so approving or clearing leaves a defensible, shareable record of
-- why (brief, job 9). A run's review state is its most recent row here.

create table reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected', 'cleared_safe')),
  rationale text,
  created_at timestamptz default now()
);

create index if not exists reviews_run_id_idx on reviews (run_id);
create index if not exists reviews_created_at_idx on reviews (created_at desc);

-- Writes happen server-side with the service role; the fleet overview reads with the
-- anon key, so expose read-only access like traces.
alter table reviews enable row level security;

drop policy if exists "reviews_read_all" on reviews;
create policy "reviews_read_all"
  on reviews for select
  using (true);
