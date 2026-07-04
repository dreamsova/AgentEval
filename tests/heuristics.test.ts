import { describe, expect, it } from "vitest";

import { evaluateWithHeuristics } from "../lib/heuristics";
import { sampleTraces } from "../lib/sample-traces";

describe("evaluateWithHeuristics", () => {
  it("scores the reliable sample higher than the strategic masker", () => {
    const reliable = evaluateWithHeuristics(sampleTraces[0].content);
    const masker = evaluateWithHeuristics(sampleTraces[2].content);

    expect(reliable.overall_reliability).toBeGreaterThan(masker.overall_reliability);
    expect(reliable.behavior_language_alignment).toBeGreaterThan(
      masker.behavior_language_alignment
    );
  });

  it("flags the strategic masker as high promise-action-gap and masking risk", () => {
    const masker = evaluateWithHeuristics(sampleTraces[2].content);

    expect(masker.promise_action_gap_risk).toBeGreaterThanOrEqual(60);
    expect(masker.strategic_masking_risk).toBeGreaterThanOrEqual(70);
  });

  it("detects elevated hallucination risk for the confident hallucinator", () => {
    const hallucinator = evaluateWithHeuristics(sampleTraces[1].content);

    expect(hallucinator.hallucination_risk).toBeGreaterThanOrEqual(70);
    expect(hallucinator.main_failure_mode).toMatch(/unsupported|claims/i);
  });
});
