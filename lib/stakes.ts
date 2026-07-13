/**
 * Stakes declaration (claim graph, increment C — see design/claim-graph-increment.md).
 *
 * Every run opens with a `plan` hop that records what the loop is allowed to affect.
 * Stakes are partly DERIVED rather than trusted: the tool manifest is checkable
 * evidence, so a loop whose tools can recommend or act gets a floor it cannot declare
 * its way below. The declared tier can raise stakes above the floor, never lower them.
 */

export const STAKES_TIERS = ["observes", "recommends", "acts"] as const;
export type Stakes = (typeof STAKES_TIERS)[number];

const RANK: Record<Stakes, number> = { observes: 0, recommends: 1, acts: 2 };

export function maxStakes(a: Stakes, b: Stakes): Stakes {
  return RANK[a] >= RANK[b] ? a : b;
}

export function stakesAtLeast(a: Stakes, b: Stakes): boolean {
  return RANK[a] >= RANK[b];
}

/** What each known tool can do to the world. Read-only tools observe; tools that shape
 *  an outbound recommendation floor at `recommends`; tools that perform irreversible
 *  actions would floor at `acts` (none exist yet — the drafter drafts, a human sends). */
export const TOOL_EFFECTS: Record<string, Stakes> = {
  lookup_transactions: "observes",
  analyze_recurring: "observes",
  verify_findings: "observes",
  read_claims: "observes",
  decide_cancellations: "recommends",
  verify_cancellation_plan: "observes",
};

/** The floor a tool manifest imposes. Unknown tools are treated as `acts`: a tool this
 *  file has never heard of must not silently pass as harmless. */
export function deriveStakesFloor(toolNames: string[]): Stakes {
  let floor: Stakes = "observes";
  for (const name of toolNames) {
    floor = maxStakes(floor, TOOL_EFFECTS[name] ?? "acts");
  }
  return floor;
}

/** Resolve a run's effective stakes: the declared tier, raised to the manifest floor. */
export function resolveStakes(declared: Stakes, toolNames: string[]): Stakes {
  return maxStakes(declared, deriveStakesFloor(toolNames));
}
