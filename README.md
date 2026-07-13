# Loop Visibility

A working answer to one question: **how does a human supervise a fleet of agents without
either rubber-stamping their work or becoming the bottleneck?**

It starts as a trace viewer — every hop an agent takes writes a row to Supabase *before*
anything renders, so what the UI shows is provably what happened — and grows into a
three-level fleet supervisor built on one rule: **trust attaches to the claim, not the
agent.** Confidence and evidence travel with every claim to every level; no summary is
allowed to strip the doubt out of what it summarizes.

## What's here

**Two real agent loops** (Anthropic API, tool use, Claude Sonnet):

- **money-check-in** (`/api/run`) — finds subscription price increases in a committed
  synthetic dataset. Three tools, one per phase: gather (`lookup_transactions`), act
  (`analyze_recurring`), verify (`verify_findings`). The dataset plants three real
  increases and one trap — AWS, whose charges vary because it's usage-metered — so the
  verify step visibly reverses a false positive, and the model's own hedge about it is
  stored verbatim in `model_confidence`.
- **cancellation-drafter** (`/api/draft`) — consumes the first loop's *verified* claims
  and drafts a cancellation email to keep the added monthly cost under a limit. It
  exists to make the dependency graph real: one loop's output is another loop's input.

**Three supervision levels** over the same trace store:

1. **Fleet overview** (`/`) — every run rolled up to a trust signal derived from its
   claims, triaged into *needs you* vs *safe*. A run is safe only when every doubt
   raised inside it was **discharged with evidence** — a hedge that verify resolved, a
   false positive it reversed. Undischarged doubt (an unverified claim, a hedge nothing
   checked, a missing confidence) routes the run to the supervisor with the reason
   printed on the row. The safe majority clears in one action, one review row per run.
2. **Run drill-down** (`/run/<id>`) — the hop trace: each step's evidence
   (`tool_input`/`tool_output`) rendered beside its verdict
   (`model_confidence`/`verification`), including the evidence cards that show the raw
   monthly charges contradicting or confirming each claim.
3. **The claim graph** (`lib/claims.ts`) — how trust crosses loop boundaries:
   - Claims get an identity (`claim_id`) minted at write time; verify carries it
     through. A claim without identity cannot cross a boundary.
   - `readClaims()` is the only legal way to consume another run's claims. It writes one
     `claim_edges` row per claim *before* returning — consumption is on the record
     before the consumer can act on it. Forward lineage is computed by inverting these
     backward edges, never stored as forward pointers.
   - Every run opens with a `plan` hop declaring its **stakes** (`observes` /
     `recommends` / `acts`). The declaration is only half trusted: the tool manifest
     derives a floor the run cannot declare its way below, and unknown tools floor at
     `acts`.
   - A **guardrail** inside `readClaims()` withholds any claim whose doubt was never
     discharged from a consumer with higher stakes than its producer, writing the edge
     with `tripped = true`. The fleet overview surfaces tripped guardrails at the top of
     the queue — a shaky claim a higher-stakes loop is waiting on outranks a confident
     claim nothing depends on. A supervisor approval of the producer run releases the
     claim on the next read.

**An eval harness** (`npm run eval`) with two layers: a deterministic run of the tools
over the committed dataset (instant, free, proves the pipeline), and N live agent runs
scored against ground truth (finds the three real increases, verifies every claim,
rejects the AWS trap), gated at an 80% pass rate. `routines/` holds the nightly eval,
daily digest, and demo-script drafts.

## Why it's built this way

The design brief (`design/fleet-supervisor-brief.md`) starts from the USS Vincennes
failure mode: trust gets stored as an attribute of an agent and spent on a claim, while
the claim's own doubt is stripped on the way up. Every mechanism above is an answer to
that — verbatim confidence, evidence beside verdict, doubt-discharge triage, claim
identity, consumption edges, stakes floors, and the boundary checkpoint.
`design/claim-graph-increment.md` documents the claim-graph increments (A–E) as they
were designed before being built. `BUILDLOG.md` is the day-by-day record; `LESSONS.md`
is what broke and what it taught.

## Setup

```bash
npm install
cp .env.example .env.local   # Supabase URL + anon/service keys, ANTHROPIC_API_KEY
```

Apply the schema (Supabase SQL editor, or `supabase db reset` with the CLI) — all three
migrations, in order:

```
supabase/migrations/0001_traces.sql        # the trace store (one row per hop)
supabase/migrations/0002_reviews.sql       # supervisor decisions
supabase/migrations/0003_claim_edges.sql   # the claim graph
```

Seed a synthetic fleet so the overview has something to triage:

```bash
npm run seed:fleet
```

## Run / build / test

```bash
npm run dev        # http://localhost:3000 — fleet overview at /, runs at /run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest (50 tests: roll-up triage, claim graph, guardrail, drafter)
npm run build      # next build
npm run eval       # two-layer eval harness (needs ANTHROPIC_API_KEY)
```

To see the whole chain live: open `/run`, click **Run money check-in**, watch the loop
land hop by hop (including the AWS reversal), then click **Draft cancellations from this
run** to launch the consumer loop — `claim_edges` records the crossing, and the fleet
overview shows both runs with their stakes, the edge count, and any tripped guardrail.

## Trace schema

One row per hop; a run is a set of hops sharing `run_id`. Evidence sits next to verdict
by design — the viewer can only ever show what the row preserved at write time:

| column             | what it holds                                    |
|--------------------|--------------------------------------------------|
| `run_id`, `step_index`, `phase` | which run, which hop, plan/gather/act/verify |
| `tool_name`, `tool_input`, `tool_output` | **evidence** — what ran and what it touched |
| `model_confidence` | **verdict** — the model's own hedging, verbatim  |
| `verification`     | **verdict** — what the verify step found         |

See [CLAUDE.md](./CLAUDE.md) for the full schema, working rules, and architecture map.
