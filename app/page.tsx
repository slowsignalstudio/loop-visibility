"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabaseClient";
import type { Trace } from "@/lib/trace";

// The viewer reads ONLY from trace rows. It subscribes to the `traces` table via Supabase
// realtime, filtered by run_id, and appends each row as formatted JSON in a monospace
// column. A 1-second poll runs alongside as the fallback (and initial load) so the viewer
// works even before realtime's publication is enabled. No styling yet (Day 3).

export default function Home() {
  const [rows, setRows] = useState<Trace[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [transport, setTransport] = useState<"idle" | "polling" | "realtime">("idle");
  const seen = useRef<Set<string>>(new Set());

  const addRows = useCallback((incoming: Trace[]) => {
    setRows((prev) => {
      const next = prev.slice();
      for (const r of incoming) {
        if (seen.current.has(r.id)) continue;
        seen.current.add(r.id);
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
      const { data } = await supabase.from("traces").select().eq("run_id", runId).order("step_index");
      setTransport((t) => (t === "realtime" ? t : "polling"));
      if (data) addRows(data as Trace[]);
    };
    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [runId, running, addRows]);

  const start = useCallback(async () => {
    const id = crypto.randomUUID();
    seen.current = new Set();
    setRows([]);
    setRunId(id);
    setRunning(true);
    try {
      await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: id }),
      });
    } finally {
      // Final catch-up read so the last rows land even if realtime isn't enabled.
      const supabase = createBrowserClient();
      const { data } = await supabase.from("traces").select().eq("run_id", id).order("step_index");
      if (data) addRows(data as Trace[]);
      setRunning(false);
    }
  }, [addRows]);

  return (
    <main>
      <h1>Loop Visibility</h1>
      <button onClick={start} disabled={running}>
        {running ? "Running…" : "Run money check-in"}
      </button>
      <p>
        run_id: {runId ?? "—"} · transport: {transport} · rows: {rows.length}
      </p>
      <div>
        {rows.length === 0 ? (
          <p>No trace rows yet. Start a run to watch hops arrive.</p>
        ) : (
          rows.map((r) => (
            <pre key={r.id} style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(r, null, 2)}
            </pre>
          ))
        )}
      </div>
    </main>
  );
}
