import type { Trace } from "./trace";

/**
 * Level 1 roll-up: turn one run's trace rows into the trust signal the fleet overview
 * shows. PURE, like summarize() — same rows in, same signal out — so the triage logic
 * is unit-testable and the page stays about layout.
 *
 * The design rule this file carries (from design/fleet-supervisor-brief.md): trust
 * attaches to the CLAIM, not the agent. A run is "safe" only when every doubt raised
 * inside it was discharged with evidence — every flagged claim reached verify, and any
 * hedge the model expressed was resolved by a verify verdict on the hedged claim. A
 * reversal that verify caught is a discharged doubt: it stays visible as a badge, but
 * it does not demand the supervisor descend. Undischarged doubt — unverified claims,
 * a hedge nothing checked, a loop that stopped early — is what routes attention.
 */

export type RunTriage = "needs_you" | "safe";

export type RunSignal = {
  runId: string;
  startedAt: string;
  endedAt: string;
  hopCount: number;
  /** One-line claim summary for the overview row. */
  headline: string;
  /** The model's act-phase confidence, verbatim. Never paraphrased. */
  confidence: string | null;
  /** The run's declared+derived stakes tier from its plan hop, null for older runs. */
  stakes: string | null;
  claims: number; // flagged in act
  passed: number; // confirmed by verify
  reversed: number; // rejected by verify (doubt discharged, kept visible)
  unverified: number; // flagged but never checked (doubt NOT discharged)
  /** Sum of verified deltas, or null when no verify hop exists. */
  totalImpact: number | null;
  /** Why this run needs the supervisor. Empty for safe runs. */
  reasons: string[];
  triage: RunTriage;
  /** Distinct downstream runs that consumed this run's claims (from claim_edges). */
  consumers: number;
  /** Edges where the boundary guardrail withheld a claim from a consumer. */
  trippedEdges: number;
};

type PriceChange = { merchant: string; old_price: number; new_price: number };
type ClaimResult = { merchant: string; claim: { old_price: number; new_price: number }; pass: boolean };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Hedge markers, matched against the model's own words. Shared with the guardrail in
 *  lib/claims.ts so both layers agree on what counts as doubt. */
export const HEDGE_RE =
  /\b(not sure|may be|might|possibly|unclear|uncertain|suspect|usage[- ](based|metered)|metered|not a (fixed|true)|hard to say|low confidence|caution)/i;

