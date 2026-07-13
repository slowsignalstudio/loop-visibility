import transactionsData from "@/data/transactions.json";

export type Txn = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
};

const transactions = transactionsData as Txn[];

export type Phase = "gather" | "act" | "verify";
export type ToolResult = { phase: Phase; output: unknown; verification?: unknown };

const byDate = (a: Txn, b: Txn) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const forMerchant = (m: string) =>
  transactions.filter((t) => t.merchant === m).sort(byDate);

// gather — read and filter rows from the dataset.
function lookupTransactions(input: Record<string, unknown>): ToolResult {
  const { merchant, category, start_date, end_date, min_amount } = input as {
    merchant?: string; category?: string; start_date?: string; end_date?: string; min_amount?: number;
  };
  const rows = transactions.filter(
    (t) =>
      (!merchant || t.merchant === merchant) &&
      (!category || t.category === category) &&
      (!start_date || t.date >= start_date) &&
      (!end_date || t.date <= end_date) &&
      (min_amount == null || t.amount >= min_amount),
  );
  return { phase: "gather", output: { count: rows.length, rows } };
}

// act — find recurring merchants, compute deltas, draft a recommendation.
function analyzeRecurring(input: Record<string, unknown>): ToolResult {
  const rows = (Array.isArray(input.transactions) && input.transactions.length
    ? (input.transactions as Txn[])
    : transactions
  ).slice();
  const groups = new Map<string, Txn[]>();
  for (const t of rows) (groups.get(t.merchant) ?? groups.set(t.merchant, []).get(t.merchant)!).push(t);

  // Every claim is minted with an identity at write time (claim graph, increment A).
  // Nothing can point at an anonymous claim, and the dependency graph needs claims to be
  // addressable the moment they exist — not retrofitted later.
  const price_changes: { claim_id: string; merchant: string; old_price: number; new_price: number; delta: number }[] = [];
  const recurring_merchants: string[] = [];
  for (const [merchant, list] of groups) {
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 2) continue; // not recurring
    recurring_merchants.push(merchant);
    const sorted = list.slice().sort(byDate);
    const oldP = sorted[0].amount;
    const newP = sorted[sorted.length - 1].amount;
    if (newP > oldP) {
      price_changes.push({
        claim_id: crypto.randomUUID(),
        merchant,
        old_price: oldP,
        new_price: newP,
        delta: Math.round((newP - oldP) * 100) / 100,
      });
    }
  }
  const total_monthly_impact = Math.round(price_changes.reduce((s, c) => s + c.delta, 0) * 100) / 100;
  const recommendation =
    price_changes.length === 0
      ? "No subscription price increases detected this quarter."
      : `Detected ${price_changes.length} apparent price increase(s) totaling +$${total_monthly_impact}/mo: ` +
        price_changes.map((c) => `${c.merchant} $${c.old_price}→$${c.new_price}`).join(", ") +
        ". Review and consider cancelling or downgrading the largest.";
  return { phase: "act", output: { recurring_merchants, price_changes, total_monthly_impact, recommendation } };
}

// verify — re-test each claimed change against the raw rows; catch usage-based false positives.
function verifyFindings(input: Record<string, unknown>): ToolResult {
  const claims = (Array.isArray(input.claims) ? input.claims : []) as {
    claim_id?: string; merchant: string; old_price: number; new_price: number;
  }[];
  const results = claims.map((claim) => {
    const rows = forMerchant(claim.merchant);
    const amounts = rows.map((r) => r.amount);
    // A genuine subscription price change is a clean step: every charge is either the old
    // or the new price, starting at old and ending at new. Usage-based merchants vary every
    // period, so they fail here — that's the trap being corrected.
    const cleanStep =
      rows.length >= 2 &&
      claim.old_price !== claim.new_price &&
      amounts[0] === claim.old_price &&
      amounts[amounts.length - 1] === claim.new_price &&
      amounts.every((a) => a === claim.old_price || a === claim.new_price);
    return {
      // The verdict carries the id of the claim it judged, so an edge can reference a
      // VERIFIED claim, not just a merchant name. Null when the caller omitted it —
      // recorded visibly rather than silently invented, like "no confidence stated".
      claim_id: claim.claim_id ?? null,
      merchant: claim.merchant,
      claim: { old_price: claim.old_price, new_price: claim.new_price },
      pass: cleanStep,
      reason: cleanStep
        ? "Clean price step confirmed against raw rows."
        : `Charge varies every period (${amounts.join(", ")}); usage-based, not a fixed subscription price change.`,
      supporting_rows: rows,
    };
  });
  const passed = results.filter((r) => r.pass).length;
  const summary = { passed, failed: results.length - passed, results };
  return { phase: "verify", output: summary, verification: summary };
}

export function runTool(name: string, input: Record<string, unknown>): ToolResult {
  switch (name) {
    case "lookup_transactions": return lookupTransactions(input);
    case "analyze_recurring": return analyzeRecurring(input);
    case "verify_findings": return verifyFindings(input);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
