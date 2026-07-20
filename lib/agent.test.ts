import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type Hop } from "./agent";
import { tools } from "./tools";

/**
 * End-to-end test of the money-check-in loop with the Anthropic client mocked but the real
 * tool runners in play. It exercises the exact behaviour the trace-regeneration task must
 * hold, without needing a live API key or Supabase:
 *
 *   - the model's interleaved reasoning text is traced as `plan` rows,
 *   - every act row carries a confidence string (verbatim, or "no confidence stated"),
 *   - gather/verify rows keep null model_confidence; the verify verdict lands in
 *     `verification`,
 *   - the AWS trap is flagged in act and reversed in verify (failed >= 1),
 *   - no web_search tool is ever reachable.
 *
 * The mock scripts a realistic four-turn run (gather → act → verify → final) and builds the
 * verify claims from the act tool_result already in the message history, so the loop under
 * test drives the real analysis over the committed dataset.
 */

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

// Whether the act turn includes the required `confidence` field. Flipped per run to cover
// both the verbatim path and the "no confidence stated" fallback.
let includeConfidence = true;

type ToolResultBlock = { type: string; content?: unknown };

/** Recover the price-change claims from the act tool_result already in the history. */
function claimsFromHistory(messages: Anthropic.MessageParam[]): unknown[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const block of m.content as ToolResultBlock[]) {
      if (block.type !== "tool_result" || typeof block.content !== "string") continue;
      try {
        const parsed = JSON.parse(block.content) as { price_changes?: unknown[] };
        if (Array.isArray(parsed.price_changes)) {
          return parsed.price_changes.map((c) => {
            const claim = c as Record<string, unknown>;
            return {
              claim_id: claim.claim_id,
              merchant: claim.merchant,
              old_price: claim.old_price,
              new_price: claim.new_price,
            };
          });
        }
      } catch {
        /* not the act result */
      }
    }
  }
  return [];
}

/** Script one model turn from where the conversation is. */
function scriptTurn(messages: Anthropic.MessageParam[]): Anthropic.Message {
  const assistantTurns = messages.filter((m) => m.role === "assistant").length;

  if (assistantTurns === 0) {
    return {
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "First I'll gather this quarter's subscription charges." },
        {
          type: "tool_use",
          id: "tu-gather",
          name: "lookup_transactions",
          input: { category: "subscription", start_date: "2026-04-01", end_date: "2026-06-30" },
        },
      ],
    } as unknown as Anthropic.Message;
  }

  if (assistantTurns === 1) {
    const input: Record<string, unknown> = { transactions: [] };
    if (includeConfidence) {
      input.confidence =
        "High confidence on Netflix, NYT and YouTube — clean sustained steps. Low confidence on AWS: usage-metered, varies every month, likely not a real subscription price change.";
    }
    return {
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "Netflix, NYT and YouTube look like clean steps. AWS varies every month, so I'll flag it but expect verify to reject it.",
        },
        { type: "tool_use", id: "tu-act", name: "analyze_recurring", input },
      ],
    } as unknown as Anthropic.Message;
  }

  if (assistantTurns === 2) {
    return {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tu-verify",
          name: "verify_findings",
          input: { claims: claimsFromHistory(messages) },
        },
      ],
    } as unknown as Anthropic.Message;
  }

  return {
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: "Confirmed Netflix, NYT and YouTube for +$15.50/mo. AWS was reversed as usage-based.",
      },
    ],
  } as unknown as Anthropic.Message;
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  includeConfidence = true;
  createMock.mockReset();
  createMock.mockImplementation(
    async ({ messages }: { messages: Anthropic.MessageParam[] }) => scriptTurn(messages),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tool manifest", () => {
  it("exposes exactly the three phase tools and no web_search", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "analyze_recurring",
      "lookup_transactions",
      "verify_findings",
    ]);
    expect(tools.some((t) => t.name === "web_search")).toBe(false);
  });

  it("requires confidence on analyze_recurring", () => {
    const act = tools.find((t) => t.name === "analyze_recurring")!;
    const schema = act.input_schema as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain("confidence");
    expect(schema.properties?.confidence).toMatchObject({ type: "string" });
  });
});

describe("runAgent loop", () => {
  it("traces interleaved reasoning as plan rows and never renders untraced", async () => {
    const { hops } = await runAgent();

    // The opening stakes plan hop, plus one plan hop per interleaved text block.
    const planRows = hops.filter((h) => h.phase === "plan");
    const reasoningRows = planRows.filter(
      (h) => h.tool_name === null && typeof h.tool_output === "string" && h.tool_output.trim(),
    );
    expect(reasoningRows.length).toBeGreaterThanOrEqual(2);
    // step_index is contiguous and ordered.
    expect(hops.map((h) => h.step_index)).toEqual(hops.map((_, i) => i));
  });

  it("writes a confidence string on every act row, verbatim when supplied", async () => {
    const { hops } = await runAgent();
    const actRows = hops.filter((h) => h.phase === "act");
    expect(actRows.length).toBeGreaterThan(0);
    for (const h of actRows) {
      expect(typeof h.model_confidence).toBe("string");
      expect((h.model_confidence ?? "").trim().length).toBeGreaterThan(0);
    }
    expect(actRows[0].model_confidence).toContain("AWS");
  });

  it("falls back to 'no confidence stated' when the model omits it", async () => {
    includeConfidence = false;
    const { hops } = await runAgent();
    const actRows = hops.filter((h) => h.phase === "act");
    expect(actRows.length).toBeGreaterThan(0);
    for (const h of actRows) expect(h.model_confidence).toBe("no confidence stated");
  });

  it("keeps gather/verify model_confidence null and carries the verdict in verification", async () => {
    const { hops } = await runAgent();
    for (const h of hops.filter((h) => h.phase === "gather" || h.phase === "verify")) {
      expect(h.model_confidence).toBeNull();
    }
    const verify = hops.find((h) => h.phase === "verify")!;
    expect(verify.verification).not.toBeNull();
  });

  it("catches the AWS false positive in verify (failed >= 1)", async () => {
    const { hops } = await runAgent();
    const verify = hops.find((h) => h.phase === "verify")!;
    const v = verify.verification as { passed: number; failed: number };
    expect(v.failed).toBeGreaterThanOrEqual(1);
    expect(v.passed).toBe(3); // Netflix, NYT, YouTube
  });

  it("never invokes a web_search tool across the run", async () => {
    const { hops } = await runAgent();
    expect(hops.some((h: Hop) => h.tool_name === "web_search")).toBe(false);
  });
});
