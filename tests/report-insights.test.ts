import { describe, expect, it } from "vitest";

import {
  getPriorityFlags,
  getTraceStats,
  getVerdictLabel
} from "../lib/report-insights";
import { evaluateWithHeuristics } from "../lib/heuristics";
import {
  buildSharePayload,
  decodeSharePayload,
  encodeSharePayload
} from "../lib/share-report";
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
    const report = evaluateWithHeuristics(
      sampleTraces[2].content,
      "founder-demo"
    );
    const flags = getPriorityFlags(report);

    expect(flags.length).toBeGreaterThan(0);
    expect(flags.join(" ")).toMatch(/proof|claims|language|behavior/i);
  });

  it("round-trips share payload encoding", () => {
    const report = evaluateWithHeuristics(
      sampleTraces[0].content,
      "founder-demo"
    );
    const payload = buildSharePayload(
      "Founder demo: Reliable operator",
      "founder-demo",
      sampleTraces[0].content,
      report
    );

    const decoded = decodeSharePayload(encodeSharePayload(payload));

    expect(decoded.title).toBe(payload.title);
    expect(decoded.primaryReport.overall_reliability).toBe(
      payload.primaryReport.overall_reliability
    );
  });
});
