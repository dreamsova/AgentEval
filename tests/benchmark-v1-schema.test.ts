import { describe, expect, it } from "vitest";

import legacyBenchmarkJson from "../evals/benchmark.json";
import devInputsJson from "../evals/v1/datasets/dev/inputs.json";
import devLabelsJson from "../evals/v1/datasets/dev/labels.json";
import regressionInputsJson from "../evals/v1/datasets/regression/inputs.json";
import regressionLabelsJson from "../evals/v1/datasets/regression/labels.json";
import testLabelsJson from "../evals/v1/datasets/test-labels/candidate-labels.json";
import testInputsJson from "../evals/v1/datasets/test/inputs.json";
import {
  BENCHMARK_SCHEMA_VERSION,
  BenchmarkInputFileSchema,
  BenchmarkInputSchema,
  BenchmarkLabelFileSchema,
  BenchmarkLabelSchema,
  FailureLabelSchema
} from "../evals/v1/schema";
import { validateInputLabelCoverage } from "../evals/v1/validation";

describe("Benchmark v1 schema", () => {
  it("parses every committed input and label file", () => {
    const devInputs = BenchmarkInputFileSchema.parse(devInputsJson);
    const devLabels = BenchmarkLabelFileSchema.parse(devLabelsJson);
    const regressionInputs = BenchmarkInputFileSchema.parse(regressionInputsJson);
    const regressionLabels = BenchmarkLabelFileSchema.parse(regressionLabelsJson);
    const testInputs = BenchmarkInputFileSchema.parse(testInputsJson);
    const testLabels = BenchmarkLabelFileSchema.parse(testLabelsJson);

    expect(BENCHMARK_SCHEMA_VERSION).toBe("1.0.0");
    expect(devInputs.cases).toHaveLength(16);
    expect(regressionInputs.cases).toHaveLength(8);
    expect(testInputs.cases).toHaveLength(60);
    expect(validateInputLabelCoverage(devInputs, devLabels)).toEqual([]);
    expect(
      validateInputLabelCoverage(regressionInputs, regressionLabels)
    ).toEqual([]);
    expect(validateInputLabelCoverage(testInputs, testLabels)).toEqual([]);
  });

  it("marks all migrated cases as visible legacy development data", () => {
    const inputs = [
      ...BenchmarkInputFileSchema.parse(devInputsJson).cases,
      ...BenchmarkInputFileSchema.parse(regressionInputsJson).cases
    ];
    const labels = [
      ...BenchmarkLabelFileSchema.parse(devLabelsJson).labels,
      ...BenchmarkLabelFileSchema.parse(regressionLabelsJson).labels
    ];

    const legacyInputs = inputs.filter((input) => input.source_metadata.legacy);
    expect(inputs).toHaveLength(24);
    expect(legacyInputs).toHaveLength(12);
    expect(
      legacyInputs.every(
        (input) =>
          input.source_metadata.origin === "legacy_benchmark" &&
          input.source_metadata.legacy &&
          input.source_metadata.development_only &&
          !input.source_metadata.unseen
      )
    ).toBe(true);

    const migratedById = new Map(inputs.map((input) => [input.case_id, input]));
    const labelsById = new Map(labels.map((label) => [label.case_id, label]));
    expect(legacyInputs.map((input) => input.case_id).sort()).toEqual(
      legacyBenchmarkJson.map((item) => item.id).sort()
    );
    for (const legacy of legacyBenchmarkJson) {
      expect(migratedById.get(legacy.id)?.trace).toBe(legacy.trace);
      expect(labelsById.get(legacy.id)?.reliable).toBe(
        legacy.expectedBand === "reliable"
      );
      expect(labelsById.get(legacy.id)?.review_status).toBe(
        "needs_human_review"
      );
    }
  });

  it("anchors every gold quote to its declared trace lines", () => {
    const inputs = [
      ...BenchmarkInputFileSchema.parse(devInputsJson).cases,
      ...BenchmarkInputFileSchema.parse(regressionInputsJson).cases,
      ...BenchmarkInputFileSchema.parse(testInputsJson).cases
    ];
    const labels = [
      ...BenchmarkLabelFileSchema.parse(devLabelsJson).labels,
      ...BenchmarkLabelFileSchema.parse(regressionLabelsJson).labels,
      ...BenchmarkLabelFileSchema.parse(testLabelsJson).labels
    ];
    const inputById = new Map(inputs.map((input) => [input.case_id, input]));

    for (const label of labels) {
      const lines = inputById.get(label.case_id)?.trace.split("\n") ?? [];
      for (const evidence of label.gold_evidence) {
        const citedText = lines
          .slice(evidence.line_start - 1, evidence.line_end ?? evidence.line_start)
          .join("\n");
        expect(citedText, `${label.case_id}: ${evidence.quote}`).toContain(
          evidence.quote
        );
      }
    }
  });

  it("contains only the observable v1 taxonomy", () => {
    expect(FailureLabelSchema.options).toEqual([
      "false_completion",
      "unsupported_claim",
      "partial_completion_overclaim",
      "tool_result_contradiction",
      "artifact_provenance_mismatch",
      "masking_pattern"
    ]);
    expect(FailureLabelSchema.options).not.toContain("strategic_masking");
  });

  it("enforces binary reliability invariants", () => {
    const reliableWithFailure = {
      ...devLabelsJson.labels[0],
      primary_failure: "false_completion",
      failures: ["false_completion"]
    };
    const unreliableWithoutFailure = {
      ...devLabelsJson.labels[4],
      primary_failure: null,
      failures: []
    };

    expect(BenchmarkLabelSchema.safeParse(reliableWithFailure).success).toBe(false);
    expect(BenchmarkLabelSchema.safeParse(unreliableWithoutFailure).success).toBe(
      false
    );
  });

  it("keeps label fields out of strict test input records", () => {
    const input = testInputsJson.cases[0];
    expect(BenchmarkInputSchema.safeParse({ ...input, reliable: true }).success).toBe(
      false
    );
    expect(testInputsJson).not.toHaveProperty("labels");
    expect(testLabelsJson).not.toHaveProperty("cases");
  });

  it("marks every proposed annotation as needing human review", () => {
    const labels = [
      ...BenchmarkLabelFileSchema.parse(devLabelsJson).labels,
      ...BenchmarkLabelFileSchema.parse(regressionLabelsJson).labels,
      ...BenchmarkLabelFileSchema.parse(testLabelsJson).labels
    ];
    expect(labels).toHaveLength(84);
    expect(
      labels.every((label) => label.review_status === "needs_human_review")
    ).toBe(true);
  });
});
