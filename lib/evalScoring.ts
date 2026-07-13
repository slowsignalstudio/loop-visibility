import { runTool } from "@/lib/toolRunners";
import type { Hop } from "@/lib/agent";

/**
 * Scoring for the eval harness, kept pure so it can be unit-tested and reused by both
 * layers: the deterministic pipeline check and the real-agent runs. Everything here is
 * measured against the committed ground truth in data/GROUND_TRUTH.md.
 */

// Ground truth: exactly these three are real subscription price increases.
const REAL_INCREASES = ["Netflix", "The New York Times", "YouTube Premium"] as const;
const TRAP = "AWS"; // usage-metered; must be flagged in act, then FAILED in verify.
const EXPECTED_TOTAL = 15.5; // sum of the three real monthly deltas
const EPSILON = 0.01;

type PriceChange = { merchant: string; old_price: number; new_price: number; delta: number };
type ActOutput = { price_changes: PriceChange[]; total_monthly_impact: number; recommendation: string };
type ClaimResult = { merchant: string; claim: { old_price: number; new_price: number }; pass: boolean };
type VerifyOutput = { passed: number; failed: number; results: ClaimResult[] };

export type CheckResult = { name: string; pass: boolean; detail: string };
export type Scorecard = { checks: CheckResult[]; passed: number; total: number; allPass: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** The core rubric. Given what act produced and what verify concluded, score the run. */
export function scoreFindings(act: ActOutput | null, verify: VerifyOutput | null): Scorecard {
  const checks: CheckResult[] = [];

  const flagged = new Set((act?.price_changes ?? []).map((c) => c.merchant));
  const results = verify?.results ?? [];
  const passedMerchants = new Set(results.filter((r) => r.pass).map((r) => r.merchant));
  const byMerchant = new Map(results.map((r) => [r.merchant, r]));

  // 1. Act flags all three real increases.
  const missingReal = REAL_INCREASES.filter((m) => !flagged.has(m));
  checks.push({
    name: "act flags the 3 real increases",
    pass: missingReal.length === 0,
    detail: missingReal.length ? `missing: ${missingReal.join(", ")}` : "all present",
  });

  // 2. Every flagged change was actually sent to verify (nothing reported unverified).
  const unverified = [...flagged].filter((m) => !byMerchant.has(m));
  checks.push({
    name: "every claim was verified",
    pass: flagged.size > 0 && unverified.length === 0,
    detail: unverified.length ? `never verified: ${unverified.join(", ")}` : "all verified",
  });

  // 3. Verify passes exactly the three real increases, no more, no fewer.
  const passOk =
    passedMerchants.size === REAL_INCREASES.length &&
    REAL_INCREASES.every((m) => passedMerchants.has(m));
  checks.push({
    name: "verify passes exactly the 3 reals",
    pass: passOk,
    detail: `passed: ${[...passedMerchants].join(", ") || "none"}`,
  });

  // 4. The AWS trap is flagged in act but rejected by verify.
  const awsResult = byMerchant.get(TRAP);
  checks.push({
    name: "AWS trap is rejected by verify",
    pass: !!awsResult && awsResult.pass === false,
    detail: awsResult ? (awsResult.pass ? "WRONGLY passed" : "correctly failed") : "AWS never checked",
  });

  // 5. Total monthly impact of the passing claims equals the ground-truth $15.50.
  const total = results
    .filter((r) => r.pass)
    .reduce((s, r) => s + (r.claim.new_price - r.claim.old_price), 0);
  const totalRounded = Math.round(total * 100) / 100;
  checks.push({
    name: "verified total is +$15.50/mo",
    pass: Math.abs(totalRounded - EXPECTED_TOTAL) < EPSILON,
    detail: `computed +$${totalRounded.toFixed(2)}/mo`,
  });

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, allPass: passed === checks.length };
}

/** Pull the act and verify tool outputs out of a real agent run's hops. */
function extractOutputs(hops: Hop[]): { act: ActOutput | null; verify: VerifyOutput | null } {
  let act: ActOutput | null = null;
  let verify: VerifyOutput | null = null;
  for (const h of hops) {
    if (h.tool_name === "analyze_recurring" && isRecord(h.tool_output)) act = h.tool_output as ActOutput;
    if (h.tool_name === "verify_findings" && isRecord(h.tool_output)) verify = h.tool_output as VerifyOutput;
  }
  return { act, verify };
}

/** Soft signal: did the model hedge on AWS in its own words during the act phase? */
export function hedgedOnAws(hops: Hop[]): boolean {
  const conf = hops.find((h) => h.tool_name === "analyze_recurring")?.model_confidence ?? "";
  const c = conf.toLowerCase();
  return c.includes("aws") && (c.includes("usage") || c.includes("meter") || c.includes("not a"));
}

/** Score one real agent run. */
export function scoreAgentRun(hops: Hop[]): Scorecard {
  const { act, verify } = extractOutputs(hops);
  return scoreFindings(act, verify);
}

/**
 * The deterministic layer: run the three tools directly over the committed dataset, with
 * no model in the loop, and score the result. Proves the analysis pipeline itself is
 * correct and gives an instant, free baseline the agent runs are measured against.
 */
export function deterministicScore(): Scorecard {
  const gather = runTool("lookup_transactions", {
    category: "subscription",
    start_date: "2026-04-01",
    end_date: "2026-06-30",
  }).output as { rows: unknown[] };

  const act = runTool("analyze_recurring", { transactions: gather.rows }).output as ActOutput;

  const verify = runTool("verify_findings", {
    claims: act.price_changes.map((c) => ({
      merchant: c.merchant,
      old_price: c.old_price,
      new_price: c.new_price,
    })),
  }).output as VerifyOutput;

  return scoreFindings(act, verify);
}
