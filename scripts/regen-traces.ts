import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runAgent } from "@/lib/agent";
import { writeTrace, type Trace } from "@/lib/trace";
import { createServiceClient } from "@/lib/supabaseClient";

/**
 * Regenerate the trace data from scratch.
 *
 *   1. Delete every row in `traces`.
 *   2. Run the live money-check-in agent N times (default 3), writing each hop.
 *   3. Read the rows back and confirm the invariants the loop is supposed to hold:
 *        - every act row carries a confidence string (never null),
 *        - no web_search rows exist,
 *        - plan rows carry the model's interleaved reasoning text,
 *        - at least one run's verify row caught a false positive (failed >= 1).
 *
 * Requires ANTHROPIC_API_KEY and the Supabase env (service-role key) in .env.local or the
 * ambient environment — the same credentials the API route uses.
 *
 * Requires Node 22+: @supabase/supabase-js constructs a realtime WebSocket eagerly and
 * Node < 22 has no global WebSocket, so createServiceClient() throws on older runtimes.
 * This is the same Node-22 floor the project pins in package.json ("engines"); the guard
 * below turns the otherwise-cryptic failure into a clear message.
 *
 * Usage:  tsx scripts/regen-traces.ts        (3 runs)
 *         tsx scripts/regen-traces.ts 5       (5 runs)
 *         REGEN_RUNS=3 tsx scripts/regen-traces.ts
 */

// Fail fast on Node < 22 rather than crashing deep inside the Supabase client's eager
// WebSocket construction, which produces a stack trace that hides the real cause.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.error(
    `regen-traces requires Node 22+ (found v${process.versions.node}). ` +
      `@supabase/supabase-js opens a realtime WebSocket eagerly and Node < 22 has no global ` +
      `WebSocket. Switch to Node 22 (e.g. \`nvm use 22\`) and re-run.`,
  );
  process.exit(1);
}

// Next loads .env.local automatically; a standalone script does not, so load it by hand.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch {
  /* fall back to ambient env */
}

const RUNS = Number(process.env.REGEN_RUNS ?? process.argv[2] ?? 3);

async function main() {
  console.log(`Loop Visibility — trace regeneration (${RUNS} runs)\n`);

  const supabase = createServiceClient();

  // 1. Delete every existing trace row. `neq id` on a never-null uuid matches all rows;
  // Supabase requires a filter on delete, so this is the idiomatic "delete all".
  const { error: delErr, count: deleted } = await supabase
    .from("traces")
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) throw new Error(`Failed to clear traces: ${delErr.message}`);
  console.log(`Cleared traces (${deleted ?? "?"} rows removed).\n`);

  // 2. Run the agent N times fresh, persisting every hop before it renders. The run_id is
  // generated up front so the onHop writer can tag rows as they land (runAgent only
  // returns its id after the loop finishes).
  const runIds: string[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const runId = randomUUID();
    runIds.push(runId);
    const t0 = Date.now();
    const result = await runAgent({
      runId,
      onHop: (hop) =>
        writeTrace({
          run_id: runId,
          step_index: hop.step_index,
          phase: hop.phase,
          tool_name: hop.tool_name,
          tool_input: hop.tool_input,
          tool_output: hop.tool_output,
          model_confidence: hop.model_confidence,
          verification: hop.verification,
        }).then(() => undefined),
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `Run ${i}/${RUNS}  ${runId.slice(0, 8)}  ${result.steps} hops  (${secs}s, stop: ${result.stop_reason})`,
    );
  }

  // 3. Read the rows back and confirm the invariants.
  const { data, error: readErr } = await supabase
    .from("traces")
    .select()
    .order("run_id")
    .order("step_index");
  if (readErr) throw new Error(`Failed to read traces back: ${readErr.message}`);
  const rows = (data ?? []) as Trace[];

  report(rows, runIds);
}

function report(rows: Trace[], runIds: string[]) {
  const byRun = new Map<string, Trace[]>();
  for (const r of rows) (byRun.get(r.run_id) ?? byRun.set(r.run_id, []).get(r.run_id)!).push(r);

  const actRows = rows.filter((r) => r.phase === "act");
  const planRows = rows.filter((r) => r.phase === "plan");
  const gatherRows = rows.filter((r) => r.phase === "gather");
  const verifyRows = rows.filter((r) => r.phase === "verify");

  const actWithConfidence = actRows.filter(
    (r) => typeof r.model_confidence === "string" && r.model_confidence.trim().length > 0,
  );
  const webSearchRows = rows.filter((r) => r.tool_name === "web_search");
  const planWithText = planRows.filter(
    (r) => typeof r.tool_output === "string" && r.tool_output.trim().length > 0,
  );
  const verifyFailed = verifyRows.filter((r) => {
    const v = r.verification as { failed?: number } | null;
    return typeof v?.failed === "number" && v.failed >= 1;
  });

  console.log(`\n---------- counts ----------`);
  console.log(`Runs:                ${byRun.size} (${runIds.map((r) => r.slice(0, 8)).join(", ")})`);
  console.log(`Total rows:          ${rows.length}`);
  console.log(`  plan:              ${planRows.length}  (${planWithText.length} with reasoning text)`);
  console.log(`  gather:            ${gatherRows.length}`);
  console.log(`  act:               ${actRows.length}  (${actWithConfidence.length} with a confidence string)`);
  console.log(`  verify:            ${verifyRows.length}  (${verifyFailed.length} caught a false positive)`);
  console.log(`  web_search:        ${webSearchRows.length}`);

  const checks: [string, boolean][] = [
    ["every act row has a confidence string", actRows.length > 0 && actWithConfidence.length === actRows.length],
    ["no web_search rows exist", webSearchRows.length === 0],
    ["plan rows appear with reasoning text", planWithText.length > 0],
    ["at least one verify row has failed >= 1", verifyFailed.length > 0],
  ];

  console.log(`\n---------- confirmations ----------`);
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    allOk = allOk && ok;
  }
  console.log(`\nResult: ${allOk ? "PASS" : "FAIL"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("regen crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
