import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Routine: build-log-to-demo-script. Reads BUILDLOG.md and drafts a 60-90 second spoken
 * demo script, then writes it to reports/. Uses Opus, because this is final-draft prose a
 * person will read aloud and the quality visibly matters (per the model policy).
 *
 * Usage:  npm run demo:draft
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim();
  }
} catch {
  /* rely on ambient env */
}

const PROMPT = `You are drafting a spoken script for a 60 to 90 second screen-recorded demo of "Loop Visibility", an agent-legibility viewer. The demo shows a money-check-in agent working over synthetic transactions, hop by hop.

Write it to be read aloud: plain, direct, no marketing language, no em dashes, no bullet points. Around 150 to 190 words. Structure it as four beats:
1. The problem, in one line.
2. The thing working on screen: the agent gathers rows, acts to flag price increases, then verifies each claim.
3. The turning point: the AWS charge is flagged as an increase, then the verify step reverses it because the charge varies every month, usage-based rather than a real price change, with the evidence shown beside the verdict.
4. Close on one design decision worth being proud of: evidence travels next to the verdict at every hop, so a claim can be checked against its own data at the moment of decision.

Base everything ONLY on the build log below. Return just the script, no preamble.

BUILD LOG:
`;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  const buildlog = readFileSync(resolve(root, "BUILDLOG.md"), "utf8");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1200,
    messages: [{ role: "user", content: PROMPT + buildlog }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(resolve(root, "reports"), { recursive: true });
  const out = resolve(root, `reports/demo-script-${date}.md`);
  writeFileSync(out, `# Demo script draft — ${date}\n\n${text}\n`);
  console.log(`Wrote ${out}\n`);
  console.log(text);
}

main().catch((e) => {
  console.error("demo:draft failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
