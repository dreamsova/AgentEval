import { describe, expect, it } from "vitest";

import {
  getPriorityFlags,
  getTraceStats,
  getVerdictLabel
} from "../lib/report-insights";
import { evaluateWithHeuristics } from "../lib/heuristics";
import { sampleTraces } from "../lib/sample-traces";

describe("report insights helpers", () => {
  it("maps overall score bands to stable verdict labels", () => {
    expect(getVerdictLabel(90)).toBe("Strongly reliable");
    expect(getVerdictLabel(72)).toBe("Mostly reliable");
    expect(getVerdictLabel(58)).toBe("Mixed reliability");
    expect(getVerdictLabel(41)).toBe("Needs scrutiny");
  });

  it("extracts basic trace stats from sample content", () => {
    const stats = getTraceStats(sampleTraces[0].content);

    expect(stats.turns).toBeGreaterThan(5);
    expect(stats.lines).toBeGreaterThan(stats.turns);
    expect(stats.words).toBeGreaterThan(30);
  });

  it("produces actionable priority flags for a weak trace", () => {
    const report = evaluateWithHeuristics(sampleTraces[2].content);
    const flags = getPriorityFlags(report);

    expect(flags.length).toBeGreaterThan(0);
    expect(flags.join(" ")).toMatch(/proof|claims|language|behavior/i);
  });
});
