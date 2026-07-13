import { randomUUID } from "node:crypto";
import { runDrafter } from "@/lib/drafter";
import { writeTrace } from "@/lib/trace";

// Runs the cancellation-drafter loop (the claim graph's first consumer) server-side.
// Same integrity rule as /api/run: every hop's trace row is written BEFORE its result
// is fed back to the model, and the claim_edges rows are written inside readClaims
// before the claims reach the model at all.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  let body: { run_id?: unknown; producer_run_id?: unknown; monthly_limit?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* no body */
  }

  const producer_run_id =
    typeof body.producer_run_id === "string" && UUID_RE.test(body.producer_run_id)
      ? body.producer_run_id
      : null;
  if (!producer_run_id) {
    return Response.json({ error: "producer_run_id must be a uuid" }, { status: 400 });
  }
  const run_id =
    typeof body.run_id === "string" && UUID_RE.test(body.run_id) ? body.run_id : randomUUID();
  const monthly_limit = typeof body.monthly_limit === "number" ? body.monthly_limit : undefined;

  try {
    const result = await runDrafter({
      runId: run_id,
      producerRunId: producer_run_id,
      monthlyLimit: monthly_limit,
      onHop: (hop) =>
        writeTrace({
          run_id,
          step_index: hop.step_index,
          phase: hop.phase,
          tool_name: hop.tool_name,
          tool_input: hop.tool_input,
          tool_output: hop.tool_output,
          model_confidence: hop.model_confidence,
          verification: hop.verification,
        }).then(() => undefined),
    });

    return Response.json({
      run_id,
      producer_run_id,
      steps: result.steps,
      stop_reason: result.stop_reason,
      final: result.final,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Drafter run failed" },
      { status: 500 },
    );
  }
}
