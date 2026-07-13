# Claim graph — build increment sketch

The next increment after Level 1: make the dependency graph between claims real, with one
producer, one consumer, and the guardrail between them. Everything here is additive; the
Day-0 `traces` columns are untouched.

## Why this increment

The brief's load-bearing refinement says triage rank is roughly doubt times downstream
stakes, which requires knowing what consumes each claim. Today nothing consumes anything,
so the graph is a theory. One second loop that ingests the money check-in's verified
claims makes the edge, the stakes gradient, and the boundary checkpoint all concrete, and
gives the fleet view its first real exposure computation.

## The capture rule

Edges are captured at consumption time, by the consumer, as evidence. The producer cannot
know its future consumers, and inferring edges after the fact injects guesswork into the
one system whose job is tracking doubt. When a loop ingests a claim, that ingestion is a
hop, and the existing working rule already forces every hop to trace before proceeding.
Provenance is therefore written backward at the moment of reading; forward lineage is
computed by inverting the edge set at query time, never stored as a forward pointer.

## Increment A: claim identity

A claim must be addressable before anything can point at it. `analyze_recurring` mints a
`claim_id` (uuid) on each entry in `price_changes` at write time, and `verify_findings`
carries the same id through each result. No change to the `traces` table: ids live inside
the jsonb the hops already store. `lib/fleet.ts` picks the ids up for free since it reads
the same blobs.

## Increment B: `claim_edges` and `readClaims()`

Migration `0003_claim_edges.sql`, additive: `id`, `claim_id`, `producer_run_id`,
`consumer_run_id`, `consumer_step_index`, `claim_confidence_at_read` (verbatim snapshot),
`tripped` (boolean), `created_at`. Read RLS like the other tables; writes server-side
only.

`lib/claims.ts` exposes `readClaims(consumerRunId, stepIndex, filter)`: it fetches
verified claims from trace rows, writes one edge row per claim BEFORE returning them, and
throws on failure, mirroring `writeTrace`. The companion working rule: no hop may consume
another run's claim except through `readClaims()`. An untraced read is the side channel
where doubt gets stripped, the same completeness argument that justifies `writeTrace`.

## Increment C: stakes declaration

Each run opens with a `plan` hop whose `tool_input` records the loop's declared stakes
and its tool manifest. Stakes are partly derived rather than trusted: a loop whose
manifest includes outbound or irreversible actions gets a floor of `acts`, a read-only
manifest floors at `observes`. Three tiers are enough for now: `observes`, `recommends`,
`acts`. Because the declaration is a hop, it needs no new table, and the fleet roll-up
can read it from the run's first row.

## Increment D: the consumer loop

`cancellation-drafter`: a second agent loop that calls `readClaims()` for verified price
increases, decides which subscriptions are worth cancelling against a monthly budget
threshold, and drafts the cancellation email. Declared stakes `recommends` (it drafts,
a human sends). It is deliberately boring, thirty lines of tools like the first three;
its whole purpose is to be downstream.

## Increment E: the guardrail

The checkpoint lives inside `readClaims()`, because the edge write is the boundary
crossing. If a claim's doubt is undischarged (per the `rollUpRun` rules: hedged and
unresolved, unverified, or no confidence stated) and the consumer's declared stakes
exceed the producer's, the edge row is written with `tripped = true`, the claim is
withheld from the returned set, and the consumer's hop records the withholding in its
trace. The fleet overview surfaces tripped edges in the needs-you group with the reason
"shaky claim feeding a higher-stakes loop". Approving the run releases the claim: the
consumer re-reads, the new edge writes clean.

## What Level 1 gains

Exposure: for each needs-you run, walk its claims' outbound edges and rank by doubt times
the max stakes of any consuming run. A hedged claim nothing consumes stays low; the same
claim feeding the drafter jumps the queue. Drill-down gains a forward-lineage strip on
the run view: what this run's claims went on to touch.

## The inheritance rule

A claim derived from other claims inherits the minimum confidence of its inputs until
something re-verifies it. Without this, a chain of confident restatements launders a
hedge away one hop at a time, which is the Vincennes failure rebuilt out of honest parts.
The graph exists precisely so this floor is computable.

## Out of scope

Multi-process orchestration, queues or message buses, cross-project claims, and any UI
for authoring guardrail policy. One producer, one consumer, one checkpoint, all in this
repo's existing run-a-loop-via-route machinery.
