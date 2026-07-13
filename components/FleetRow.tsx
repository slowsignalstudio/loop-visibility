"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { RunSignal } from "@/lib/fleet";
import type { ReviewDecision } from "@/lib/reviews";

// One run in the fleet overview: the rolled-up trust object. The signal derives from the
// run's CLAIMS, never the agent — headline verdict, the model's confidence verbatim, and
// chips for confirmed / reversed / unverified, so doubt and evidence stay visible at the
// top level instead of being stripped on the way up.

const decisionLabel: Record<ReviewDecision, string> = {
  approved: "Approved",
  rejected: "Rejected",
  cleared_safe: "Cleared",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function FleetRow({
  signal,
  review,
}: {
  signal: RunSignal;
  review?: ReviewDecision;
}) {
  const needsYou = signal.triage === "needs_you" && !review;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Link
        href={`/run/${signal.runId}`}
        className={`block rounded-xl border px-4 py-3.5 transition hover:border-stone-300 hover:shadow-sm ${
          needsYou ? "border-amber-300 bg-amber-50/50" : "border-stone-200 bg-white"
        } ${review ? "opacity-70" : ""}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${needsYou ? "bg-amber-500" : "bg-emerald-500"}`}
            aria-hidden
          />
          <span className="flex-1 truncate text-sm font-medium text-stone-800">
            {signal.headline}
          </span>

          <span className="flex shrink-0 items-center gap-1.5">
            {signal.passed > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {signal.passed} confirmed
              </span>
            )}
            {signal.reversed > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {signal.reversed} reversed
              </span>
            )}
            {signal.unverified > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                {signal.unverified} unverified
              </span>
            )}
            {review && (
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                {decisionLabel[review]}
              </span>
            )}
          </span>

          <span className="w-16 shrink-0 text-right text-xs text-stone-400">
            {signal.startedAt ? timeAgo(signal.startedAt) : "—"}
          </span>
        </div>

        {signal.confidence && (
          <p className="mt-1.5 truncate pl-5 text-xs text-stone-400" title={signal.confidence}>
            model: “{signal.confidence}”
          </p>
        )}

        {needsYou && signal.reasons.length > 0 && (
          <p className="mt-1.5 pl-5 text-xs font-medium text-amber-700">
            {signal.reasons.join(" · ")}
          </p>
        )}
      </Link>
    </motion.div>
  );
}
