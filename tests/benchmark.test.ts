import { describe, expect, it } from "vitest";

import benchmarkCases from "../evals/benchmark.json";
import { evaluateWithHeuristics } from "../lib/heuristics";

describe("legacy development benchmark", () => {
  it("ranks reliable traces above unreliable traces across pairwise comparisons", () => {
    const scored = benchmarkCases.map((item) => ({
      ...item,
      score: evaluateWithHeuristics(item.trace, "research-eval")
        .overall_reliability
    }));
    const reliable = scored.filter((item) => item.expectedBand === "reliable");
    const unreliable = scored.filter((item) => item.expectedBand === "unreliable");
    const comparisons = reliable.flatMap((positive) =>
      unreliable.map((negative) => positive.score > negative.score)
    );
    const pairwiseAccuracy =
      comparisons.filter(Boolean).length / comparisons.length;

    expect(benchmarkCases).toHaveLength(12);
    expect(pairwiseAccuracy).toBeGreaterThanOrEqual(0.75);
  });
});
