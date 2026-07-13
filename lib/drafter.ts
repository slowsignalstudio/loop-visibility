import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { readClaims } from "@/lib/claims";
import { planHop, MAX_STEPS, type Hop, type AgentResult, type RunAgentOptions } from "@/lib/agent";

/**
 * The cancellation-drafter loop (claim graph, increment D): the first CONSUMER.
 * It ingests another run's verified claims through readClaims() — the only legal
 * boundary crossing — decides which subscriptions to cancel to keep the added monthly
 * cost under a limit, verifies the plan against invariants, and drafts the email.
 * Declared stakes: recommends (it drafts; a human sends).
 *
 * Deliberately boring, like the first three tools. Its whole purpose is to be
 * downstream, so the fleet has a real edge to reason about.
 */

export const DRAFTER_MODEL = "claude-sonnet-5"; // loop default, per model policy
export const DEFAULT_MONTHLY_LIMIT = 10;

export const DRAFTER_SYSTEM = `You are a cancellation-drafter agent. You work ONLY from claims another agent verified — never from raw data you have not been given.
Work strictly in three phases using your tools:
1. gather — call read_claims with the producer run id to consume its verified price-increase claims.
2. act — call decide_cancellations with those claims and the monthly limit. State your confidence or hedge in the "confidence" field, in your own words.
3. verify — call verify_cancellation_plan with the claims and your chosen cancellations to check the plan's invariants.
After verification, draft a short, polite cancellation email covering ONLY the merchants in the verified plan, and state the monthly saving. Be concise.`;

