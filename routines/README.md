# Routines

Three standing routines that run the flagship on a schedule and leave dated output in
`reports/`. They are plain scripts, so they run the same whether a cron job, a Claude Code
routine, or a Cowork scheduled task invokes them. Each needs the same `.env.local` the app
uses (`ANTHROPIC_API_KEY`, Supabase keys) and `tsx` (`npm install -D tsx`).

## The three routines

### Nightly eval run

```
npm run eval:report
```

Runs the two-layer eval (deterministic pipeline + real agent), prints the scorecard, and
writes `reports/eval-YYYY-MM-DD.md`. Exits non-zero if the deterministic layer fails or the
agent falls below the 80% pass gate, so a scheduler can alert on a bad night. Default is 5
agent runs; `npm run eval:report -- 10` for more.

### Daily digest brief

```
npm run digest
```

Reads the newest `BUILDLOG.md` entry and the most recent eval report, then writes a short
morning brief to `reports/digest-YYYY-MM-DD.md`: what shipped, whether the eval is healthy,
and a suggested focus for today. Uses Haiku (cheap, low-stakes).

### Build-log-to-demo-script draft

```
npm run demo:draft
```

Reads `BUILDLOG.md` and drafts a 60-90 second spoken demo script to
`reports/demo-script-YYYY-MM-DD.md`. Uses Opus, since it is final-draft prose read aloud.

## Scheduling

Pick whichever fits how you work.

**cron (macOS/Linux).** Example: nightly eval at 2am, digest at 7am.

```
0 2 * * *  cd /path/to/loop-visibility && npm run eval:report >> reports/eval.cron.log 2>&1
0 7 * * *  cd /path/to/loop-visibility && npm run digest >> reports/digest.cron.log 2>&1
```

**Claude Code routine.** Register the same commands as scheduled routines from the CLI, so
they run in your authenticated environment.

**Cowork scheduled task.** Ask Cowork to run the routine on a schedule; it invokes the same
npm scripts against this folder.

`reports/` is where all output lands; keep it out of the demo but in the repo history so the
run record accumulates.
