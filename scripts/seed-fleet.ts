import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Seed a synthetic fleet: ~12 runs with deliberately varied trust shapes, written through
 * writeTrace (the integrity rule applies to seeds too — no side-door inserts), so the
 * Level 1 overview has a fleet to triage. Every bucket of lib/fleet.ts is exercised:
 * clean passes, a discharged AWS reversal, an undischarged hedge, an unverified claim,
 * a run with no verify hop, a run that stopped before act, and a missing confidence.
 *
 * Usage: npm run seed:fleet
 */

// Next loads .env.local automatically; a standalone script does not, so load it by hand.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch {
  /* fall through to whatever the environment already has */
}

// Import AFTER env is loaded — lib/supabaseClient reads process.env at call time, but
// keeping the order explicit avoids surprises if that ever changes.
import { writeTrace, type TraceInput } from "@/lib/trace";

type Change = { merchant: string; old_price: number; new_price: number };
type Result = Change & { pass: boolean; reason: string };

const txn = (merchant: string, date: string, amount: number) => ({
  id: `seed-${merchant.toLowerCase().replace(/\W+/g, "-")}-${date}`,
  date,
  merchant,
  amount,
  category: "subscription",
});

/** Three monthly charges: old, then the step to new (or noise for a trap). */
const rowsFor = (c: Change, middle?: number) => [
  txn(c.merchant, "2026-04-15", c.old_price),
  txn(c.merchant, "2026-05-15", middle ?? c.new_price),
  txn(c.merchant, "2026-06-15", c.new_price),
];

function buildRun(opts: {
  confidence: string;
  flagged: Change[];
  results: Result[] | null; // null = no verify hop at all
  gatherOnly?: boolean;
}): TraceInput[] {
  const run_id = randomUUID();
  const hops: TraceInput[] = [
    {
      run_id,
      step_index: 0,
      phase: "gather",
      tool_name: "lookup_transactions",
      tool_input: { category: "subscription", start_date: "2026-04-01", end_date: "2026-06-30" },
      tool_output: { count: 42, rows: [] },
    },
  ];
  if (opts.gatherOnly) return hops;

  const total = opts.flagged.reduce((s, c) => s + (c.new_price - c.old_price), 0);
  hops.push({
    run_id,
    step_index: 1,
    phase: "act",
    tool_name: "analyze_recurring",
    tool_input: { transactions: [] },
    tool_output: {
      price_changes: opts.flagged.map((c) => ({ ...c, delta: c.new_price - c.old_price })),
      total_monthly_impact: Math.round(total * 100) / 100,
      recommendation: "Review the verified increases below.",
    },
    model_confidence: opts.confidence,
  });

  if (opts.results) {
    const passed = opts.results.filter((r) => r.pass).length;
    const output = {
      passed,
      failed: opts.results.length - passed,
      results: opts.results.map((r) => ({
        merchant: r.merchant,
        claim: { old_price: r.old_price, new_price: r.new_price },
        pass: r.pass,
        reason: r.reason,
        supporting_rows: rowsFor(r, r.pass ? undefined : (r.old_price + r.new_price) / 2 + 0.13),
      })),
    };
    hops.push({
      run_id,
      step_index: 2,
      phase: "verify",
      tool_name: "verify_findings",
      tool_input: { claims: opts.flagged },
      tool_output: output,
      verification: output,
    });
  }
  return hops;
}

const confirmed = (c: Change): Result => ({
  ...c,
  pass: true,
  reason: `Clean step: ${c.old_price.toFixed(2)} through April, ${c.new_price.toFixed(2)} from May on.`,
});
const reversedTrap = (c: Change): Result => ({
  ...c,
  pass: false,
  reason: "No clean price step — monthly amounts vary continuously, consistent with usage-metered billing.",
});

const HIGH = "High confidence — each flagged merchant shows a single clean step between two stable prices.";

const runs: TraceInput[][] = [];

const netflix = { merchant: "Netflix", old_price: 15.49, new_price: 17.99 };
const nyt = { merchant: "The New York Times", old_price: 17.0, new_price: 25.0 };
const youtube = { merchant: "YouTube Premium", old_price: 13.99, new_price: 16.49 };
const spotify = { merchant: "Spotify", old_price: 9.99, new_price: 11.99 };
const hulu = { merchant: "Hulu", old_price: 7.99, new_price: 9.99 };
const aws = { merchant: "AWS", old_price: 32.5, new_price: 41.88 };

runs.push(
  // Six clean, fully verified runs — the safe majority.
  buildRun({ confidence: HIGH, flagged: [netflix, nyt], results: [confirmed(netflix), confirmed(nyt)] }),
  buildRun({ confidence: HIGH, flagged: [youtube], results: [confirmed(youtube)] }),
  buildRun({ confidence: HIGH, flagged: [netflix, youtube], results: [confirmed(netflix), confirmed(youtube)] }),
  buildRun({ confidence: HIGH, flagged: [nyt], results: [confirmed(nyt)] }),
  buildRun({ confidence: HIGH, flagged: [spotify, nyt], results: [confirmed(spotify), confirmed(nyt)] }),
  buildRun({ confidence: HIGH, flagged: [netflix, nyt, youtube], results: [confirmed(netflix), confirmed(nyt), confirmed(youtube)] }),

  // Two discharged reversals: the model hedged on AWS in its own words and verify
  // rejected exactly that claim. Safe, with the reversal badge kept visible.
  buildRun({
    confidence:
      "Confident on the step changes; AWS looks usage-metered rather than a fixed subscription, so that one may be spurious.",
    flagged: [netflix, aws],
    results: [confirmed(netflix), reversedTrap(aws)],
  }),
  buildRun({
    confidence:
      "Three clean steps. AWS charges vary month to month — usage-based billing, not a true price change.",
    flagged: [nyt, youtube, aws],
    results: [confirmed(nyt), confirmed(youtube), reversedTrap(aws)],
  }),

  // Undischarged hedge: the model doubted Spotify, verify passed it anyway. Needs you.
  buildRun({
    confidence: "Not sure about Spotify — the charge pattern is unclear, possibly a promo ending rather than a price change.",
    flagged: [spotify],
    results: [confirmed(spotify)],
  }),

  // Unverified claim: Hulu was flagged but never reached verify. Needs you.
  buildRun({
    confidence: HIGH,
    flagged: [netflix, hulu],
    results: [confirmed(netflix)],
  }),

  // No verify hop at all: claims made, nothing checked. Needs you.
  buildRun({ confidence: HIGH, flagged: [netflix, nyt], results: null }),

  // Stopped before act: gather ran, then the loop died. Needs you.
  buildRun({ confidence: "", flagged: [], results: null, gatherOnly: true }),

  // The sentinel: model omitted its confidence entirely. Needs you.
  buildRun({ confidence: "no confidence stated", flagged: [youtube], results: [confirmed(youtube)] }),
);

async function main() {
  let hops = 0;
  for (const run of runs) {
    for (const hop of run) {
      await writeTrace(hop);
      hops += 1;
    }
  }
  console.log(`Seeded ${runs.length} runs (${hops} hops) through writeTrace.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
