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
  it("applies defaults and writes to the traces table", async () => {
    insertResult.data = { id: "abc" };
    await writeTrace({ run_id: "r1", hop_index: 0, agent: "planner" });

    expect(captured.table).toBe("traces");
    expect(captured.payload).toMatchObject({
      run_id: "r1",
      hop_index: 0,
      agent: "planner",
      event: "step",
      status: "ok",
      metadata: {},
    });
  });

  it("throws when the insert returns an error", async () => {
    insertResult.error = { message: "boom" };
    await expect(
      writeTrace({ run_id: "r1", hop_index: 1, agent: "planner" }),
    ).rejects.toThrow(/writeTrace failed: boom/);
  });
});