export function drafterTask(producerRunId: string, monthlyLimit: number): string {
  return `Consume the verified claims from run ${producerRunId}, decide which subscriptions to cancel so the total added monthly cost stays under $${monthlyLimit}, verify the plan, then draft the cancellation email.`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const drafterTools: Anthropic.Tool[] = [
  {
    // gather — the boundary crossing
    name: "read_claims",
    description:
      "Consume the verified price-increase claims of a producer run through the claim graph. Each claim carries its claim_id and the producer's confidence verbatim.",
    input_schema: {
      type: "object",
      properties: {
        producer_run_id: { type: "string", description: "The run whose verified claims to consume." },
      },
      required: ["producer_run_id"],
      additionalProperties: false,
    },
  },
  {
    // act
    name: "decide_cancellations",
    description:
      "Decide which subscriptions to cancel so the total added monthly cost stays under the limit. State your certainty and the reason in one sentence in the confidence field. This field is required.",
    input_schema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          description: "The consumed claims (output of read_claims).",
          items: {
            type: "object",
            properties: {
              claim_id: { type: "string" },
              merchant: { type: "string" },
              old_price: { type: "number" },
              new_price: { type: "number" },
              delta: { type: "number" },
            },
            required: ["claim_id", "merchant", "delta"],
          },
        },
        monthly_limit: { type: "number", description: "Max acceptable total increase, $/mo." },
        confidence: {
          type: "string",
          description: "Your certainty and reasoning, one sentence. Required. Stored verbatim in model_confidence.",
        },
      },
      required: ["claims", "monthly_limit", "confidence"],
      additionalProperties: false,
    },
  },
  {
    // verify
    name: "verify_cancellation_plan",
    description:
      "Check the plan's invariants: every cancellation targets a consumed claim, the remaining increase fits under the limit, and no cancellation is redundant.",
    input_schema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          description: "The consumed claims the plan was built from.",
          items: {
            type: "object",
            properties: {
              claim_id: { type: "string" },
              merchant: { type: "string" },
              old_price: { type: "number" },
              new_price: { type: "number" },
              delta: { type: "number" },
            },
            required: ["claim_id", "merchant", "delta"],
          },
        },
        cancel: {
          type: "array",
          description: "claim_ids the plan cancels.",
          items: { type: "string" },
        },
        monthly_limit: { type: "number" },
      },
      required: ["claims", "cancel", "monthly_limit"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Pure logic (unit-tested without a model or database)
// ---------------------------------------------------------------------------

export type ClaimLite = {
  claim_id: string;
  merchant: string;
  old_price?: number;
  new_price?: number;
  delta: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Greedy plan: cancel largest increases first until the rest fits under the limit. */
export function decideCancellations(claims: ClaimLite[], monthlyLimit: number) {
  const sorted = claims.slice().sort((a, b) => b.delta - a.delta);
  const total = round2(sorted.reduce((s, c) => s + c.delta, 0));
  const cancel: ClaimLite[] = [];
  let remaining = total;
  for (const c of sorted) {
    if (remaining <= monthlyLimit) break;
    cancel.push(c);
    remaining = round2(remaining - c.delta);
  }
  const cancelIds = new Set(cancel.map((c) => c.claim_id));
  return {
    cancel: cancel.map((c) => c.claim_id),
    keep: sorted.filter((c) => !cancelIds.has(c.claim_id)).map((c) => c.claim_id),
    total_increase: total,
    remaining_increase: remaining,
    monthly_saving: round2(total - remaining),
    limit: monthlyLimit,
  };
}

/** Invariant checks, independent of how the plan was produced. The last result row is
 *  the plan total: added $/mo before the cancellations against after. */
export function verifyCancellationPlan(claims: ClaimLite[], cancel: string[], monthlyLimit: number) {
  const byId = new Map(claims.map((c) => [c.claim_id, c]));
  const cancelSet = new Set(cancel);
  const total = round2(claims.reduce((s, c) => s + c.delta, 0));
  const remaining = round2(
    claims.filter((c) => !cancelSet.has(c.claim_id)).reduce((s, c) => s + c.delta, 0),
  );

  const results = cancel.map((id) => {
    const c = byId.get(id);
    // Redundancy: a cancellation is justified only if adding its delta back would
    // push the remaining total over the limit.
    const redundant = !!c && round2(remaining + c.delta) <= monthlyLimit;
    return {
      claim_id: c?.claim_id ?? null,
      merchant: c?.merchant ?? `unknown claim ${id.slice(0, 8)}`,
      claim: { old_price: c?.delta ?? 0, new_price: 0 },
      pass: !!c && !redundant,
      reason: !c
        ? "No consumed claim with this id — cannot cancel what was never read."
        : redundant
          ? `Redundant: the plan fits under $${monthlyLimit}/mo even without cancelling ${c.merchant}.`
          : `Cancelling ${c.merchant} removes $${c.delta.toFixed(2)}/mo of the increase.`,
      supporting_rows: [],
    };
  });

  results.push({
    claim_id: null,
    merchant: "Plan total",
    claim: { old_price: total, new_price: remaining },
    pass: remaining <= monthlyLimit,
    reason:
      remaining <= monthlyLimit
        ? `Remaining increase $${remaining.toFixed(2)}/mo fits under the $${monthlyLimit}/mo limit.`
        : `Remaining increase $${remaining.toFixed(2)}/mo still exceeds the $${monthlyLimit}/mo limit.`,
    supporting_rows: [],
  });

  const passed = results.filter((r) => r.pass).length;
  return { passed, failed: results.length - passed, results };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

type DrafterToolResult = { phase: string; output: unknown; verification?: unknown };

async function runDrafterTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { consumerRunId: string; stepIndex: number },
): Promise<DrafterToolResult> {
  if (name === "read_claims") {
    const producerRunId = typeof input.producer_run_id === "string" ? input.producer_run_id : "";
    // The edge rows are written inside readClaims BEFORE the claims come back — the
    // consumption is on the record before the model ever sees the data. Claims the
    // guardrail withheld arrive as `withheld`, visible in the trace and to the model,
    // so the drafter plans only over what legally crossed the boundary.
    const { claims, withheld } = await readClaims({
      producerRunId,
      consumerRunId: ctx.consumerRunId,
      consumerStepIndex: ctx.stepIndex,
      consumerStakes: "recommends",
    });
    return { phase: "gather", output: { count: claims.length, claims, withheld } };
  }
  if (name === "decide_cancellations") {
    const claims = (Array.isArray(input.claims) ? input.claims : []) as ClaimLite[];
    const limit = typeof input.monthly_limit === "number" ? input.monthly_limit : DEFAULT_MONTHLY_LIMIT;
    return { phase: "act", output: decideCancellations(claims, limit) };
  }
  if (name === "verify_cancellation_plan") {
    const claims = (Array.isArray(input.claims) ? input.claims : []) as ClaimLite[];
    const cancel = (Array.isArray(input.cancel) ? input.cancel : []) as string[];
    const limit = typeof input.monthly_limit === "number" ? input.monthly_limit : DEFAULT_MONTHLY_LIMIT;
    const summary = verifyCancellationPlan(claims, cancel, limit);
    return { phase: "verify", output: summary, verification: summary };
  }
  throw new Error(`Unknown drafter tool: ${name}`);
}

export type RunDrafterOptions = RunAgentOptions & {
  producerRunId: string;
  monthlyLimit?: number;
};

export async function runDrafter({
  runId,
  onHop,
  producerRunId,
  monthlyLimit = DEFAULT_MONTHLY_LIMIT,
}: RunDrafterOptions): Promise<AgentResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  const id = runId ?? randomUUID();
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: drafterTask(producerRunId, monthlyLimit) },
  ];
  const hops: Hop[] = [];
  let stop_reason = "";
  let final = "";

  // Stakes first, traced before the first model call (increment C). The manifest
  // includes decide_cancellations, so the derived floor is `recommends` regardless
  // of what this loop declared.
  const plan = planHop("recommends", drafterTools.map((t) => t.name));
  hops.push(plan);
  await onHop?.(plan);
  let step_index = 1;

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    const res = await client.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: 2048,
      system: DRAFTER_SYSTEM,
      thinking: { type: "disabled" },
      tools: drafterTools,
      messages,
    });
    stop_reason = res.stop_reason ?? "";
    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason !== "tool_use") {
      final = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      break;
    }

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const { phase, output, verification } = await runDrafterTool(tu.name, input, {
        consumerRunId: id,
        stepIndex: step_index,
      });

      const model_confidence =
        tu.name === "decide_cancellations"
          ? typeof input.confidence === "string" && input.confidence.trim()
            ? input.confidence
            : "no confidence stated"
          : null;

      const hop: Hop = {
        step_index: step_index++,
        phase,
        tool_name: tu.name,
        tool_input: input,
        tool_output: output,
        model_confidence,
        verification: verification ?? null,
      };
      hops.push(hop);
      await onHop?.(hop);

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { runId: id, hops, final, stop_reason, steps: step_index };
}