export const NO_CONFIDENCE = "no confidence stated";

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export function rollUpRun(hops: Trace[]): RunSignal {
  const ordered = hops.slice().sort((a, b) => a.step_index - b.step_index);
  const runId = ordered[0]?.run_id ?? "";
  const startedAt = ordered[0]?.created_at ?? "";
  const endedAt = ordered[ordered.length - 1]?.created_at ?? "";

  const actHop = ordered.find((h) => h.phase === "act");
  const verifyHop = ordered.find((h) => h.phase === "verify");
  const confidence = actHop?.model_confidence ?? null;

  const planHop = ordered.find((h) => h.phase === "plan");
  const planInput = isRecord(planHop?.tool_input) ? planHop.tool_input : null;
  const stakes = typeof planInput?.stakes === "string" ? planInput.stakes : null;

  const actOut = isRecord(actHop?.tool_output) ? actHop.tool_output : null;
  const flagged: PriceChange[] = Array.isArray(actOut?.price_changes)
    ? (actOut.price_changes as PriceChange[])
    : [];

  const verifyOut = isRecord(verifyHop?.tool_output) ? verifyHop.tool_output : null;
  const results: ClaimResult[] = Array.isArray(verifyOut?.results)
    ? (verifyOut.results as ClaimResult[])
    : [];
  const byMerchant = new Map(results.map((r) => [r.merchant, r]));

  const passedResults = results.filter((r) => r.pass);
  const passed = passedResults.length;
  const reversed = results.length - passed;
  const unverifiedMerchants = flagged.map((c) => c.merchant).filter((m) => !byMerchant.has(m));
  const unverified = unverifiedMerchants.length;
  const totalImpact = verifyHop
    ? passedResults.reduce((s, r) => s + (r.claim.new_price - r.claim.old_price), 0)
    : null;

  // --- Undischarged doubt → reasons ---------------------------------------------------
  const reasons: string[] = [];

  if (!actHop) {
    reasons.push("run stopped before the analysis hop — nothing was claimed or checked");
  }
  if (actHop && flagged.length > 0 && !verifyHop) {
    reasons.push(`${flagged.length} claim${flagged.length === 1 ? "" : "s"} never verified`);
  }
  if (unverified > 0 && verifyHop) {
    reasons.push(`reported without verification: ${unverifiedMerchants.join(", ")}`);
  }
  if (confidence === NO_CONFIDENCE) {
    reasons.push("model stated no confidence on its analysis");
  }

  // A hedge is discharged only when every flagged claim the hedge names was reversed by
  // verify. A hedge that names nothing checkable, or names a claim that passed anyway,
  // is doubt still standing — exactly the thing that must not arrive looking certain.
  if (confidence && confidence !== NO_CONFIDENCE && HEDGE_RE.test(confidence)) {
    const lower = confidence.toLowerCase();
    const hedgedMerchants = flagged
      .map((c) => c.merchant)
      .filter((m) => lower.includes(m.toLowerCase()));
    const discharged =
      hedgedMerchants.length > 0 &&
      hedgedMerchants.every((m) => byMerchant.get(m)?.pass === false);
    if (!discharged) {
      reasons.push(
        hedgedMerchants.length > 0
          ? `model hedged on ${hedgedMerchants.join(", ")} and verify did not resolve it`
          : "model hedged in its own words and no verify verdict discharged it",
      );
    }
  }

  // --- Headline ------------------------------------------------------------------------
  let headline: string;
  if (verifyHop) {
    const impact = totalImpact !== null ? `, ${totalImpact >= 0 ? "+" : "−"}${money(Math.abs(totalImpact))}/mo verified` : "";
    headline =
      reversed > 0
        ? `Confirmed ${passed} claim${passed === 1 ? "" : "s"}, reversed ${reversed}${impact}`
        : `Confirmed all ${passed} claim${passed === 1 ? "" : "s"}${impact}`;
  } else if (actHop) {
    headline =
      flagged.length === 0
        ? "No price changes flagged"
        : `Flagged ${flagged.length} increase${flagged.length === 1 ? "" : "s"} — unverified`;
  } else {
    headline = "Gathered data, no analysis recorded";
  }

  return {
    runId,
    startedAt,
    endedAt,
    hopCount: ordered.length,
    headline,
    confidence,
    stakes,
    claims: flagged.length,
    passed,
    reversed,
    unverified,
    totalImpact: totalImpact !== null ? Math.round(totalImpact * 100) / 100 : null,
    reasons,
    triage: reasons.length > 0 ? "needs_you" : "safe",
    consumers: 0,
    trippedEdges: 0,
  };
}

/** The slice of a claim_edges row the overview needs. */
export type EdgeLite = {
  producer_run_id: string;
  consumer_run_id: string;
  tripped: boolean;
};

/**
 * Fold the claim graph into the signals (increment E). A producer whose claim tripped
 * the guardrail is undischarged doubt that a HIGHER-STAKES loop is waiting on — it
 * routes to needs-you even if it looked safe in isolation, which is exactly the
 * doubt-times-downstream-stakes ranking from the brief. Pure, like rollUpRun.
 */
export function applyEdges(signals: RunSignal[], edges: EdgeLite[]): RunSignal[] {
  const consumersByProducer = new Map<string, Set<string>>();
  const trippedByProducer = new Map<string, number>();
  for (const e of edges) {
    const set = consumersByProducer.get(e.producer_run_id) ?? new Set<string>();
    set.add(e.consumer_run_id);
    consumersByProducer.set(e.producer_run_id, set);
    if (e.tripped) {
      trippedByProducer.set(e.producer_run_id, (trippedByProducer.get(e.producer_run_id) ?? 0) + 1);
    }
  }

  return signals.map((s) => {
    const consumers = consumersByProducer.get(s.runId)?.size ?? 0;
    const trippedEdges = trippedByProducer.get(s.runId) ?? 0;
    if (trippedEdges === 0) return { ...s, consumers, trippedEdges };
    return {
      ...s,
      consumers,
      trippedEdges,
      reasons: [
        ...s.reasons,
        `shaky claim feeding a higher-stakes loop — guardrail tripped ${trippedEdges} time${trippedEdges === 1 ? "" : "s"}`,
      ],
      triage: "needs_you",
    };
  });
}

/** Group a flat page of trace rows by run and roll each run up, newest run first. */
export function rollUpRuns(rows: Trace[]): RunSignal[] {
  const byRun = new Map<string, Trace[]>();
  for (const r of rows) {
    const list = byRun.get(r.run_id);
    if (list) list.push(r);
    else byRun.set(r.run_id, [r]);
  }
  return [...byRun.values()]
    .map(rollUpRun)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}
