# Loop Visibility

A viewer for agent execution traces. Every hop an agent takes writes a trace row to
Supabase before anything renders; the viewer reads those rows and reconstructs the loop
so you can see, step by step, what the agent actually did.

Scaffolded with `create-next-app` (Next.js 16, App Router, Tailwind v4) and layered with a
Supabase trace store.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + keys
```

Apply the schema to your Supabase project (SQL editor, or the Supabase CLI):

```bash
supabase db reset            # applies supabase/migrations/*.sql
# or paste supabase/migrations/0001_traces.sql into the SQL editor
```

## Run / build / test

```bash
npm run dev        # local dev server at http://localhost:3000
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test       # vitest run
```

## Architecture

- `app/` — Next.js App Router. `page.tsx` is the (currently unstyled) trace viewer.
- `lib/supabaseClient.ts` — `createBrowserClient()` (anon, read) and `createServiceClient()`
  (service role, server-only writes).
- `lib/trace.ts` — `writeTrace()` records one hop; `getRun()` fetches a loop in order.
- `supabase/migrations/` — the `traces` schema.

See [CLAUDE.md](./CLAUDE.md) for the trace schema and working rules.
