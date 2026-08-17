import { describe, expect, it } from "vitest";

import devInputsJson from "../evals/v1/datasets/dev/inputs.json";
import regressionInputsJson from "../evals/v1/datasets/regression/inputs.json";
import {
  BenchmarkInputFileSchema,
  BenchmarkInputSchema,
  type BenchmarkInput
} from "../evals/v1/schema";
import {
  computeTraceSha256,
  detectCrossSplitLeakage
} from "../evals/v1/validation";

function fixture(
  caseId: string,
  split: BenchmarkInput["split"],
  groupId: string,
  trace: string
): BenchmarkInput {
  return BenchmarkInputSchema.parse({
    schema_version: "1.0.0",
    case_id: caseId,
    split,
    group_id: groupId,
    task_type: "fact_retrieval",
    domain: "analytics",
    style_tags: ["precise_language"],
    trace,
    trace_sha256: computeTraceSha256(trace),
    source_metadata: {
      origin: "synthetic",
      source_id: `fixture:${caseId}`,
      legacy: false,
      development_only: true,
      unseen: false
    }
  });
}

describe("Benchmark v1 leakage validation", () => {
  it("finds normalized duplicate traces across splits", () => {
    const dev = fixture("dev-case", "dev", "dev-group", "User: Check\r\nAgent: Done");
    const test = fixture("test-case", "test", "test-group", "User: Check\nAgent: Done");

    expect(detectCrossSplitLeakage([dev, test])).toEqual([
      expect.objectContaining({
        code: "duplicate_trace",
        case_ids: ["dev-case", "test-case"]
      })
    ]);
  });

  it("reports no leakage in the migrated dev and regression cases", () => {
    const inputs = [
      ...BenchmarkInputFileSchema.parse(devInputsJson).cases,
      ...BenchmarkInputFileSchema.parse(regressionInputsJson).cases
    ];

    expect(detectCrossSplitLeakage(inputs)).toEqual([]);
  });
});
