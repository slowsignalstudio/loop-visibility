import { randomUUID } from "node:crypto";
import { runAgent } from "@/lib/agent";
import { writeTrace } from "@/lib/trace";

// The agent loop runs entirely server-side. Per the integrity rule, every hop's trace row
// is written BEFORE its result is fed back to the model and before anything renders — the
// UI reads only from trace rows, so what it shows is provably what happened. The loop
// itself lives in lib/agent.ts so the eval harness can run the same agent.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  // The client generates the run_id up front so it can subscribe/poll before any row is
  // written, then hands it here. Fall back to a fresh uuid if none/invalid was provided.
  let provided: unknown = null;
  try {
    provided = ((await request.json()) as { run_id?: unknown } | null)?.run_id ?? null;
  } catch {
    /* no body */
  }
  const run_id = typeof provided === "string" && UUID_RE.test(provided) ? provided : randomUUID();

  try {
    const result = await runAgent({
      runId: run_id,
      // Each hop is persisted BEFORE its result goes back to the model.
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
      steps: result.steps,
      stop_reason: result.stop_reason,
      hit_max_steps: result.stop_reason === "tool_use",
      final: result.final,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Agent run failed" },
      { status: 500 },
    );
  }
}
