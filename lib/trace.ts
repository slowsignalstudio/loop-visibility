import { createServiceClient } from "./supabaseClient";

/** A single agent hop within a run/loop. Mirrors the `public.traces` table. */
export type Trace = {
  id: string;
  run_id: string;
  parent_id: string | null;
  hop_index: number;
  agent: string;
  event: string;
  status: "ok" | "error" | "pending";
  input: unknown;
  output: unknown;
  error: string | null;
  latency_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Fields a caller supplies when recording a hop. The DB fills in id/created_at. */
export type TraceInput = {
  run_id: string;
  parent_id?: string | null;
  hop_index: number;
  agent: string;
  event?: string;
  status?: Trace["status"];
  input?: unknown;
  output?: unknown;
  error?: string | null;
  latency_ms?: number | null;
  metadata?: Record<string, unknown>;
};

/**
 * Persist one agent hop. Working rule: EVERY agent hop calls writeTrace BEFORE
 * anything is rendered — the trace row is the source of truth, the viewer only
 * reflects it. Throws on failure so a hop can never silently go untraced.
 */
export async function writeTrace(hop: TraceInput): Promise<Trace> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("traces")
    .insert({
      run_id: hop.run_id,
      parent_id: hop.parent_id ?? null,
      hop_index: hop.hop_index,
      agent: hop.agent,
      event: hop.event ?? "step",
      status: hop.status ?? "ok",
      input: hop.input ?? null,
      output: hop.output ?? null,
      error: hop.error ?? null,
      latency_ms: hop.latency_ms ?? null,
      metadata: hop.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    throw new Error(`writeTrace failed: ${error.message}`);
  }
  return data as Trace;
}

/** Fetch all hops for a run, ordered as the loop executed. */
export async function getRun(runId: string): Promise<Trace[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("traces")
    .select()
    .eq("run_id", runId)
    .order("hop_index", { ascending: true });

  if (error) {
    throw new Error(`getRun failed: ${error.message}`);
  }
  return (data ?? []) as Trace[];
}
