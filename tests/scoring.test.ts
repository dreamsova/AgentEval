import { describe, expect, it } from "vitest";

import { computeOverallReliability } from "../lib/agent/scoring";

describe("computeOverallReliability", () => {
  it("computes the same score for identical dimension inputs", () => {
    const dimensions = {
      instruction_following: 80,
      consistency: 70,
      promise_action_gap_risk: 40,
      hallucination_risk: 30,
      behavior_language_alignment: 75,
      strategic_masking_risk: 20
    };

    expect(computeOverallReliability(dimensions)).toBe(73);
    expect(computeOverallReliability(dimensions)).toBe(73);
  });

  it("penalizes risk increases without model-controlled overall scoring", () => {
    const reliable = computeOverallReliability({
      instruction_following: 90,
      consistency: 88,
      promise_action_gap_risk: 10,
      hallucination_risk: 12,
      behavior_language_alignment: 92,
      strategic_masking_risk: 8
    });
    const risky = computeOverallReliability({
      instruction_following: 90,
      consistency: 88,
      promise_action_gap_risk: 80,
      hallucination_risk: 75,
      behavior_language_alignment: 35,
      strategic_masking_risk: 85
    });

    expect(reliable).toBeGreaterThan(risky);
  });
});
