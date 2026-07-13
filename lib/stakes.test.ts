import { describe, expect, it } from "vitest";
import { deriveStakesFloor, maxStakes, resolveStakes, stakesAtLeast } from "./stakes";

describe("stakes", () => {
  it("orders the tiers observes < recommends < acts", () => {
    expect(maxStakes("observes", "recommends")).toBe("recommends");
    expect(maxStakes("acts", "recommends")).toBe("acts");
    expect(stakesAtLeast("recommends", "observes")).toBe(true);
    expect(stakesAtLeast("observes", "acts")).toBe(false);
  });

  it("derives an observes floor from the money check-in's read-only manifest", () => {
    expect(deriveStakesFloor(["lookup_transactions", "analyze_recurring", "verify_findings"])).toBe(
      "observes",
    );
  });

  it("derives a recommends floor from the drafter's manifest", () => {
    expect(
      deriveStakesFloor(["read_claims", "decide_cancellations", "verify_cancellation_plan"]),
    ).toBe("recommends");
  });

  it("cannot declare below the derived floor, only above it", () => {
    expect(resolveStakes("observes", ["decide_cancellations"])).toBe("recommends");
    expect(resolveStakes("acts", ["lookup_transactions"])).toBe("acts");
  });

  it("treats a tool it has never heard of as acts — unknown must not pass as harmless", () => {
    expect(deriveStakesFloor(["lookup_transactions", "launch_the_missiles"])).toBe("acts");
  });
});
