# CLAUDE.md — Loop Visibility

Project-specific guidance for [Claude Code](https://claude.com/claude-code). This takes
precedence over the org baseline at
[`slowsignalstudio/.github`](https://github.com/slowsignalstudio/.github/blob/main/CLAUDE.md).

## What this is

Loop Visibility is a viewer for agent execution traces. Every hop an agent takes writes a
trace row to Supabase *before* anything renders; the viewer reads those rows and
reconstructs the loop so a developer can see, hop by hop, what the agent actually did —
inputs, outputs, timing, and where it branched or failed.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** — configured via `app/globals.css` (`@import "tailwindcss"`), no
  `tailwind.config`; intentionally unused for now (see working rules)
- **Supabase** (Postgres + `@supabase/supabase-js`) as the trace store
- **Vitest** for unit tests

## Setup

```bash
npm install
cp .env.example .env.local     # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

Apply the schema by running `supabase/migrations/0001_traces.sql` against your project
(Supabase SQL editor, or `supabase db reset` with the CLI).

## Build / test / lint

Always run these before considering a change done:

```bash
npm run typecheck   # tsc --noEmit — must pass
npm run lint        # eslint (eslint-config-next, flat config in eslint.config.mjs)
npm run test        # vitest run
npm run build       # next build — must succeed
```

Dev server: `npm run dev` → http://localhost:3000.

## Architecture

- `app/layout.tsx`, `app/page.tsx` — App Router entry; `page.tsx` is the **fleet
  overview** (Level 1 of the fleet supervisor, see `design/fleet-supervisor-brief.md`):
  runs rolled up to claim-derived trust signals, triaged needs-you vs safe, with a
  one-action clear for the safe majority.
- `app/run/page.tsx`, `app/run/[runId]/page.tsx` — the hop-trace viewer (Level 3),
  rendered by `components/RunViewer.tsx`; `/run` starts a fresh run, `/run/<id>` is the
  drill-down from the fleet overview.
- `lib/fleet.ts` — pure roll-up: `rollUpRuns(rows)` groups trace rows by run and derives
  each run's `RunSignal` (headline, confidence verbatim, confirmed/reversed/unverified,
  triage). Doubt counts as discharged only when verify resolved it; tested in
  `lib/fleet.test.ts`.
- `lib/reviews.ts` + `app/api/review/route.ts` + `supabase/migrations/0002_reviews.sql`
  — supervisor decisions (`approved` / `rejected` / `cleared_safe`), one row per run per
  decision, written server-side only.
- `lib/claims.ts` + `supabase/migrations/0003_claim_edges.sql` — the claim graph (see
  `design/claim-graph-increment.md`): `analyze_recurring` mints a `claim_id` per price
  change (carried through verify), and `readClaims()` is the ONLY legal way to consume
  another run's verified claims — it writes one `claim_edges` row per claim before
  returning, throws on failure. Claims without ids cannot cross a loop boundary.
- `lib/supabaseClient.ts` — two clients:
  - `createBrowserClient()` — anon key, **read** side (viewer/queries).
  - `createServiceClient()` — service-role key, **server-only writes**. Never import into a
    client component; it bypasses RLS.
- `lib/trace.ts` — `writeTrace(hop)` inserts one hop and throws on failure so a hop can
  never go silently untraced; `getRun(runId)` returns a loop's hops in `hop_index` order.
- `lib/trace.test.ts` — unit tests for the write path (Supabase client mocked).
- `supabase/migrations/0001_traces.sql` — the `traces` table + indexes + read RLS policy.

## Trace schema

One row per hop. A **run** is one full loop; hops in a run share `run_id` and are ordered
by `step_index`. The viewer can only ever show what this table preserves, so every hop
stores its **evidence** (`tool_input` / `tool_output`) next to its **verdict**
(`model_confidence` / `verification`) from the first run.

| column             | type          | notes                                               |
|--------------------|---------------|-----------------------------------------------------|
| `id`               | uuid (pk)     | `gen_random_uuid()`                                 |
| `run_id`           | uuid          | groups all hops of one run                          |
| `step_index`       | int           | ordinal of the hop within the run                   |
| `phase`            | text          | what the hop was doing (e.g. plan / act / verify)   |
| `tool_name`        | text, null    | tool invoked this hop, if any                       |
| `tool_input`       | jsonb, null   | **evidence** — what went into the tool              |
| `tool_output`      | jsonb, null   | **evidence** — what the tool returned               |
| `model_confidence` | text, null    | **verdict** — the model's confidence in this hop    |
| `verification`     | jsonb, null   | **verdict** — how/whether the hop was checked       |
| `created_at`       | timestamptz   | `now()`                                             |

> **This column set is the authoritative Day-0 design decision — do not casually
> refactor it.** It was chosen deliberately, not scaffolded. The viewer can only ever
> show what a hop preserved at write time, so a column omitted here is evidence that can
> never be recovered for past runs. Adding a column later is cheap; changing or dropping
> one is a migration against historical data. Treat any change to these columns as a
> schema decision requiring explicit sign-off, and keep `traces` (the migration),
> `lib/trace.ts` (types + `writeTrace`), the viewer, and this table in lockstep.

## Working rules

1. **Every agent hop writes a trace row before anything renders.** The trace store is the
   source of truth; the viewer only reflects it. Route all writes through
   `writeTrace()` in `lib/trace.ts` — never render or return from a hop that wasn't traced
   first.
2. **No styling until Day 3.** Tailwind is wired up but stays unused; keep components plain
   and structural until the trace/write path is proven end-to-end. Don't add visual polish
   before then.

## Model policy

Anthropic API calls run through the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) (`@anthropic-ai/sdk`), keyed by `ANTHROPIC_API_KEY` (see `.env.example`). Choose the model by the job:

- **Sonnet (`claude-sonnet-5`) runs the agent loop** — the default workhorse for generation, tool use, and anything user-facing. Start here.
- **Haiku (`claude-haiku-4-5`) handles cheap checks** — classification, routing, boolean/short judgments, and other high-volume, low-stakes calls where latency and cost matter more than nuance.
- **Opus (`claude-opus-4-8`) only when output quality visibly matters** — upgrade a specific call to Opus when a person would notice the difference (final-draft prose, hard reasoning, gnarly debugging). It's a deliberate per-call upgrade, not a default.

The streaming demo at `app/api/stream/route.ts` uses Sonnet, per the loop default.
