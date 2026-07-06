import type Anthropic from "@anthropic-ai/sdk";

/**
 * The three tools the money-check-in agent uses, one per phase of the gather → act →
 * verify arc. Definitions only (name + one-line description + input schema); the
 * implementations each write a trace row and live alongside the agent loop.
 */
export const tools: Anthropic.Tool[] = [
  {
    // gather
    name: "lookup_transactions",
    description:
      "Read and filter rows from the synthetic transaction dataset and return them.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Exact merchant name to match." },
        category: { type: "string", description: "Category to match, e.g. \"subscription\"." },
        start_date: { type: "string", description: "Inclusive lower bound, YYYY-MM-DD." },
        end_date: { type: "string", description: "Inclusive upper bound, YYYY-MM-DD." },
        min_amount: { type: "number", description: "Only rows with amount >= this value." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    // act
    name: "analyze_recurring",
    description:
      "Identify recurring merchants, compute quarter-over-quarter price deltas, and draft a recommendation.",
    input_schema: {
      type: "object",
      properties: {
        transactions: {
          type: "array",
          description: "Rows to analyze (typically the output of lookup_transactions).",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              date: { type: "string" },
              merchant: { type: "string" },
              amount: { type: "number" },
              category: { type: "string" },
            },
            required: ["id", "date", "merchant", "amount"],
          },
        },
        confidence: {
          type: "string",
          description:
            "Your confidence or hedge about these findings, in your own words — stored verbatim.",
        },
      },
      required: ["transactions"],
      additionalProperties: false,
    },
  },
  {
    // verify
    name: "verify_findings",
    description:
      "Re-test each claimed price change against the raw rows and return pass/fail per claim with supporting rows.",
    input_schema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          description: "The price-change claims to re-test against the raw data.",
          items: {
            type: "object",
            properties: {
              merchant: { type: "string" },
              old_price: { type: "number" },
              new_price: { type: "number" },
            },
            required: ["merchant", "old_price", "new_price"],
          },
        },
      },
      required: ["claims"],
      additionalProperties: false,
    },
  },
];
