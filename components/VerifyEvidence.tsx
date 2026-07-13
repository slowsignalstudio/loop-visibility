import type { Txn } from "@/lib/toolRunners";

// The designed evidence-beside-verdict view for a verify hop. Each claim is a card that puts
// the verdict (confirmed / reversed) next to the raw monthly charges it was checked against,
// so the data can visibly contradict its own label. The charge that fits no clean step gets
// flagged, which is why the AWS reversal reads at a glance.

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
    <div className="space-y-2.5">
      {data.results.map((r) => {
        const { old_price, new_price } = r.claim;
        return (
          <div
            key={r.merchant}
            className={`rounded-xl border p-3.5 ${
              r.pass ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-stone-800">{r.merchant}</span>
                <span className="font-mono text-xs text-stone-400">
                  {money(old_price)} → {money(new_price)}
                </span>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  r.pass ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                }`}
              >
                {r.pass ? "Confirmed" : "Reversed"}
              </span>
            </div>

            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">
              Charges checked
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.supporting_rows.map((row) => {
                const fits = row.amount === old_price || row.amount === new_price;
                return (
                  <span
                    key={row.id}
                    title={row.date}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${
                      fits
                        ? "border-stone-200 bg-white text-stone-500"
                        : "border-rose-400 bg-rose-100 font-semibold text-rose-700"
                    }`}
                  >
                    <span className="text-stone-400">{month(row.date)}</span>
                    {money(row.amount)}
                  </span>
                );
              })}
            </div>

            <p
              className={`mt-3 text-xs leading-relaxed ${
                r.pass ? "text-emerald-900/70" : "text-rose-900/70"
              }`}
            >
              {r.reason}
            </p>
          </div>
        );
      })}
    </div>
  );
}
