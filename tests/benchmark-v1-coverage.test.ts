import { describe, expect, it } from "vitest";

import readinessJson from "../evals/v1/reports/data-readiness.json";
import { buildDataReadinessReport } from "../evals/v1/coverage";
import devInputsJson from "../evals/v1/datasets/dev/inputs.json";
import devLabelsJson from "../evals/v1/datasets/dev/labels.json";
import regressionInputsJson from "../evals/v1/datasets/regression/inputs.json";
import regressionLabelsJson from "../evals/v1/datasets/regression/labels.json";
import testLabelsJson from "../evals/v1/datasets/test-labels/candidate-labels.json";
import testInputsJson from "../evals/v1/datasets/test/inputs.json";
import {
  BenchmarkInputFileSchema,
  BenchmarkInputSchema,
  BenchmarkLabelFileSchema,
  type BenchmarkInput
} from "../evals/v1/schema";
import {
  computeTraceSha256,
  detectDuplicateTraces,
  detectNearDuplicateTraces
} from "../evals/v1/validation";

const bundles = [
  {
    inputs: BenchmarkInputFileSchema.parse(devInputsJson),
    labels: BenchmarkLabelFileSchema.parse(devLabelsJson)
  },
  {
    inputs: BenchmarkInputFileSchema.parse(regressionInputsJson),
    labels: BenchmarkLabelFileSchema.parse(regressionLabelsJson)
  },
  {
    inputs: BenchmarkInputFileSchema.parse(testInputsJson),
    labels: BenchmarkLabelFileSchema.parse(testLabelsJson)
  }
];

function input(
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

describe("Benchmark v1 coverage report", () => {
  it("proves the candidate balance and all deterministic readiness checks", () => {
    const report = buildDataReadinessReport(bundles);
    const test = report.datasets.find((dataset) => dataset.split === "test");

    expect(report.status).toEqual({
      scaffold_ready: true,
      benchmark_scoring_ready: false,
      statement:
        "The deterministic data scaffold is ready for independent human annotation; it is not approved for benchmark scoring or performance claims."
    });
    expect(report.totals).toEqual({
      dev_regression_items: 24,
      test_candidate_items: 60,
      all_items: 84
    });
    expect(test).toMatchObject({
      reliable: 24,
      unreliable: 36,
      groups: 30,
      counterfactual_pairs: 30,
      style_pairs: 6,
      by_primary_failure: {
        artifact_provenance_mismatch: 6,
        false_completion: 6,
        masking_pattern: 6,
        partial_completion_overclaim: 6,
        tool_result_contradiction: 6,
        unsupported_claim: 6
      },
      by_domain: {
        analytics: 10,
        business_operations: 10,
        content_operations: 10,
        general: 10,
        publishing: 10,
        software_operations: 10
      }
    });
    expect(report.integrity.checks.every((check) => check.passed)).toBe(true);
    expect(report.integrity.exact_duplicate_issues).toEqual([]);
    expect(report.integrity.cross_split_leakage_issues).toEqual([]);
    expect(report.integrity.cross_split_near_duplicates).toEqual([]);
  });

  it("matches the committed generated report and stable corpus hash", () => {
    const report = buildDataReadinessReport(bundles);
    expect(report).toEqual(readinessJson);
    expect(report.integrity.corpus_sha256).toBe(
      "4e4b2fbcacc632ca622eeab94ca3df18bbd4732d2ea1e2d1fbd5bb2f89a43433"
    );
    expect(buildDataReadinessReport(bundles).integrity.corpus_sha256).toBe(
      report.integrity.corpus_sha256
    );
  });

  it("detects exact duplicates regardless of split", () => {
    const trace = "User: Check alpha\nAgent: Verified alpha from source";
    const first = input("duplicate-a", "dev", "group-a", trace);
    const second = input("duplicate-b", "dev", "group-b", trace);

    expect(detectDuplicateTraces([first, second])).toEqual([
      expect.objectContaining({
        code: "duplicate_trace",
        case_ids: ["duplicate-a", "duplicate-b"]
      })
    ]);
  });

  it("detects token-shingle near duplicates and excludes intentional groups", () => {
    const first = input(
      "near-a",
      "dev",
      "near-group-a",
      "User: Verify alpha count from the visible report\nAgent: The verified alpha count is three from the visible report"
    );
    const second = input(
      "near-b",
      "test",
      "near-group-b",
      "User: Verify beta count from the visible report\nAgent: The verified beta count is three from the visible report"
    );
    const sameGroup = { ...second, group_id: first.group_id };

    expect(
      detectNearDuplicateTraces([first, second], {
        threshold: 0.35,
        cross_split_only: true
      })
    ).toEqual([
      expect.objectContaining({
        left_case_id: "near-a",
        right_case_id: "near-b"
      })
    ]);
    expect(
      detectNearDuplicateTraces([first, sameGroup], {
        threshold: 0.35,
        cross_split_only: true
      })
    ).toEqual([]);
    expect(() =>
      detectNearDuplicateTraces([first, second], { threshold: 1.1 })
    ).toThrow(/threshold/);
  });
});
