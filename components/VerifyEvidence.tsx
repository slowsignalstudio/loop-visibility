import type { Txn } from "@/lib/toolRunners";

// The designed evidence-beside-verdict view for a verify hop. Instead of raw JSON, each
// claim is a card that shows the verdict (confirmed / reversed) next to the raw monthly
// charges it was checked against — so the data can visibly contradict its own label.

type ClaimResult = {
  merchant: string;
  claim: { old_price: number; new_price: number };
  pass: boolean;
  reason: string;
  supporting_rows: Txn[];
};

type VerifyOutput = { passed: number; failed: number; results: ClaimResult[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// Narrow the jsonb into the shape we expect before rendering.
export function asVerifyOutput(v: unknown): VerifyOutput | null {
  if (!isRecord(v) || !Array.isArray(v.results)) return null;
  return v as VerifyOutput;
}

const month = (date: string) => date.slice(0, 7); // "2026-04-15" -> "2026-04"
const money = (n: number) => `$${n.toFixed(2)}`;

export default function VerifyEvidence({ output }: { output: unknown }) {
  const data = asVerifyOutput(output);
  if (!data) return null;

  return (
    <div className="space-y-3">
      {data.results.map((r) => {
        const { old_price, new_price } = r.claim;
        return (
          <div
            key={r.merchant}
            className={`rounded-lg border p-3 ${
              r.pass ? "border-emerald-300 bg-emerald-50/60" : "border-rose-300 bg-rose-50/60"
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-neutral-800">{r.merchant}</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-neutral-500">
                  claimed {money(old_price)} → {money(new_price)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.pass ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                  }`}
                >
                  {r.pass ? "Confirmed" : "Reversed"}
                </span>
              </div>
            </div>

            {/* The raw charges, in order. A clean subscription step is every charge either
                the old or the new price. A charge that is neither breaks the step, and we
                flag it so the eye lands on why the claim failed. */}
            <div className="flex flex-wrap gap-1.5">
              {r.supporting_rows.map((row) => {
                const fits = row.amount === old_price || row.amount === new_price;
                return (
                  <span
                    key={row.id}
                    title={row.date}
                    className={`rounded border px-2 py-1 font-mono text-xs ${
                      fits
                        ? "border-neutral-200 bg-white text-neutral-600"
                        : "border-rose-400 bg-rose-100 font-semibold text-rose-700"
                    }`}
                  >
                    <span className="text-neutral-400">{month(row.date)} </span>
                    {money(row.amount)}
                  </span>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-neutral-600">{r.reason}</p>
          </div>
        );
      })}
    </div>
  );
}
