import { createServiceClient } from "./supabaseClient";
import type { Trace } from "./trace";
import { HEDGE_RE, NO_CONFIDENCE } from "./fleet";
import { stakesAtLeast, STAKES_TIERS, type Stakes } from "./stakes";

/**
 * Claim consumption across loop boundaries (claim graph, increment B).
 *
 * The working rule this file carries: no hop may consume another run's claim except
 * through readClaims(). The edge row is written BEFORE the claims are returned, the same
 * completeness argument as writeTrace — an untraced read is the side channel where doubt
 * gets stripped on the way into a bigger loop. readClaims throws on failure so a
 * consumption can never silently go unrecorded.
 */

/** One consumption edge. Mirrors the `claim_edges` table. */
export type ClaimEdge = {
  id: string;
  claim_id: string;
  producer_run_id: string;
  consumer_run_id: string;
  consumer_step_index: number;
  claim_confidence_at_read: string | null;
  tripped: boolean;
  created_at: string;
};

/** A verified claim as a consumer receives it: verdict, evidence pointer, and the
 *  producer's doubt, verbatim. Only claims that PASSED verify and carry an identity are
 *  consumable — a claim without an id cannot be pointed at, so it cannot cross. */
export type VerifiedClaim = {
  claim_id: string;
  producer_run_id: string;
  merchant: string;
  old_price: number;
  new_price: number;
  delta: number;
  /** The producer's act-phase model_confidence, never paraphrased. */
  confidence: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Pure extraction: given one run's trace rows, return its consumable claims — verified
 * (pass === true) and id-bearing. Pure like summarize()/rollUpRun() so the jsonb
 * narrowing is unit-testable without a database.
 */
export function extractVerifiedClaims(rows: Trace[]): VerifiedClaim[] {
  const ordered = rows.slice().sort((a, b) => a.step_index - b.step_index);
  const actHop = ordered.find((h) => h.phase === "act");
  const verifyHop = ordered.find((h) => h.phase === "verify");
  if (!verifyHop) return []; // nothing verified, nothing crosses

  const confidence = actHop?.model_confidence ?? null;
  const out = isRecord(verifyHop.tool_output) ? verifyHop.tool_output : null;
  const results = Array.isArray(out?.results) ? out.results : [];

  const claims: VerifiedClaim[] = [];
  for (const r of results) {
    if (!isRecord(r) || r.pass !== true) continue;
    if (typeof r.claim_id !== "string" || !r.claim_id) continue; // no identity, no edge
    const c = isRecord(r.claim) ? r.claim : null;
    const old_price = typeof c?.old_price === "number" ? c.old_price : NaN;
    const new_price = typeof c?.new_price === "number" ? c.new_price : NaN;
    if (Number.isNaN(old_price) || Number.isNaN(new_price)) continue;
    claims.push({
      claim_id: r.claim_id,
      producer_run_id: verifyHop.run_id,
      merchant: typeof r.merchant === "string" ? r.merchant : "unknown",
      old_price,
      new_price,
      delta: Math.round((new_price - old_price) * 100) / 100,
      confidence,
    });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// The guardrail (increment E): the checkpoint lives HERE, because the edge write is
// the boundary crossing. A passing claim whose doubt was never discharged must not
// slide into a loop with higher stakes than the one that produced it — that is the
// Vincennes failure, doubt stripped on the way up. The claim is withheld, the edge is
// still written (tripped = true — the attempt itself is evidence), and a supervisor
// approval of the producer run releases the claim on the next read.
// ---------------------------------------------------------------------------

/** Per-claim doubt that verify did NOT discharge, judged from the producer's own words.
 *  Returns the reason, or null when the claim arrives clean. Mirrors rollUpRun's rules:
 *  a hedge is discharged only when every claim it names was reversed by verify. */
export function claimDoubt(
  confidence: string | null,
  merchant: string,
  verifyResults: { merchant: string; pass: boolean }[],
): string | null {
  if (!confidence || confidence === NO_CONFIDENCE) {
    return "producer stated no confidence on its analysis";
  }
  if (!HEDGE_RE.test(confidence)) return null;

  const lower = confidence.toLowerCase();
  const mentioned = verifyResults.filter((r) => lower.includes(r.merchant.toLowerCase()));
  if (mentioned.length === 0) {
    return "producer hedged in its own words and the hedge names nothing checkable";
  }
  const discharged = mentioned.every((r) => r.pass === false);
  if (discharged) return null; // the doubt was resolved by a reversal — clean crossing
  if (mentioned.some((r) => r.merchant.toLowerCase() === merchant.toLowerCase())) {
    return "producer hedged on this claim and verify passed it anyway";
  }
  return null;
}

export type WithheldClaim = { claim_id: string; merchant: string; reason: string };

export type PartitionedClaims = {
  producerStakes: Stakes | null;
  claims: VerifiedClaim[];
  withheld: WithheldClaim[];
};

/**
 * Pure boundary decision: given the producer's trace rows and the consumer's stakes,
 * split the consumable claims into released and withheld. `released` is true when a
 * supervisor has approved the producer run — human sign-off discharges what verify
 * could not.
 */
export function partitionClaims(
  rows: Trace[],
  consumerStakes: Stakes,
  released: boolean,
): PartitionedClaims {
  const ordered = rows.slice().sort((a, b) => a.step_index - b.step_index);
  const planInput = isRecord(ordered.find((h) => h.phase === "plan")?.tool_input)
    ? (ordered.find((h) => h.phase === "plan")!.tool_input as Record<string, unknown>)
    : null;
  const producerStakes = STAKES_TIERS.includes(planInput?.stakes as Stakes)
    ? (planInput?.stakes as Stakes)
    : null;

  const all = extractVerifiedClaims(ordered);

  // Runs that predate the stakes declaration are read-only observers; treating them as
  // the lowest tier makes the guardrail MORE likely to check, never less.
  const crossesUp = !stakesAtLeast(producerStakes ?? "observes", consumerStakes);
  if (!crossesUp || released) {
    return { producerStakes, claims: all, withheld: [] };
  }

  const verifyOut = ordered.find((h) => h.phase === "verify")?.tool_output;
  const results = (isRecord(verifyOut) && Array.isArray(verifyOut.results) ? verifyOut.results : [])
    .filter(isRecord)
    .map((r) => ({
      merchant: typeof r.merchant === "string" ? r.merchant : "",
      pass: r.pass === true,
    }));
  const confidence = ordered.find((h) => h.phase === "act")?.model_confidence ?? null;

  const claims: VerifiedClaim[] = [];
  const withheld: WithheldClaim[] = [];
  for (const c of all) {
    const doubt = claimDoubt(confidence, c.merchant, results);
    if (doubt) withheld.push({ claim_id: c.claim_id, merchant: c.merchant, reason: doubt });
    else claims.push(c);
  }
  return { producerStakes, claims, withheld };
}

export type ReadClaimsOptions = {
  /** The run whose verified claims are being consumed. */
  producerRunId: string;
  /** The consuming run — the edge's owner. */
  consumerRunId: string;
  /** The consumer's hop that performs this read. */
  consumerStepIndex: number;
  /** The consumer's stakes tier, used by the boundary guardrail. */
  consumerStakes: Stakes;
};

export type ReadClaimsResult = {
  claims: VerifiedClaim[];
  /** Claims the guardrail withheld: undischarged doubt crossing into higher stakes. */
  withheld: WithheldClaim[];
};

/**
 * Consume a producer run's verified claims. Reads the producer's trace rows, runs the
 * boundary guardrail, writes ONE EDGE ROW PER CLAIM to `claim_edges` (tripped = true
 * for withheld claims), and only then returns. Server-only. Throws on any failure so
 * a consumption can never silently go unrecorded.
 */
export async function readClaims(opts: ReadClaimsOptions): Promise<ReadClaimsResult> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("traces")
    .select()
    .eq("run_id", opts.producerRunId)
    .order("step_index", { ascending: true });
  if (error) {
    throw new Error(`readClaims failed reading producer traces: ${error.message}`);
  }

  // A supervisor decision on the producer run releases withheld claims: the doubt was
  // re-surfaced and a human discharged it.
  const { data: reviewRows, error: reviewError } = await supabase
    .from("reviews")
    .select()
    .eq("run_id", opts.producerRunId);
  if (reviewError) {
    throw new Error(`readClaims failed reading reviews: ${reviewError.message}`);
  }
  const released = (reviewRows ?? []).some(
    (r) => isRecord(r) && (r.decision === "approved" || r.decision === "cleared_safe"),
  );

  const { claims, withheld } = partitionClaims(
    (data ?? []) as Trace[],
    opts.consumerStakes,
    released,
  );
  if (claims.length === 0 && withheld.length === 0) return { claims: [], withheld: [] };

  // The edge is evidence of consumption — including the attempts the guardrail blocked —
  // so it must exist before the consumer can act on what it read.
  const byId = new Map(extractVerifiedClaims((data ?? []) as Trace[]).map((c) => [c.claim_id, c]));
  const { error: edgeError } = await supabase.from("claim_edges").insert([
    ...claims.map((c) => ({
      claim_id: c.claim_id,
      producer_run_id: c.producer_run_id,
      consumer_run_id: opts.consumerRunId,
      consumer_step_index: opts.consumerStepIndex,
      claim_confidence_at_read: c.confidence,
      tripped: false,
    })),
    ...withheld.map((w) => ({
      claim_id: w.claim_id,
      producer_run_id: opts.producerRunId,
      consumer_run_id: opts.consumerRunId,
      consumer_step_index: opts.consumerStepIndex,
      claim_confidence_at_read: byId.get(w.claim_id)?.confidence ?? null,
      tripped: true,
    })),
  ]);
  if (edgeError) {
    throw new Error(`readClaims failed writing claim_edges: ${edgeError.message}`);
  }

  return { claims, withheld };
}
