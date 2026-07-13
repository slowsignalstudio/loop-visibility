import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runAgent } from "@/lib/agent";
import { deterministicScore, scoreAgentRun, hedgedOnAws, type Scorecard } from "@/lib/evalScoring";

/**
 * Eval harness. Two layers:
 *   1. Deterministic — run the tools directly over the committed dataset, no model. Instant,
 *      free, proves the analysis pipeline is correct.
 *   2. Real agent — run the live Sonnet agent N times and score each run against ground truth,
 *      then report a pass rate. This is the eval that measures the non-deterministic part.
 *
 * Usage:  npm run eval            (5 agent runs)
 *         npm run eval -- 10      (10 agent runs)
 *         EVAL_RUNS=3 npm run eval
 *
 * Exit code is 0 only if the deterministic layer passes AND the agent clears the pass-rate
 * gate, so this doubles as the nightly routine's check.
 */

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

const RUNS = Number(process.env.EVAL_RUNS ?? process.argv[2] ?? 5);
const THRESHOLD = 0.8; // agent must pass at least this fraction of runs

function printCard(title: string, card: Scorecard) {
  console.log(`\n${title}  -  ${card.passed}/${card.total} checks`);
  for (const c of card.checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
  }
}

async function main() {
  console.log("Loop Visibility - eval harness");
  console.log(
    "Ground truth: Netflix +$2.50, NYT +$8.00, YouTube +$5.00 = +$15.50/mo; AWS trap must fail verify.",
  );

  // Layer 1 - deterministic pipeline (no model in the loop).
  const det = deterministicScore();
  printCard("Deterministic pipeline", det);

  // Layer 2 - real agent, N runs.
  console.log(`\nRunning the real agent ${RUNS}x  (Sonnet, ~25s each)...`);
  let agentPass = 0;
  let hedged = 0;
  const runLines: string[] = [];
  for (let i = 1; i <= RUNS; i++) {
    const t0 = Date.now();
    const result = await runAgent();
    const card = scoreAgentRun(result.hops);
    if (card.allPass) agentPass++;
    if (hedgedOnAws(result.hops)) hedged++;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `\nRun ${i}/${RUNS}  -  ${card.allPass ? "PASS" : "FAIL"}  (${card.passed}/${card.total} checks, ${secs}s)`,
    );
    for (const c of card.checks) if (!c.pass) console.log(`    FAIL  ${c.name}  (${c.detail})`);
    runLines.push(`- Run ${i}: ${card.allPass ? "PASS" : "FAIL"} (${card.passed}/${card.total} checks, ${secs}s)`);
  }

  const rate = RUNS ? agentPass / RUNS : 0;
  console.log("\n---------- summary ----------");
  console.log(`Deterministic:  ${det.allPass ? "PASS" : "FAIL"}  (${det.passed}/${det.total})`);
  console.log(`Agent runs:     ${agentPass}/${RUNS} passed  (${(rate * 100).toFixed(0)}%)`);
  console.log(`Hedged on AWS:  ${hedged}/${RUNS} runs  (soft signal)`);

  const ok = det.allPass && rate >= THRESHOLD;
  console.log(
    `\nResult: ${ok ? "PASS" : "FAIL"}  (gate: deterministic PASS and agent >= ${(THRESHOLD * 100).toFixed(0)}%)`,
  );

  // The nightly routine sets EVAL_REPORT=1 to leave a dated scorecard behind, so the run
  // history accumulates in reports/ and the daily digest can read the latest one.
  if (process.env.EVAL_REPORT) {
    const date = new Date().toISOString().slice(0, 10);
    const report =
      `# Eval report — ${date}\n\n` +
      `Result: **${ok ? "PASS" : "FAIL"}**\n\n` +
      `- Deterministic pipeline: ${det.allPass ? "PASS" : "FAIL"} (${det.passed}/${det.total})\n` +
      `- Agent runs: ${agentPass}/${RUNS} passed (${(rate * 100).toFixed(0)}%)\n` +
      `- Hedged on AWS: ${hedged}/${RUNS} runs\n\n` +
      `## Per-run\n\n${runLines.join("\n")}\n`;
    mkdirSync(resolve(root, "reports"), { recursive: true });
    const out = resolve(root, `reports/eval-${date}.md`);
    writeFileSync(out, report);
    console.log(`\nWrote ${out}`);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("eval crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
