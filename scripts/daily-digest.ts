import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Routine: daily digest brief. Reads the newest BUILDLOG entry and the most recent eval
 * report, then writes a short morning brief to reports/ — what shipped, whether the eval
 * is healthy, and a suggested focus for today. Uses Haiku: high-volume, low-stakes, the
 * kind of cheap summarizing the model policy reserves for it.
 *
 * Usage:  npm run digest
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

/** The newest BUILDLOG entry (entries start with "## " and newest is at the top). */
function latestBuildlogEntry(): string {
  const log = readFileSync(resolve(root, "BUILDLOG.md"), "utf8");
  const marker = "<!-- new entries go directly below this line, above the previous day -->";
  const body = log.includes(marker) ? log.split(marker)[1] : log;
  const parts = body.split(/\n## /).filter((s) => s.trim());
  return parts.length ? "## " + parts[0].trim() : "(no build-log entries yet)";
}

/** The most recent reports/eval-*.md, if any. */
function latestEvalReport(): string {
  try {
    const files = readdirSync(resolve(root, "reports"))
      .filter((f) => /^eval-\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort();
    if (!files.length) return "(no eval report yet)";
    return readFileSync(resolve(root, "reports", files[files.length - 1]), "utf8");
  } catch {
    return "(no reports directory yet)";
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Missing ANTHROPIC_API_KEY");
  const client = new Anthropic();
  const prompt = `Write a short morning brief for a solo developer on a build sprint. Five sentences at most, plain prose, no bullet points and no em dashes. Cover: what was shipped most recently, whether the eval is healthy, and one concrete suggested focus for today. Base it only on the two inputs below.

LATEST BUILD LOG ENTRY:
${latestBuildlogEntry()}

LATEST EVAL REPORT:
${latestEvalReport()}`;

  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(resolve(root, "reports"), { recursive: true });
  const out = resolve(root, `reports/digest-${date}.md`);
  writeFileSync(out, `# Daily digest — ${date}\n\n${text}\n`);
  console.log(`Wrote ${out}\n`);
  console.log(text);
}

main().catch((e) => {
  console.error("digest failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
