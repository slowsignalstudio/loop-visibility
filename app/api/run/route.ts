import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { tools } from "@/lib/tools";
import { runTool } from "@/lib/toolRunners";
import { writeTrace } from "@/lib/trace";

// The agent loop runs entirely server-side. Per the integrity rule, every hop's trace row
// is written BEFORE its result is fed back to the model and before anything renders — the
// UI reads only from trace rows, so what it shows is provably what happened.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";
const MAX_STEPS = 10; // guard: at most 10 model turns per run

const SYSTEM = `You are a money check-in agent working over a committed synthetic transaction dataset.
Work strictly in three phases using your tools:
1. gather — call lookup_transactions to pull the relevant rows (subscriptions are category "subscription").
2. act — call analyze_recurring with those rows to find recurring merchants and quarter-over-quarter price changes. State your confidence or hedge in the "confidence" field, in your own words.
3. verify — call verify_findings with EVERY apparent price change from the analysis, including any you suspect may be spurious. Never report a change you have not verified.
After verification, give a short final recommendation citing only the changes that passed, with the total monthly impact. Be concise.`;

const TASK =
  "Find subscriptions whose price changed this quarter (April–June 2026), compute the total monthly impact, and draft a recommendation.";

export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const client = new Anthropic();
  const run_id = randomUUID();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: TASK }];
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

    const assistantText = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    if (res.stop_reason !== "tool_use") {
      final = assistantText;
      break;
    }

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const { phase, output, verification } = runTool(tu.name, input);

      // model_confidence is the model's own hedge, stored verbatim (act phase only).
      const model_confidence =
        tu.name === "analyze_recurring"
          ? typeof input.confidence === "string" && input.confidence.trim()
            ? input.confidence
            : assistantText || null
          : null;

      // Trace row written BEFORE the result goes back to the model.
      await writeTrace({
        run_id,
        step_index: step_index++,
        phase,
        tool_name: tu.name,
        tool_input: input,
        tool_output: output,
        model_confidence,
        verification: verification ?? null,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return Response.json({
    run_id,
    steps: step_index,
    stop_reason,
    hit_max_steps: stop_reason === "tool_use",
    final,
  });
}
