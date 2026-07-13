import { createServiceClient } from "./supabaseClient";

/** One supervisor decision on a run. Mirrors the `reviews` table. */
export type Review = {
  id: string;
  run_id: string;
  decision: ReviewDecision;
  rationale: string | null;
  created_at: string;
};

export type ReviewDecision = "approved" | "rejected" | "cleared_safe";

export const REVIEW_DECISIONS: ReviewDecision[] = ["approved", "rejected", "cleared_safe"];

/**
 * Record one decision across one or more runs (clear-safe is a batch of runs sharing a
 * rationale). Server-only — writes go through the service client. Throws on failure so
 * a decision can never silently go unrecorded, mirroring writeTrace.
 */
export async function recordReviews(
  runIds: string[],
  decision: ReviewDecision,
  rationale?: string,
): Promise<Review[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("reviews")
    .insert(runIds.map((run_id) => ({ run_id, decision, rationale: rationale ?? null })))
    .select();

  if (error) {
    throw new Error(`recordReviews failed: ${error.message}`);
  }
  return (data ?? []) as Review[];
}
