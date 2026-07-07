# Build Log — Loop Visibility

One dated entry per working day, newest at the top. Write it the day things happen —
this log feeds the Day 4 routine that drafts demo scripts, and it's where interview
stories come from; a week later you can't reconstruct what today felt like.

**Convention**
- Heading: `## YYYY-MM-DD — Day N` (ISO date so the routine can sort/parse; `N` counts from Day 0).
- Body: 3–5 sentences of prose (not bullets), covering — the decision that mattered,
  the proof it worked, and the one gotcha or story worth remembering.
- Bold the load-bearing nouns (schema fields, tools, versions) so they're skimmable.

<!-- new entries go directly below this line, above the previous day -->

## 2026-07-06 — Day 0

Stood up Loop Visibility end to end: scaffolded the app with `create-next-app` (Next 16 / TypeScript / Tailwind / Supabase), pushed it to `slowsignalstudio/loop-visibility`, and deployed the empty shell to Vercel with a streaming Anthropic route (`/api/stream`) proving the model wiring works in production. The decision that actually mattered today was the trace schema — a single `traces` table where every hop stores its **evidence** (`tool_input` / `tool_output`) right next to its **verdict** (`model_confidence` / `verification`), on the principle that the viewer can only ever show what the trace preserved at write time. Created the Supabase project, ran that one table, and confirmed the full loop: inserted a two-hop sample run over the REST API and watched the live viewer render `plan` → `act` → `web_search` from real rows. The one gotcha worth remembering: `@supabase/supabase-js` constructs a realtime WebSocket eagerly and Node 20 has no native `WebSocket`, so the viewer threw until I pinned the project to Node 22 — a small runtime detail that quietly blocked the whole read path. Also set the model policy (Sonnet runs the loop, Haiku for cheap checks, Opus only when quality visibly matters) and marked the column set as an authoritative, sign-off-required design decision, since a column not captured on Day 0 is evidence no future run can recover.

**Build session (evening).** Built the agent loop as one server route (`/api/run`): **Sonnet** calls the three tools (`lookup_transactions` → `analyze_recurring` → `verify_findings`), and every hop writes its trace row *before* the result is fed back, capped by a **10-step guard**. Committed the synthetic dataset — 300 transactions with three planted increases (**+$15.50/mo**) and one trap, **AWS** billed as a usage-metered subscription, so `analyze_recurring` over-counts it and `verify_findings` rejects it — the false-positive correction the demo turns on, and it fired in all three fresh runs (`failed = 1` each). The story of the day: after making `confidence` a **required** field on the act tool (written verbatim to `model_confidence`, or `"no confidence stated"`, never null), the model hedged on the trap *in its own words* — "usage-based cloud billing, not a fixed subscription price" — before `verify` even ran. Shipped the live viewer: it subscribes to `traces` by `run_id` via **Supabase realtime** with a **1-second polling fallback**, rendering each row as raw formatted JSON in a monospace column. Wiped the table and re-ran three times so the trace reads consistently end to end; realtime still needs one `alter publication` line in the SQL editor to flip on, and polling covers it meanwhile.
