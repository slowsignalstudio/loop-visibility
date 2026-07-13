import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { tools } from "@/lib/tools";
import { runTool } from "@/lib/toolRunners";

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

/** One hop the agent took. Mirrors the trace schema, minus the DB-assigned fields. */
export type Hop = {
  step_index: number;
  phase: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_output: unknown;
  model_confidence: string | null;
  verification: unknown;
};

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
  let step_index = 0;
  let stop_reason = "";
  let final = "";

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

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const { phase, output, verification } = runTool(tu.name, input);

      // The model's own hedge, stored verbatim (act phase only). Required field; if the
      // model omits it, record the absence visibly rather than null.
      const model_confidence =
        tu.name === "analyze_recurring"
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
