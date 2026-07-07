"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createBrowserClient } from "@/lib/supabaseClient";
import type { Trace } from "@/lib/trace";
import StepRow from "@/components/StepRow";

// Given the hops so far, name the phase the agent is most likely working on next. Used
// only for the live "thinking" indicator, so a rough guess based on the arc is fine.
function nextPhaseLabel(rows: Trace[]): string {
  const last = rows[rows.length - 1]?.phase;
  if (!last) return "gathering transactions";
  if (last === "gather") return "analysing recurring charges";
  if (last === "act") return "verifying each claim against the raw rows";
  return "drafting the recommendation";
}

// The viewer reads ONLY from trace rows. It subscribes to the `traces` table via Supabase
// realtime, filtered by run_id, and appends each row as formatted JSON in a monospace
// column. A 1-second poll runs alongside as the fallback (and initial load) so the viewer
// works even before realtime's publication is enabled. No styling yet (Day 3).

export default function Home() {
  const [rows, setRows] = useState<Trace[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [transport, setTransport] = useState<"idle" | "polling" | "realtime">("idle");
  const [error, setError] = useState<string | null>(null);

  // Pure updater: dedupe against the rows we already have, with no external state to
  // mutate. React Strict Mode runs updaters twice in dev to catch impurity, so mutating
  // an outside Set here would drop every row on the second pass.
  const addRows = useCallback((incoming: Trace[]) => {
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.id));
      const next = prev.slice();
      for (const r of incoming) {
        if (have.has(r.id)) continue;
        have.add(r.id);
        next.push(r);
      }
      next.sort((a, b) => a.step_index - b.step_index);
      return next;
    });
  }, []);

  // Realtime subscription (+ initial load), scoped to the active run_id.
  useEffect(() => {
    if (!runId) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`traces-${runId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "traces", filter: `run_id=eq.${runId}` },
        (payload) => addRows([payload.new as Trace]),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setTransport((t) => (t === "polling" ? t : "realtime"));
      });

    supabase
      .from("traces")
      .select()
      .eq("run_id", runId)
      .order("step_index")
      .then(({ data }) => data && addRows(data as Trace[]));

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, addRows]);

  // Polling fallback — every second while a run is in flight.
  useEffect(() => {
    if (!runId || !running) return;
    const supabase = createBrowserClient();
    const poll = async () => {
      const { data, error } = await supabase
        .from("traces")
        .select()
        .eq("run_id", runId)
        .order("step_index");
      setTransport((t) => (t === "realtime" ? t : "polling"));
      if (error) {
        setError(`Read failed: ${error.message}`);
        return;
      }
      if (data) addRows(data as Trace[]);
    };
    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [runId, running, addRows]);

  const start = useCallback(async () => {
    const id = crypto.randomUUID();
    setRows([]);
    setError(null);
    setRunId(id);
    setRunning(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Run failed with HTTP ${res.status}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error reaching /api/run.");
    } finally {
      // Final catch-up read so the last rows land even if realtime isn't enabled.
      const supabase = createBrowserClient();
      const { data, error: readErr } = await supabase
        .from("traces")
        .select()
        .eq("run_id", id)
        .order("step_index");
      if (readErr) setError(`Read failed: ${readErr.message}`);
      else if (data) {
        addRows(data as Trace[]);
        if (data.length === 0) setError("Run finished but the read returned 0 rows for this run_id.");
      }
      setRunning(false);
    }
  }, [addRows]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Loop Visibility</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Watch the agent gather, act, and verify — evidence beside every verdict.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={start}
          disabled={running}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "Running…" : "Run money check-in"}
        </button>
        <span className="text-xs text-neutral-400">
          run: {runId ? runId.slice(0, 8) : "—"} · {transport} · {rows.length} hops
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">Run error: </span>
          {error}
        </div>
      )}

      {rows.length === 0 && !running ? (
        <p className="text-sm text-neutral-400">
          No trace rows yet. Start a run to watch hops arrive.
        </p>
      ) : (
        <motion.div layout>
          {rows.map((r) => (
            <StepRow key={r.id} row={r} />
          ))}

          {/* Live "thinking" state: while a run is in flight, show the agent working on
              the next hop so the wait between rows reads as progress, not a freeze. */}
          <AnimatePresence>
            {running && (
              <motion.div
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 px-4 py-3"
              >
                <span className="flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
                </span>
                <span className="text-sm text-neutral-500">
                  Agent is {nextPhaseLabel(rows)}…
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </main>
  );
}
