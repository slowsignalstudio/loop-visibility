import { createServiceClient } from "@/lib/supabaseClient";
import type { Trace } from "@/lib/trace";

export const dynamic = "force-dynamic";

// Unstyled on purpose: per the working rules, no styling until Day 3. This renders
// the most recent trace rows so we can confirm the write path end-to-end first.
export default async function Home() {
  let rows: Trace[] = [];
  let err: string | null = null;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("traces")
      .select()
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    rows = (data ?? []) as Trace[];
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <main>
      <h1>Loop Visibility</h1>
      {err ? (
        <p>Could not load traces: {err}</p>
      ) : rows.length === 0 ? (
        <p>No traces yet. Every agent hop should call writeTrace().</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>run_id</th>
              <th>step</th>
              <th>phase</th>
              <th>tool_name</th>
              <th>model_confidence</th>
              <th>verification</th>
              <th>created_at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.run_id}</td>
                <td>{r.step_index}</td>
                <td>{r.phase}</td>
                <td>{r.tool_name ?? ""}</td>
                <td>{r.model_confidence ?? ""}</td>
                <td>{r.verification ? JSON.stringify(r.verification) : ""}</td>
                <td>{r.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
