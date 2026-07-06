import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTrace } from "./trace";

// The Supabase client is mocked so the test exercises writeTrace's mapping and
// error handling without a live database.
const insertResult = { data: null as unknown, error: null as { message: string } | null };
const captured: { table?: string; payload?: Record<string, unknown> } = {};

vi.mock("./supabaseClient", () => ({
  createServiceClient: () => ({
    from(table: string) {
      captured.table = table;
      return {
        insert(payload: Record<string, unknown>) {
          captured.payload = payload;
          return {
            select: () => ({
              single: async () => insertResult,
            }),
          };
        },
      };
    },
  }),
}));

afterEach(() => {
  insertResult.data = null;
  insertResult.error = null;
  captured.table = undefined;
  captured.payload = undefined;
});

describe("writeTrace", () => {
  it("maps evidence + verdict fields and writes to the traces table", async () => {
    insertResult.data = { id: "abc" };
    await writeTrace({
      run_id: "r1",
      step_index: 0,
      phase: "act",
      tool_name: "search",
      tool_input: { q: "hello" },
      tool_output: { hits: 3 },
      model_confidence: "high",
      verification: { checked: true },
    });

    expect(captured.table).toBe("traces");
    expect(captured.payload).toMatchObject({
      run_id: "r1",
      step_index: 0,
      phase: "act",
      tool_name: "search",
      tool_input: { q: "hello" },
      tool_output: { hits: 3 },
      model_confidence: "high",
      verification: { checked: true },
    });
  });

  it("defaults optional evidence/verdict fields to null", async () => {
    insertResult.data = { id: "abc" };
    await writeTrace({ run_id: "r1", step_index: 1, phase: "plan" });

    expect(captured.payload).toMatchObject({
      run_id: "r1",
      step_index: 1,
      phase: "plan",
      tool_name: null,
      tool_input: null,
      tool_output: null,
      model_confidence: null,
      verification: null,
    });
  });

  it("throws when the insert returns an error", async () => {
    insertResult.error = { message: "boom" };
    await expect(
      writeTrace({ run_id: "r1", step_index: 2, phase: "verify" }),
    ).rejects.toThrow(/writeTrace failed: boom/);
  });
});
