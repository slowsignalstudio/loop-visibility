-- Loop Visibility — trace schema (Day 0)
-- One row per hop. The viewer can only ever show what this table preserves, so every
-- hop stores its EVIDENCE (tool_input / tool_output) next to its VERDICT
-- (model_confidence / verification) from the first run.

create table traces (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  step_index int not null,
  phase text not null,
  tool_name text,
  tool_input jsonb,
  tool_output jsonb,
  model_confidence text,
  verification jsonb,
  created_at timestamptz default now()
);

-- Supporting objects (not part of the core shape, but needed to run the viewer).
create index if not exists traces_run_id_idx    on traces (run_id);
create index if not exists traces_run_step_idx  on traces (run_id, step_index);
create index if not exists traces_created_at_idx on traces (created_at desc);

-- Writes happen server-side with the service role (bypasses RLS). Expose read-only
-- access so a future anon-key viewer can read.
alter table traces enable row level security;

drop policy if exists "traces_read_all" on traces;
create policy "traces_read_all"
  on traces for select
  using (true);

-- Realtime: add the table to the supabase_realtime publication so the viewer can stream
-- inserts. Guarded so re-running is a no-op. (If the table already existed before this
-- line was added, run just this block in the SQL editor to light realtime up.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'traces'
  ) then
    alter publication supabase_realtime add table traces;
  end if;
end $$;
