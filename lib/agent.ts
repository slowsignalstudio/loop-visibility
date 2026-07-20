import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { tools } from "@/lib/tools";
import { runTool } from "@/lib/toolRunners";
import { resolveStakes, deriveStakesFloor, type Stakes } from "@/lib/stakes";

/**
 * The money-check-in agent loop, extracted so it can run in two places: the API route
 * (which writes each hop to Supabase) and the eval harness (which collects hops in
 * memory and scores them). Behaviour is identical; only what happens per hop differs,
 * via the `onHop` callback.
 */

export const MODEL = "claude-sonnet-5";
export const MAX_STEPS = 10; // guard: at most 10 model turns per run

export const SYSTEM = `You are a money check-in agent working over a committed synthetic transaction dataset.
Work strictly in three phases using your tools:
1. gather — call lookup_transactions to pull the relevant rows (subscriptions are category "subscription").
2. act — call analyze_recurring with those rows to find recurring merchants and quarter-over-quarter price changes. State your confidence or hedge in the "confidence" field, in your own words.
3. verify — call verify_findings with EVERY apparent price change from the analysis, including any you suspect may be spurious. Never report a change you have not verified.
After verification, give a short final recommendation citing only the changes that passed, with the total monthly impact. Be concise.`;

export const TASK =
  "Find subscriptions whose price changed this quarter (April–June 2026), compute the total monthly impact, and draft a recommendation.";

/** One hop the agent took. Mirrors the trace schema, minus the DB-assigned fields.
 *  `tool_name` is null for the run-opening plan hop, which declares stakes rather than
 *  invoking a tool. */
export type Hop = {
  step_index: number;
  phase: string;
  tool_name: string | null;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
  model_confidence: string | null;
  verification: unknown;
};

/** The run-opening plan hop (increment C): declares what this loop is allowed to affect,
 *  with the tool manifest as checkable evidence. Shared by both agent loops. */
export function planHop(declared: Stakes, toolNames: string[]): Hop {
  return {
    step_index: 0,
    phase: "plan",
    tool_name: null,
    tool_input: {
      stakes: resolveStakes(declared, toolNames),
      declared_stakes: declared,
      derived_floor: deriveStakesFloor(toolNames),
      tool_manifest: toolNames,
    },
    tool_output: null,
    model_confidence: null,
    verification: null,
  };
}

export type AgentResult = {
  runId: string;
  hops: Hop[];
  final: string;
  stop_reason: string;
  steps: number;
};

export type RunAgentOptions = {
  runId?: string;
  /** Called for every hop, in order, before its result is fed back to the model. */
  onHop?: (hop: Hop) => Promise<void> | void;
};

export async function runAgent({ runId, onHop }: RunAgentOptions = {}): Promise<AgentResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  const id = runId ?? randomUUID();
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: TASK }];
  const hops: Hop[] = [];
  let stop_reason = "";
  let final = "";

  // The run opens by declaring its stakes — traced before the first model call, so even
  // a run that dies immediately left a record of what it was allowed to affect.
  const plan = planHop(
    "observes", // the money check-in reads and computes; it changes nothing
    tools.map((t) => t.name),
  );
  hops.push(plan);
  await onHop?.(plan);
  let step_index = 1;

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      thinking: { type: "disabled" },
      tools,
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

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    // Walk the assistant's blocks in the order it emitted them. Text the model reasons
    // out loud between tool calls is a real hop the viewer must be able to show, so it is
    // traced as a `plan` row (tool_name null, the reasoning stored in tool_output) before
    // the tool call it precedes — same integrity rule as every other hop.
    for (const block of res.content) {
      if (block.type === "text") {
        const reasoning = block.text.trim();
        if (!reasoning) continue;
        const hop: Hop = {
          step_index: step_index++,
          phase: "plan",
          tool_name: null,
          tool_input: {},
          tool_output: reasoning,
          model_confidence: null,
          verification: null,
        };
        hops.push(hop);
        await onHop?.(hop);
        continue;
      }

      if (block.type !== "tool_use") continue;

      const input = (block.input ?? {}) as Record<string, unknown>;
      const { phase, output, verification } = runTool(block.name, input);

      // The model's own hedge, stored verbatim (act phase only). Required field; if the
      // model omits it, record the absence visibly rather than null.
      const model_confidence =
        block.name === "analyze_recurring"
          ? typeof input.confidence === "string" && input.confidence.trim()
            ? input.confidence
            : "no confidence stated"
          : null;

      const hop: Hop = {
        step_index: step_index++,
        phase,
        tool_name: block.name,
        tool_input: input,
        tool_output: output,
        model_confidence,
        verification: verification ?? null,
      };
      hops.push(hop);
      await onHop?.(hop);

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { runId: id, hops, final, stop_reason, steps: step_index };
}
