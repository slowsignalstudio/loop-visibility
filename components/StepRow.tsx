"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { Trace } from "@/lib/trace";
import { summarize, type StepTone } from "@/lib/summarize";
import VerifyEvidence from "@/components/VerifyEvidence";

// One trace row, rendered as a collapsible step. Collapsed: a one-line summary colored by
// outcome. Expanded: the model's confidence, then the designed evidence (for verify) or the
// raw input/output (for other phases).

const toneCard: Record<StepTone, string> = {
  neutral: "border-stone-200 bg-white",
  flag: "border-amber-200 bg-amber-50/60",
  pass: "border-emerald-200 bg-emerald-50/60",
  fail: "border-rose-200 bg-rose-50/60",
};

const toneChip: Record<StepTone, string> = {
  neutral: "bg-stone-100 text-stone-600",
  flag: "bg-amber-100 text-amber-700",
  pass: "bg-emerald-100 text-emerald-700",
  fail: "bg-rose-100 text-rose-700",
};

const phaseDot: Record<string, string> = {
  gather: "bg-slate-400",
  act: "bg-amber-500",
  verify: "bg-emerald-500",
};

const phaseLabel: Record<string, string> = {
  gather: "Gather",
  act: "Act",
  verify: "Verify",
};

export default function StepRow({ row, isLatest = false }: { row: Trace; isLatest?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const s = summarize(row);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`rounded-xl border ${toneCard[s.tone]} ${isLatest ? "ring-2 ring-amber-300/70" : ""}`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-300"
      >
        <span className="flex w-[4.75rem] shrink-0 items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${phaseDot[s.phase] ?? "bg-stone-300"}`} />
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {phaseLabel[s.phase] ?? s.phase}
          </span>
        </span>
        <span className="hidden shrink-0 font-mono text-xs text-stone-400 sm:inline">{s.tool}</span>
        <span className="flex-1 text-sm text-stone-800">{s.headline}</span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneChip[s.tone]}`}>
          {s.status}
        </span>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-stone-400"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-stone-200/70 px-4 py-4">
          {row.model_confidence && (
            <div className="rounded-lg bg-stone-50 px-3 py-2.5 text-sm leading-relaxed">
              <span className="font-medium text-stone-600">Model confidence </span>
              <span className="text-stone-500">{row.model_confidence}</span>
            </div>
          )}

          {s.phase === "verify" ? (
            <>
              <VerifyEvidence output={row.tool_output} />
              <details className="text-xs text-stone-400">
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

function Evidence({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <pre className="overflow-x-auto rounded-lg bg-stone-900 p-3 text-xs leading-relaxed text-stone-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
