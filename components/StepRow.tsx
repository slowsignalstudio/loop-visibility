"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { Trace } from "@/lib/trace";
import { summarize, type StepTone } from "@/lib/summarize";
import VerifyEvidence from "@/components/VerifyEvidence";

// One trace row, rendered as a collapsible step. Collapsed: a one-line summary.
// Expanded: the full evidence (tool_input / tool_output) plus the model's confidence.
// The read logic still lives in page.tsx; this component only draws one row.

// Tailwind classes per tone, kept in a lookup so the JSX below stays readable.
const toneStyles: Record<StepTone, string> = {
  neutral: "border-neutral-200 bg-white",
  flag: "border-amber-300 bg-amber-50",
  pass: "border-emerald-300 bg-emerald-50",
  fail: "border-rose-300 bg-rose-50",
};

const phaseLabel: Record<string, string> = {
  gather: "Gather",
  act: "Act",
  verify: "Verify",
};

export default function StepRow({ row }: { row: Trace }) {
  // useState gives this row its own open/closed memory. `expanded` is the current
  // value; `setExpanded` changes it and re-draws the row. Starts closed.
  const [expanded, setExpanded] = useState(false);
  const s = summarize(row);

  return (
    <motion.div
      // Each row eases in as it lands, so the stream reads as a rhythm rather than a
      // sudden dump. `layout` lets rows below shift smoothly when one expands.
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`rounded-lg border ${toneStyles[s.tone]} mb-2`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-300"
      >
        <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {phaseLabel[s.phase] ?? s.phase}
        </span>
        <span className="shrink-0 font-mono text-xs text-neutral-400">{s.tool}</span>
        <span className="flex-1 text-sm text-neutral-800">{s.headline}</span>
        <span className="shrink-0 rounded-full border border-neutral-200 bg-white/70 px-2 py-0.5 text-xs text-neutral-600">
          {s.status}
        </span>
        <span className="shrink-0 text-xs text-neutral-400">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-neutral-200 px-4 py-3">
          {row.model_confidence && (
            <p className="text-sm">
              <span className="font-semibold text-neutral-700">Model confidence: </span>
              <span className="italic text-neutral-600">{row.model_confidence}</span>
            </p>
          )}

          {/* The verify hop gets the designed evidence-beside-verdict view. Every other
              phase falls back to the raw input/output blocks. */}
          {s.phase === "verify" ? (
            <>
              <VerifyEvidence output={row.tool_output} />
              <details className="text-xs text-neutral-400">
                <summary className="cursor-pointer select-none">Raw evidence</summary>
                <div className="mt-2 space-y-3">
                  <Evidence label="Input" value={row.tool_input} />
                  <Evidence label="Output" value={row.tool_output} />
                </div>
              </details>
            </>
          ) : (
            <>
              <Evidence label="Input" value={row.tool_input} />
              <Evidence label="Output" value={row.tool_output} />
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

// The raw jsonb, shown only when a row is expanded. We style this properly in later steps;
// for now it's a readable dark block so you can trust what the row is summarising.
function Evidence({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      <pre className="overflow-x-auto rounded bg-neutral-900 p-3 text-xs text-neutral-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
