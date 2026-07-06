-- Loop Visibility — trace schema
-- One row per agent hop. A "run" is one full loop; hops within a run share run_id
-- and are ordered by hop_index. Sub-agent hops reference their caller via parent_id.

create extension if not exists "pgcrypto";

create table if not exists public.traces (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,
  parent_id   uuid references public.traces (id) on delete cascade,
  hop_index   integer not null,
  agent       text not null,
  event       text not null default 'step',   -- e.g. llm_call | tool_call | decision | handoff
  status      text not null default 'ok',      -- ok | error | pending
  input       jsonb,
  output      jsonb,
  error       text,
  latency_ms  integer,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists traces_run_id_idx     on public.traces (run_id);
create index if not exists traces_run_hop_idx     on public.traces (run_id, hop_index);
create index if not exists traces_parent_id_idx   on public.traces (parent_id);
create index if not exists traces_created_at_idx  on public.traces (created_at desc);

-- RLS: writes happen server-side with the service role (which bypasses RLS).
-- Reads for the viewer go through the anon key, so expose read-only access.
alter table public.traces enable row level security;

drop policy if exists "traces_read_all" on public.traces;
create policy "traces_read_all"
  on public.traces for select
  using (true);
