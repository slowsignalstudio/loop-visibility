import { describe, expect, it } from "vitest";
import { decideCancellations, verifyCancellationPlan, type ClaimLite } from "./drafter";

const claim = (id: string, merchant: string, delta: number): ClaimLite => ({
  claim_id: id,
  merchant,
  delta,
});

const CLAIMS = [
  claim("c-netflix", "Netflix", 2.5),
  claim("c-nyt", "The New York Times", 8.0),
  claim("c-youtube", "YouTube Premium", 5.0),
]; // total +$15.50/mo

describe("decideCancellations", () => {
  it("cancels nothing when the total fits under the limit", () => {
    const plan = decideCancellations(CLAIMS, 20);
    expect(plan.cancel).toEqual([]);
    expect(plan.keep).toHaveLength(3);
    expect(plan.remaining_increase).toBe(15.5);
  });

  it("cancels largest increases first until the rest fits", () => {
    const plan = decideCancellations(CLAIMS, 10);
    expect(plan.cancel).toEqual(["c-nyt"]); // dropping $8 leaves $7.50
    expect(plan.remaining_increase).toBe(7.5);
    expect(plan.monthly_saving).toBe(8.0);
  });

  it("keeps cancelling while still over the limit", () => {
    const plan = decideCancellations(CLAIMS, 2);
    expect(plan.cancel).toEqual(["c-nyt", "c-youtube", "c-netflix"]);
    expect(plan.remaining_increase).toBe(0);
  });
});

describe("verifyCancellationPlan", () => {
  it("passes a minimal plan that fits under the limit", () => {
    const v = verifyCancellationPlan(CLAIMS, ["c-nyt"], 10);
    expect(v.failed).toBe(0);
    const total = v.results[v.results.length - 1];
    expect(total.merchant).toBe("Plan total");
    expect(total.claim).toEqual({ old_price: 15.5, new_price: 7.5 });
    expect(total.pass).toBe(true);
  });

  it("fails a cancellation that targets a claim that was never consumed", () => {
    const v = verifyCancellationPlan(CLAIMS, ["c-hulu-never-read"], 10);
    const ghost = v.results[0];
    expect(ghost.pass).toBe(false);
    expect(ghost.reason).toContain("never read");
  });

  it("fails a redundant cancellation", () => {
    // Cancelling NYT alone reaches the limit; also cancelling Netflix is unjustified.
    const v = verifyCancellationPlan(CLAIMS, ["c-nyt", "c-netflix"], 10);
    const netflix = v.results.find((r) => r.merchant === "Netflix")!;
    expect(netflix.pass).toBe(false);
    expect(netflix.reason).toContain("Redundant");
  });

  it("fails the plan total when the remaining increase still exceeds the limit", () => {
    const v = verifyCancellationPlan(CLAIMS, ["c-netflix"], 10);
    const total = v.results[v.results.length - 1];
    expect(total.pass).toBe(false);
    expect(total.reason).toContain("exceeds");
  });
});
