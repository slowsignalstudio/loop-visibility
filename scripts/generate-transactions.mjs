// Deterministic generator for the synthetic money-check-in dataset.
// Run: node scripts/generate-transactions.mjs
// Ground truth is planted here and documented in data/GROUND_TRUTH.md — this script is
// the single source of that truth, so the demo can assert against it.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "data");

// Seeded PRNG (mulberry32) so the committed dataset is stable and reproducible.
function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260706);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const money = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;

// Q2 2026 — the three-month window the check-in covers.
const MONTHS = ["2026-04", "2026-05", "2026-06"];
const iso = (ym, day) => `${ym}-${String(day).padStart(2, "0")}`;

const rows = [];
let n = 0;
const add = (date, merchant, amount, category) =>
  rows.push({ id: `txn_${String(++n).padStart(4, "0")}`, date, merchant, amount, category });

// --- Recurring subscriptions: same merchant, monthly cadence, stable amount ---
// Three carry a PLANTED price increase in June (apr === may < jun).
const subs = [
  { merchant: "Netflix", day: 4, amounts: [15.49, 15.49, 17.99] }, // planted +2.50
  { merchant: "Spotify", day: 9, amounts: [9.99, 9.99, 9.99] },
  { merchant: "The New York Times", day: 15, amounts: [17.0, 17.0, 25.0] }, // planted +8.00
  { merchant: "iCloud+", day: 1, amounts: [2.99, 2.99, 2.99] },
  { merchant: "YouTube Premium", day: 22, amounts: [13.99, 13.99, 18.99] }, // planted +5.00
  { merchant: "GitHub", day: 2, amounts: [4.0, 4.0, 4.0] },
  { merchant: "Notion", day: 12, amounts: [10.0, 10.0, 10.0] },
  { merchant: "Planet Fitness", day: 17, amounts: [24.99, 24.99, 24.99] },
];
for (const s of subs) {
  MONTHS.forEach((ym, i) => add(iso(ym, s.day), s.merchant, s.amounts[i], "subscription"));
}

// --- The TRAP: a real recurring SUBSCRIPTION (so a subscriptions-only gather includes it),
// but usage-metered — the charge differs every month and trends up. A naive delta flags a
// "price increase"; verify must reject it because there is no stable base price that
// "changed". This is the false positive the demo turns on. ---
const trap = { merchant: "AWS", day: 3, amounts: [22.14, 41.88, 68.02] };
MONTHS.forEach((ym, i) => add(iso(ym, trap.day), trap.merchant, trap.amounts[i], "subscription"));

// --- Noise: a few hundred one-off, non-recurring transactions ---
const oneOff = {
  groceries: ["Whole Foods", "Trader Joe's", "Safeway", "Costco"],
  dining: ["Chipotle", "Sweetgreen", "Blue Bottle", "Local Thai", "Pizzeria Delfina", "Ramen Nagi"],
  transport: ["Uber", "Lyft", "Shell", "Chevron", "Clipper Card"],
  shopping: ["Amazon", "Target", "Uniqlo", "Best Buy", "REI"],
  coffee: ["Starbucks", "Philz Coffee", "Peet's"],
  entertainment: ["AMC Theatres", "Steam", "Ticketmaster"],
};
const cats = Object.keys(oneOff);
const ranges = {
  groceries: [18, 190], dining: [9, 65], transport: [3, 48],
  shopping: [12, 240], coffee: [4, 14], entertainment: [11, 120],
};
const TARGET = 300;
while (rows.length < TARGET) {
  const cat = pick(cats);
  const ym = pick(MONTHS);
  const day = 1 + Math.floor(rand() * 28);
  add(iso(ym, day), pick(oneOff[cat]), money(ranges[cat][0], ranges[cat][1]), cat);
}

rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "transactions.json"), JSON.stringify(rows, null, 2) + "\n");

// --- Self-check: assert the planted ground truth is actually present ---
const byMerchant = (m) => rows.filter((r) => r.merchant === m).sort((a, b) => (a.date < b.date ? -1 : 1));
const planted = ["Netflix", "The New York Times", "YouTube Premium"];
let totalImpact = 0;
console.log(`Wrote ${rows.length} transactions to data/transactions.json\n`);
console.log("Planted price increases (Apr → Jun):");
for (const m of planted) {
  const t = byMerchant(m);
  const from = t[0].amount, to = t[t.length - 1].amount;
  const delta = Math.round((to - from) * 100) / 100;
  totalImpact += delta;
  if (!(from === t[1].amount && to > from)) throw new Error(`BAD PLANT: ${m}`);
  console.log(`  ${m}: ${from} → ${to}  (+${delta}/mo)`);
}
console.log(`  Total monthly impact: +${Math.round(totalImpact * 100) / 100}\n`);

const trapRows = byMerchant(trap.merchant);
const distinct = new Set(trapRows.map((r) => r.amount));
if (distinct.size !== trapRows.length) throw new Error("BAD TRAP: amounts not all distinct");
console.log(`Trap (false positive): ${trap.merchant} ${trapRows.map((r) => r.amount).join(" → ")}`);
console.log("  every month differs → usage-based, not a subscription price change → verify must reject.");
