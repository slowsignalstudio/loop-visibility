import { afterEach, describe, expect, it, vi } from "vitest";
import { extractVerifiedClaims, readClaims } from "./claims";
import { runTool } from "./toolRunners";
import type { Trace } from "./trace";

// ---------------------------------------------------------------------------
// Mocked Supabase client, same pattern as trace.test.ts: the tests exercise
// extraction, edge-writing order, and error handling without a live database.
// ---------------------------------------------------------------------------

const state = {
  tracesResult: { data: null as unknown, error: null as { message: string } | null },
  edgeResult: { error: null as { message: string } | null },
  insertedEdges: null as Record<string, unknown>[] | null,
};

vi.mock("./supabaseClient", () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === "traces") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => state.tracesResult,
            }),
          }),
        };
      }
      if (table === "claim_edges") {
        return {
          insert: async (payload: Record<string, unknown>[]) => {
            state.insertedEdges = payload;
            return state.edgeResult;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

afterEach(() => {
  state.tracesResult = { data: null, error: null };
  state.edgeResult = { error: null };
  state.insertedEdges = null;
});

// ---------------------------------------------------------------------------
// Fixtures in the exact shapes the tools write.
// ---------------------------------------------------------------------------

let seq = 0;
function hop(partial: Partial<Trace>): Trace {
  seq += 1;
  return {
    id: `id-${seq}`,
    run_id: "producer-run",
    step_index: seq,
    phase: "gather",
    tool_name: null,
    tool_input: null,
    tool_output: null,
    model_confidence: null,
    verification: null,
    created_at: "2026-07-08T10:00:00Z",
    ...partial,
  };
}

const CONFIDENCE = "High confidence on Netflix; AWS looks usage-metered, may be spurious.";

function producerRun(): Trace[] {
  return [
    hop({ phase: "gather", tool_output: { count: 42, rows: [] } }),
    hop({
      phase: "act",
      model_confidence: CONFIDENCE,
      tool_output: {
        price_changes: [
          { claim_id: "11111111-1111-4111-8111-111111111111", merchant: "Netflix", old_price: 15.49, new_price: 17.99, delta: 2.5 },
          { claim_id: "22222222-2222-4222-8222-222222222222", merchant: "AWS", old_price: 32.5, new_price: 41.88, delta: 9.38 },
        ],
        total_monthly_impact: 11.88,
      },
    }),
    hop({
      phase: "verify",
      tool_output: {
        passed: 1,
        failed: 1,
        results: [
          {
            claim_id: "11111111-1111-4111-8111-111111111111",
            merchant: "Netflix",
            claim: { old_price: 15.49, new_price: 17.99 },
            pass: true,
            reason: "clean step",
            supporting_rows: [],
          },
          {
            claim_id: "22222222-2222-4222-8222-222222222222",
            merchant: "AWS",
            claim: { old_price: 32.5, new_price: 41.88 },
            pass: false,
            reason: "usage-based",
            supporting_rows: [],
          },
        ],
      },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Increment A: identity is minted in act and carried through verify.
// ---------------------------------------------------------------------------

describe("claim identity (increment A)", () => {
  it("analyze_recurring mints a unique claim_id on every price change", () => {
    const out = runTool("analyze_recurring", {}).output as {
      price_changes: { claim_id: string }[];
    };
    expect(out.price_changes.length).toBeGreaterThan(0);
    const ids = out.price_changes.map((c) => c.claim_id);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("verify_findings echoes the claim_id into each result, null when omitted", () => {
    const out = runTool("verify_findings", {
      claims: [
        { claim_id: "33333333-3333-4333-8333-333333333333", merchant: "Netflix", old_price: 15.49, new_price: 17.99 },
        { merchant: "Spotify", old_price: 9.99, new_price: 11.99 },
      ],
    }).output as { results: { merchant: string; claim_id: string | null }[] };
    expect(out.results[0].claim_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(out.results[1].claim_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractVerifiedClaims: pure narrowing.
// ---------------------------------------------------------------------------

describe("extractVerifiedClaims", () => {
  it("returns only passing, id-bearing claims with the producer confidence verbatim", () => {
    const claims = extractVerifiedClaims(producerRun());
    expect(claims).toHaveLength(1);
    expect(claims[0].merchant).toBe("Netflix");
    expect(claims[0].claim_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(claims[0].delta).toBe(2.5);
    expect(claims[0].confidence).toBe(CONFIDENCE);
    expect(claims[0].producer_run_id).toBe("producer-run");
  });

  it("returns nothing when the run has no verify hop", () => {
    const rows = producerRun().filter((h) => h.phase !== "verify");
    expect(extractVerifiedClaims(rows)).toEqual([]);
  });

  it("skips a passing claim that carries no identity", () => {
    const rows = producerRun();
    const verify = rows.find((h) => h.phase === "verify")!;
    const out = verify.tool_output as { results: { claim_id: string | null }[] };
    out.results[0].claim_id = null;
    expect(extractVerifiedClaims(rows)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readClaims: edge before return, loud failures.
// ---------------------------------------------------------------------------

const OPTS = { producerRunId: "producer-run", consumerRunId: "consumer-run", consumerStepIndex: 1 };

describe("readClaims", () => {
  it("writes one edge row per consumable claim, then returns the claims", async () => {
    state.tracesResult = { data: producerRun(), error: null };
    const claims = await readClaims(OPTS);
    expect(claims).toHaveLength(1);
    expect(state.insertedEdges).toHaveLength(1);
    expect(state.insertedEdges![0]).toMatchObject({
      claim_id: "11111111-1111-4111-8111-111111111111",
      producer_run_id: "producer-run",
      consumer_run_id: "consumer-run",
      consumer_step_index: 1,
      claim_confidence_at_read: CONFIDENCE,
      tripped: false,
    });
  });

  it("writes no edges and returns [] when nothing is consumable", async () => {
    state.tracesResult = { data: producerRun().filter((h) => h.phase !== "verify"), error: null };
    const claims = await readClaims(OPTS);
    expect(claims).toEqual([]);
    expect(state.insertedEdges).toBeNull();
  });

  it("throws when the producer trace read fails", async () => {
    state.tracesResult = { data: null, error: { message: "boom" } };
    await expect(readClaims(OPTS)).rejects.toThrow(/readClaims failed reading producer traces: boom/);
  });

  it("throws — returning no claims — when the edge write fails", async () => {
    state.tracesResult = { data: producerRun(), error: null };
    state.edgeResult = { error: { message: "edge down" } };
    await expect(readClaims(OPTS)).rejects.toThrow(/readClaims failed writing claim_edges: edge down/);
  });
});
