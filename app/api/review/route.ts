import { recordReviews, REVIEW_DECISIONS, type ReviewDecision } from "@/lib/reviews";

// Records supervisor decisions server-side (the service client never reaches the
// browser). Clearing the safe majority posts every safe run_id here in one call, so the
// single action still leaves one defensible row per run.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { run_ids?: unknown; decision?: unknown; rationale?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const runIds = Array.isArray(body.run_ids)
    ? body.run_ids.filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];
  const decision = body.decision as ReviewDecision;

  if (runIds.length === 0) {
    return Response.json({ error: "run_ids must contain at least one uuid" }, { status: 400 });
  }
  if (!REVIEW_DECISIONS.includes(decision)) {
    return Response.json(
      { error: `decision must be one of: ${REVIEW_DECISIONS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const rows = await recordReviews(
      runIds,
      decision,
      typeof body.rationale === "string" && body.rationale.trim() ? body.rationale : undefined,
    );
    return Response.json({ recorded: rows.length });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Review write failed" },
      { status: 500 },
    );
  }
}
