import { describe, expect, it } from "vitest";
import { rollUpRun, rollUpRuns } from "./fleet";
import type { Trace } from "./trace";

// Fabricate trace rows in the exact shapes the real tools write, so the roll-up is
// tested against the same jsonb it will meet in production.

let seq = 0;
function hop(partial: Partial<Trace>): Trace {
  seq += 1;
  return {
    id: `id-${seq}`,
    run_id: "run-1",
    step_index: seq,
    phase: "gather",
    tool_name: null,
    tool_input: null,
    tool_output: null,
    model_confidence: null,
    verification: null,
    created_at: `2026-07-08T10:00:${String(seq).padStart(2, "0")}Z`,
    ...partial,
  };
}

const change = (merchant: string, old_price: number, new_price: number) => ({
  merchant,
  old_price,
  new_price,
  delta: new_price - old_price,
});

const result = (merchant: string, old_price: number, new_price: number, pass: boolean) => ({
  merchant,
  claim: { old_price, new_price },
  pass,
  reason: pass ? "clean step" : "no clean step",
  supporting_rows: [],
});

function fullRun(opts: {
  confidence: string;
  flagged: ReturnType<typeof change>[];
  results: ReturnType<typeof result>[];
}): Trace[] {
  return [
    hop({ phase: "gather", tool_name: "lookup_transactions", tool_output: { count: 42, rows: [] } }),
    hop({
      phase: "act",
      tool_name: "analyze_recurring",
      model_confidence: opts.confidence,
      tool_output: { price_changes: opts.flagged, total_monthly_impact: 0 },
    }),
    hop({
      phase: "verify",
      tool_name: "verify_findings",
      tool_output: {
        passed: opts.results.filter((r) => r.pass).length,
        failed: opts.results.filter((r) => !r.pass).length,
        results: opts.results,
      },
    }),
  ];
}

describe("rollUpRun", () => {
  it("marks a clean, fully verified run safe with the verified total", () => {
    const s = rollUpRun(
      fullRun({
        confidence: "High confidence: three clear step changes in the data.",
        flagged: [change("Netflix", 15.49, 17.99), change("NYT", 17, 25)],
        results: [result("Netflix", 15.49, 17.99, true), result("NYT", 17, 25, true)],
      }),
    );
    expect(s.triage).toBe("safe");
    expect(s.reasons).toEqual([]);
    expect(s.passed).toBe(2);
    expect(s.totalImpact).toBe(10.5);
    expect(s.headline).toContain("Confirmed all 2 claims");
  });

  it("treats a reversal whose hedge named the reversed claim as discharged doubt (safe, badge visible)", () => {
    const s = rollUpRun(
      fullRun({
        confidence: "Confident on the three step changes; AWS looks usage-metered, not a fixed subscription.",
        flagged: [change("Netflix", 15.49, 17.99), change("AWS", 32.5, 41.88)],
        results: [result("Netflix", 15.49, 17.99, true), result("AWS", 32.5, 41.88, false)],
      }),
    );
    expect(s.triage).toBe("safe");
    expect(s.reversed).toBe(1);
    expect(s.headline).toContain("reversed 1");
  });

  it("routes attention when a hedge names a claim that passed anyway", () => {
    const s = rollUpRun(
      fullRun({
        confidence: "Not sure about Spotify — the charge pattern is unclear.",
        flagged: [change("Spotify", 9.99, 11.99)],
        results: [result("Spotify", 9.99, 11.99, true)],
      }),
    );
    expect(s.triage).toBe("needs_you");
    expect(s.reasons[0]).toContain("Spotify");
  });

  it("routes attention when a hedge names nothing checkable", () => {
    const s = rollUpRun(
      fullRun({
        confidence: "Possibly noisy data this quarter, hard to say.",
        flagged: [change("Netflix", 15.49, 17.99)],
        results: [result("Netflix", 15.49, 17.99, true)],
      }),
    );
    expect(s.triage).toBe("needs_you");
    expect(s.reasons[0]).toContain("no verify verdict discharged it");
  });

  it("routes attention when a flagged claim never reached verify", () => {
    const s = rollUpRun(
      fullRun({
        confidence: "High confidence across the board.",
        flagged: [change("Netflix", 15.49, 17.99), change("Hulu", 7.99, 9.99)],
        results: [result("Netflix", 15.49, 17.99, true)],
      }),
    );
    expect(s.triage).toBe("needs_you");
    expect(s.unverified).toBe(1);
    expect(s.reasons[0]).toContain("Hulu");
  });

  it("routes attention when the run has claims but no verify hop at all", () => {
    const rows = fullRun({
      confidence: "High confidence.",
      flagged: [change("Netflix", 15.49, 17.99)],
      results: [],
    }).filter((h) => h.phase !== "verify");
    const s = rollUpRun(rows);
    expect(s.triage).toBe("needs_you");
    expect(s.totalImpact).toBeNull();
    expect(s.headline).toContain("unverified");
  });

  it('routes attention on the sentinel "no confidence stated"', () => {
    const s = rollUpRun(
      fullRun({
        confidence: "no confidence stated",
        flagged: [change("Netflix", 15.49, 17.99)],
        results: [result("Netflix", 15.49, 17.99, true)],
      }),
    );
    expect(s.triage).toBe("needs_you");
  });

  it("routes attention when the run stopped before act", () => {
    const s = rollUpRun([
      hop({ phase: "gather", tool_name: "lookup_transactions", tool_output: { count: 42, rows: [] } }),
    ]);
    expect(s.triage).toBe("needs_you");
    expect(s.headline).toContain("no analysis");
  });
});

describe("rollUpRuns", () => {
  it("groups by run_id and returns newest run first", () => {
    const a = fullRun({
      confidence: "High confidence.",
      flagged: [change("Netflix", 15.49, 17.99)],
      results: [result("Netflix", 15.49, 17.99, true)],
    }).map((h) => ({ ...h, run_id: "run-a", created_at: "2026-07-08T09:00:00Z" }));
    const b = fullRun({
      confidence: "High confidence.",
      flagged: [change("NYT", 17, 25)],
      results: [result("NYT", 17, 25, true)],
    }).map((h) => ({ ...h, run_id: "run-b", created_at: "2026-07-08T11:00:00Z" }));

    const signals = rollUpRuns([...a, ...b]);
    expect(signals.map((s) => s.runId)).toEqual(["run-b", "run-a"]);
  });
});
