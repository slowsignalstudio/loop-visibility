import { describe, it, expect } from "vitest";
import { deterministicScore, scoreFindings } from "./evalScoring";

describe("eval scoring", () => {
  it("deterministic pipeline passes every check against ground truth", () => {
    const card = deterministicScore();
    const failing = card.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`);
    // Show which checks failed if this ever regresses.
    expect(failing).toEqual([]);
    expect(card.allPass).toBe(true);
    expect(card.total).toBe(5);
  });

  it("fails the run when there are no findings at all", () => {
    const card = scoreFindings(null, null);
    expect(card.allPass).toBe(false);
  });
});
