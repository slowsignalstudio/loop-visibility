import { createServiceClient } from "./supabaseClient";
import type { Trace } from "./trace";

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

export type ReadClaimsOptions = {
  /** The run whose verified claims are being consumed. */
  producerRunId: string;
  /** The consuming run — the edge's owner. */
  consumerRunId: string;
  /** The consumer's hop that performs this read. */
  consumerStepIndex: number;
};

/**
 * Consume a producer run's verified claims. Reads the producer's trace rows, extracts
 * the consumable claims, writes ONE EDGE ROW PER CLAIM to `claim_edges`, and only then
 * returns the claims. Server-only (service client). Throws on any failure.
 */
export async function readClaims(opts: ReadClaimsOptions): Promise<VerifiedClaim[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("traces")
    .select()
    .eq("run_id", opts.producerRunId)
    .order("step_index", { ascending: true });
  if (error) {
    throw new Error(`readClaims failed reading producer traces: ${error.message}`);
  }

  const claims = extractVerifiedClaims((data ?? []) as Trace[]);
  if (claims.length === 0) return [];

  // The edge is evidence of consumption, so it must exist before the consumer can act
  // on what it read — mirror of writeTrace's write-before-render rule.
  const { error: edgeError } = await supabase.from("claim_edges").insert(
    claims.map((c) => ({
      claim_id: c.claim_id,
      producer_run_id: c.producer_run_id,
      consumer_run_id: opts.consumerRunId,
      consumer_step_index: opts.consumerStepIndex,
      claim_confidence_at_read: c.confidence,
      tripped: false,
    })),
  );
  if (edgeError) {
    throw new Error(`readClaims failed writing claim_edges: ${edgeError.message}`);
  }

  return claims;
}
