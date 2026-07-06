# Loop Visibility — Build Spec

## What you build

A Next.js app on Vercel in TypeScript and React. Behind it, a small real agent on the
Anthropic API that uses tool calls and streaming to work through a multi-step task. A
server route runs the agent loop and writes a trace row for every hop to the Supabase
`traces` table. The React interface reads only from trace rows and renders them, which is
where the craft lives. No auth, to keep scope tight for a portfolio demo.

## The task

A money check-in over synthetic transaction data. The agent finds subscriptions whose
price changed this quarter, computes the total impact, and drafts a recommendation. The
data is synthetic and committed to the repo, so nothing confidential is touched and you
control ground truth completely.

The dataset is a JSON file of a few hundred transactions across three months, containing
recurring merchants, two or three planted price increases, and one trap: a merchant whose
charge varies for a legitimate reason, so the agent sometimes flags a false positive and
the verify step visibly corrects it. Generate it with Claude Code, then confirm by hand
that the planted anomalies and the trap are actually present.

## The three tools

Each tool maps to one phase of the gather, act, verify arc. Keep them boring, thirty to
fifty lines each. The viewer is the product; the agent is scaffolding.

**`lookup_transactions`** is the gather phase. It reads and filters rows from the synthetic
JSON and returns them. Writes a trace row with `phase = gather`, the filter as `tool_input`,
and the returned rows as `tool_output`.

**`analyze_recurring`** is the act phase. It identifies recurring merchants, computes price
deltas quarter over quarter, and composes the recommendation draft. Writes a trace row with
`phase = act`, and stores whatever hedge or certainty the model expresses in
`model_confidence`, verbatim.

**`verify_findings`** is the check phase. It re-tests every claimed price change against the
raw rows and returns a pass or fail per claim with the supporting rows attached. Writes a
trace row with `phase = verify` and the per-claim result in `verification`. This is the tool
that catches the planted trap, which is the moment the whole demo turns on.

## How trace rows map to the schema

The Day 0 table is the contract. Every hop populates:

- **`run_id`**: one uuid per agent run, so the client can filter one run.
- **`step_index`**: increases each hop, for ordering.
- **`phase`**: gather, act, or verify.
- **`tool_name`, `tool_input`, `tool_output`**: what ran and what it touched.
- **`model_confidence`**: the model's own hedging, stored verbatim, because paraphrasing it
  strips the uncertainty the tool exists to expose.
- **`verification`**: what the verify step checked and what it found.
- **`created_at`**: for duration between hops.

The rule that carries the integrity claim: the trace row is written before anything renders,
and the UI reads only from trace rows. What you show is provably what happened.
