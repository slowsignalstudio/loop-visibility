import Anthropic from "@anthropic-ai/sdk";

// Streams a short model response as plain text. Per the model policy in CLAUDE.md,
// the app's workhorse loop runs on Sonnet — this demo route uses it directly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response("Missing ANTHROPIC_API_KEY. See .env.example.", {
      status: 500,
    });
  }

  const prompt =
    new URL(request.url).searchParams.get("prompt") ??
    "In two sentences, explain what an agent execution trace is.";

  const client = new Anthropic();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model: "claude-sonnet-5",
          max_tokens: 1024,
          thinking: { type: "disabled" }, // snappy, text-only demo — no thinking pause
          messages: [{ role: "user", content: prompt }],
        });

        messageStream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        await messageStream.finalMessage();
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`\n[stream error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
