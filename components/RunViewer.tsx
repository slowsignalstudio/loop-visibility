"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { createBrowserClient } from "@/lib/supabaseClient";
import type { Trace } from "@/lib/trace";
import StepRow from "@/components/StepRow";

// Given the hops so far, name the phase the agent is most likely working on next. Used
// only for the live "thinking" indicator, so a rough guess based on the arc is fine.
function nextPhaseLabel(rows: Trace[]): string {
  const last = rows[rows.length - 1]?.phase;
  if (!last) return "declaring its stakes";
  if (last === "plan") return "gathering transactions";
  if (last === "gather") return "analysing recurring charges";
  if (last === "act") return "verifying each claim against the raw rows";
  return "drafting the recommendation";
}

// Level 3 of the fleet supervisor: the hop trace. The viewer reads ONLY from trace rows.
// It subscribes to the `traces` table via Supabase realtime, filtered by run_id, with a
// 1-second poll as the fallback while a run is in flight. Passing `initialRunId` opens an
// existing run (the drill-down path from the fleet overview); with no id it is the
// start-a-run surface it has always been.

export default function RunViewer({ initialRunId }: { initialRunId?: string }) {
  const [rows, setRows] = useState<Trace[]>([]);
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
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

  // Consume this run's verified claims with the cancellation-drafter loop (the claim
  // graph's first consumer). The viewer swaps to the consumer's run_id and watches its
  // trace land; the URL is patched shallowly so a reload lands on the new run.
  const draftFrom = useCallback(async () => {
    const producerId = runId;
    if (!producerId) return;
    const id = crypto.randomUUID();
    setRows([]);
    setError(null);
    setRunId(id);
    setRunning(true);
    window.history.replaceState(null, "", `/run/${id}`);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: id, producer_run_id: producerId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Draft failed with HTTP ${res.status}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error reaching /api/draft.");
    } finally {
      const supabase = createBrowserClient();
      const { data, error: readErr } = await supabase
        .from("traces")
        .select()
        .eq("run_id", id)
        .order("step_index");
      if (readErr) setError(`Read failed: ${readErr.message}`);
      else if (data) addRows(data as Trace[]);
      setRunning(false);
    }
  }, [runId, addRows]);

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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-stone-400 transition hover:text-stone-600"
        >
          <span aria-hidden>←</span> Fleet overview
        </Link>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Hop trace
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">Loop Visibility</h1>
        <p className="mt-2 max-w-prose text-stone-500">
          Watch the agent gather, act, and verify. Every claim carries its evidence, so you
          can trust the result at the moment it is made.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          onClick={start}
          disabled={running}
          className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:opacity-50"
        >
          {running ? "Running…" : "Run money check-in"}
        </button>
        {!running && rows.some((r) => r.phase === "verify" && r.tool_name === "verify_findings") && (
          <button
            onClick={draftFrom}
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            Draft cancellations from this run
          </button>
        )}
        <div className="flex items-center gap-2 text-xs text-stone-400">
          <span className="font-mono">{runId ? runId.slice(0, 8) : "—"}</span>
          <span aria-hidden>·</span>
          <span>{transport}</span>
          <span aria-hidden>·</span>
          <span>{rows.length} hops</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">Run error: </span>
          {error}
        </div>
      )}

      {rows.length === 0 && !running ? (
        <div className="rounded-xl border border-dashed border-stone-300 px-6 py-14 text-center text-sm text-stone-400">
          {initialRunId
            ? "No trace rows found for this run."
            : "No trace rows yet. Start a run to watch the loop unfold."}
        </div>
      ) : (
        <motion.div layout className="space-y-2">
          {rows.map((r, i) => (
            <StepRow key={r.id} row={r} isLatest={running && i === rows.length - 1} />
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
                className="flex items-center gap-3 rounded-xl border border-dashed border-stone-300 px-4 py-3.5"
              >
                <span className="flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" />
                </span>
                <span className="text-sm text-stone-500">Agent is {nextPhaseLabel(rows)}…</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </main>
  );
}
