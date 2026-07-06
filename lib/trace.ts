import { createServiceClient } from "./supabaseClient";

/** One hop in a run. Mirrors the `traces` table. Evidence (tool_input/tool_output)
 *  sits next to the verdict (model_confidence/verification). */
export type Trace = {
  id: string;
  run_id: string;
  step_index: number;
  phase: string;
  tool_name: string | null;
  tool_input: unknown;
  tool_output: unknown;
  model_confidence: string | null;
  verification: unknown;
  created_at: string;
};

/** Fields a caller supplies when recording a hop. The DB fills in id/created_at. */
export type TraceInput = {
  run_id: string;
  step_index: number;
  phase: string;
  tool_name?: string | null;
  tool_input?: unknown;
  tool_output?: unknown;
  model_confidence?: string | null;
  verification?: unknown;
};

/**
 * Persist one hop. Working rule: EVERY hop calls writeTrace BEFORE anything is
 * rendered, and records its evidence next to its verdict — the viewer can only show
 * what this row preserves. Throws on failure so a hop can never silently go untraced.
 */
export async function writeTrace(hop: TraceInput): Promise<Trace> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("traces")
    .insert({
      run_id: hop.run_id,
      step_index: hop.step_index,
      phase: hop.phase,
      tool_name: hop.tool_name ?? null,
      tool_input: hop.tool_input ?? null,
      tool_output: hop.tool_output ?? null,
      model_confidence: hop.model_confidence ?? null,
      verification: hop.verification ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`writeTrace failed: ${error.message}`);
  }
  return data as Trace;
}

/** Fetch all hops for a run, ordered as the run executed. */
export async function getRun(runId: string): Promise<Trace[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("traces")
    .select()
    .eq("run_id", runId)
    .order("step_index", { ascending: true });

  if (error) {
    throw new Error(`getRun failed: ${error.message}`);
  }
  return (data ?? []) as Trace[];
}
