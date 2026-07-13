-- Claim graph — consumption edges (increment B, see design/claim-graph-increment.md)
-- ADDITIVE ONLY: the Day-0 `traces` columns are untouched. One row per claim a consumer
-- ingested, written by the CONSUMER at read time via readClaims() — the producer cannot
-- know its future consumers, and inferred edges would be guesswork posing as evidence.
-- Forward lineage ("what did this claim go on to affect?") is computed by querying these
-- backward edges in reverse, never stored as a forward pointer.

create table claim_edges (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null,
  producer_run_id uuid not null,
  consumer_run_id uuid not null,
  consumer_step_index int not null,
  -- The producer's confidence verbatim, snapshotted at the moment of the read, so the
  -- edge preserves what the consumer knew when it consumed. Doubt travels with the claim.
  claim_confidence_at_read text,
  -- Guardrail flag (increment E): true when the boundary checkpoint withheld this claim.
  tripped boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists claim_edges_claim_id_idx     on claim_edges (claim_id);
create index if not exists claim_edges_producer_idx     on claim_edges (producer_run_id);
create index if not exists claim_edges_consumer_idx     on claim_edges (consumer_run_id);
create index if not exists claim_edges_created_at_idx   on claim_edges (created_at desc);

-- Writes happen server-side with the service role; the fleet overview reads with the
-- anon key to compute exposure, so expose read-only access like traces and reviews.
alter table claim_edges enable row level security;

drop policy if exists "claim_edges_read_all" on claim_edges;
create policy "claim_edges_read_all"
  on claim_edges for select
  using (true);
