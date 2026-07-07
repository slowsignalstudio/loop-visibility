import type { Trace } from "./trace";

/**
 * Turn one raw trace row into a human one-liner for the viewer.
 *
 * This is a PURE function: same row in, same summary out, no side effects. That's
 * deliberate — it keeps all the messy "reach into jsonb and pull out fields" logic in
 * one place we can unit-test on Day 4, so the component (StepRow) stays about layout.
 */

export type StepTone = "neutral" | "flag" | "pass" | "fail";

export type StepSummary = {
  phase: string; // gather | act | verify
  tool: string; // the tool_name, e.g. "lookup_transactions"
  headline: string; // human sentence: what this hop did
  status: string; // short chip: "42 rows", "3 flagged", "2 passed · 1 failed"
  tone: StepTone; // drives the colour of the row
};

// `tool_output` is stored as jsonb, so TypeScript sees it as `unknown`. We narrow the
// shape here before reading fields, rather than casting all over the JSX.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

export function summarize(row: Trace): StepSummary {
  const tool = row.tool_name ?? "—";
  const out = row.tool_output;

  if (row.phase === "gather" && isRecord(out)) {
    const count = num(out.count);
    return {
      phase: "gather",
      tool,
      headline: `Read ${count} transaction${count === 1 ? "" : "s"} from the ledger.`,
      status: `${count} rows`,
      tone: "neutral",
    };
  }

  if (row.phase === "act" && isRecord(out)) {
    const changes = Array.isArray(out.price_changes) ? out.price_changes : [];
    const total = num(out.total_monthly_impact);
    return {
      phase: "act",
      tool,
      headline:
        changes.length === 0
          ? "No price increases detected this quarter."
          : `Flagged ${changes.length} price increase${changes.length === 1 ? "" : "s"}, +$${total}/mo.`,
      status: `${changes.length} flagged`,
      tone: changes.length > 0 ? "flag" : "neutral",
    };
  }

  if (row.phase === "verify" && isRecord(out)) {
    const passed = num(out.passed);
    const failed = num(out.failed);
    return {
      phase: "verify",
      tool,
      headline:
        failed > 0
          ? `Confirmed ${passed}, reversed ${failed} false positive${failed === 1 ? "" : "s"}.`
          : `Confirmed all ${passed} claim${passed === 1 ? "" : "s"} against the raw rows.`,
      status: `${passed} passed · ${failed} failed`,
      tone: failed > 0 ? "fail" : "pass",
    };
  }

  // Fallback for any phase/shape we don't recognise, so the viewer never crashes.
  return { phase: row.phase, tool, headline: "", status: "", tone: "neutral" };
}
