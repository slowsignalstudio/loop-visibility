"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabaseClient";
import type { Trace } from "@/lib/trace";
import { rollUpRuns, type RunSignal } from "@/lib/fleet";
import type { Review, ReviewDecision } from "@/lib/reviews";
import FleetRow from "@/components/FleetRow";

// Level 1: the fleet overview, the supervisor's default position. Its single decision is
// WHERE DO I LOOK. Every run appears as a trust signal rolled up from its claims
// (lib/fleet.ts), grouped into what needs the supervisor and what is safe. The safe
// majority clears in one action — each cleared run still gets its own review row, so the
// single click leaves a defensible record per run. Descend only for risk.

const TRACE_PAGE = 800; // most recent hops; ~50+ runs at current loop length

export default function FleetOverview() {
  const [signals, setSignals] = useState<RunSignal[]>([]);
  const [reviewByRun, setReviewByRun] = useState<Map<string, ReviewDecision>>(new Map());
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read path: traces + reviews with the anon key, exactly what RLS exposes. Errors are
  // surfaced loudly (Day 3 lesson: silent error handling turns minutes into an hour).
  const load = useCallback(async () => {
    const supabase = createBrowserClient();
    const [traces, reviews] = await Promise.all([
      supabase.from("traces").select().order("created_at", { ascending: false }).limit(TRACE_PAGE),
      supabase.from("reviews").select().order("created_at", { ascending: false }),
    ]);
    if (traces.error) {
      setError(`Trace read failed: ${traces.error.message}`);
    } else if (reviews.error) {
      setError(
        `Review read failed: ${reviews.error.message} — has supabase/migrations/0002_reviews.sql been applied?`,
      );
    } else {
      setError(null);
      setSignals(rollUpRuns((traces.data ?? []) as Trace[]));
      const latest = new Map<string, ReviewDecision>();
      for (const r of (reviews.data ?? []) as Review[]) {
        if (!latest.has(r.run_id)) latest.set(r.run_id, r.decision); // rows arrive newest-first
      }
      setReviewByRun(latest);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial fetch. All setState in load() happens after the awaited reads resolve —
    // nothing synchronous — so this cannot cascade renders; the lint rule can't see
    // across the await boundary inside the callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const needsYou = signals.filter((s) => s.triage === "needs_you" && !reviewByRun.has(s.runId));
  const safe = signals.filter((s) => s.triage === "safe" && !reviewByRun.has(s.runId));
  const reviewed = signals.filter((s) => reviewByRun.has(s.runId));
  const reversalsCaught = signals.reduce((n, s) => n + s.reversed, 0);

  const clearSafe = useCallback(async () => {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_ids: safe.map((s) => s.runId),
          decision: "cleared_safe",
          rationale: `Cleared in fleet review: every claim verified and all doubt discharged (${safe.length} runs).`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Clear failed with HTTP ${res.status}.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error reaching /api/review.");
    } finally {
      setClearing(false);
    }
  }, [safe, load]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Fleet overview
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">Loop Visibility</h1>
        <p className="mt-2 max-w-prose text-stone-500">
          Every run rolled up to a trust signal derived from its claims, never the agent.
          Undischarged doubt rises to the top; the safe majority clears in one action.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link
          href="/run"
          className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800"
        >
          Run money check-in
        </Link>
        <button
          onClick={load}
          className="rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">Fleet error: </span>
          {error}
        </div>
      )}

      {/* Fleet health: the glanceable strip. Counts only; the anomaly that matters is
          whatever sits in the needs-you group below it. */}
      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Runs" value={loading ? "…" : String(signals.length)} />
        <Stat
          label="Need you"
          value={loading ? "…" : String(needsYou.length)}
          tone={needsYou.length > 0 ? "amber" : "stone"}
        />
        <Stat label="Safe to clear" value={loading ? "…" : String(safe.length)} tone="emerald" />
        <Stat label="Reversals caught" value={loading ? "…" : String(reversalsCaught)} />
      </div>

      {!loading && signals.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-stone-300 px-6 py-14 text-center text-sm text-stone-400">
          No runs yet. Start one, or seed a synthetic fleet with{" "}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">npm run seed:fleet</code>.
        </div>
      )}

      {needsYou.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Needs you · {needsYou.length}
          </h2>
          <div className="space-y-2">
            {needsYou.map((s) => (
              <FleetRow key={s.runId} signal={s} />
            ))}
          </div>
        </section>
      )}

      {safe.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Safe · {safe.length}
            </h2>
            <button
              onClick={clearSafe}
              disabled={clearing}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              {clearing ? "Clearing…" : `Clear all ${safe.length} safe`}
            </button>
          </div>
          <div className="space-y-2">
            {safe.map((s) => (
              <FleetRow key={s.runId} signal={s} />
            ))}
          </div>
        </section>
      )}

      {reviewed.length > 0 && (
        <details className="mb-8">
          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-stone-400">
            Reviewed · {reviewed.length}
          </summary>
          <div className="mt-3 space-y-2">
            {reviewed.map((s) => (
              <FleetRow key={s.runId} signal={s} review={reviewByRun.get(s.runId)} />
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "stone",
}: {
  label: string;
  value: string;
  tone?: "stone" | "amber" | "emerald";
}) {
  const tones = {
    stone: "text-stone-900",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
  } as const;
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-stone-400">{label}</div>
    </div>
  );
}
