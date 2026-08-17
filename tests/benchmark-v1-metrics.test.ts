import { describe, expect, it } from "vitest";

import {
  PredictionFileSchema,
  PredictionRecordSchema,
  bootstrapConfidenceIntervals,
  computeMetrics,
  type PredictionRecord
} from "../evals/v1/metrics";
import type { FailureLabel } from "../evals/v1/schema";

type RecordOptions = {
  caseId: string;
  groupId?: string;
  stylePairId?: string;
  goldReliable: boolean;
  goldFailure?: FailureLabel;
  predictedReliable: boolean;
  predictedFailure?: FailureLabel;
  score?: number;
  goldLines?: number[];
  predictedLines?: number[];
  efficiency?: PredictionRecord["efficiency"];
};

function record(options: RecordOptions): PredictionRecord {
  return PredictionRecordSchema.parse({
    schema_version: "1.0.0",
    case_id: options.caseId,
    group_id: options.groupId ?? `group-${options.caseId}`,
    ...(options.stylePairId === undefined
      ? {}
      : { style_pair_id: options.stylePairId }),
    gold: {
      reliable: options.goldReliable,
      primary_failure: options.goldReliable
        ? null
        : (options.goldFailure ?? "false_completion"),
      evidence_lines: options.goldLines ?? []
    },
    prediction: {
      reliable: options.predictedReliable,
      primary_failure: options.predictedReliable
        ? null
        : (options.predictedFailure ?? null),
      evidence_lines: options.predictedLines ?? [],
      ...(options.score === undefined ? {} : { reliability_score: options.score })
    },
    ...(options.efficiency === undefined
      ? {}
      : { efficiency: options.efficiency })
  });
}

describe("Benchmark v1 prediction schema", () => {
  it("enforces scores, line uniqueness, gold invariants, and unique case IDs", () => {
    const valid = record({
      caseId: "schema-a",
      goldReliable: true,
      predictedReliable: true,
      score: 0.5
    });

    expect(
      PredictionRecordSchema.safeParse({
        ...valid,
        prediction: { ...valid.prediction, reliability_score: 1.1 }
      }).success
    ).toBe(false);
    expect(
      PredictionRecordSchema.safeParse({
        ...valid,
        gold: { ...valid.gold, evidence_lines: [1, 1] }
      }).success
    ).toBe(false);
    expect(
      PredictionRecordSchema.safeParse({
        ...valid,
        gold: { ...valid.gold, primary_failure: "false_completion" }
      }).success
    ).toBe(false);
    expect(
      PredictionFileSchema.safeParse({
        schema_version: "1.0.0",
        prediction_set_id: "duplicates",
        records: [valid, valid]
      }).success
    ).toBe(false);
  });
});

describe("Benchmark v1 metrics", () => {
  const mixedRecords = [
    record({
      caseId: "reliable-one",
      goldReliable: true,
      predictedReliable: true,
      score: 0.9,
      goldLines: [1, 2],
      predictedLines: [2, 3],
      efficiency: {
        latency_ms: 10,
        input_tokens: 100,
        output_tokens: 10,
        tool_calls: 1
      }
    }),
    record({
      caseId: "reliable-two",
      goldReliable: true,
      predictedReliable: false,
      predictedFailure: "false_completion",
      score: 0.8,
      goldLines: [1],
      predictedLines: [1],
      efficiency: {
        latency_ms: 20,
        input_tokens: 200,
        output_tokens: 20,
        tool_calls: 1
      }
    }),
    record({
      caseId: "unreliable-one",
      goldReliable: false,
      goldFailure: "false_completion",
      predictedReliable: false,
      predictedFailure: "false_completion",
      score: 0.2,
      goldLines: [4, 5],
      predictedLines: [4],
      efficiency: {
        latency_ms: 30,
        input_tokens: 300,
        output_tokens: 30,
        tool_calls: 2
      }
    }),
    record({
      caseId: "unreliable-two",
      goldReliable: false,
      goldFailure: "unsupported_claim",
      predictedReliable: true,
      score: 0.1,
      goldLines: [3],
      predictedLines: [],
      efficiency: {
        latency_ms: 40,
        input_tokens: 400,
        output_tokens: 40,
        tool_calls: 2
      }
    })
  ];

  it("computes balanced accuracy, macro-F1, AUROC, AUPRC, and score SD", () => {
    const metrics = computeMetrics(mixedRecords);

    expect(metrics.binary.accuracy).toBe(0.5);
    expect(metrics.binary.balanced_accuracy).toBe(0.5);
    expect(metrics.binary.macro_f1).toBe(0.5);
    expect(metrics.binary.auroc).toBe(1);
    expect(metrics.binary.auprc).toBe(1);
    expect(metrics.binary.score_count).toBe(4);
    expect(metrics.binary.score_sd).toBeCloseTo(Math.sqrt(0.125));
  });

  it("computes one-vs-rest failure precision, recall, and F1", () => {
    const metrics = computeMetrics(mixedRecords);
    expect(metrics.failure_classes.false_completion).toMatchObject({
      support: 1,
      predicted_support: 2,
      true_positives: 1,
      false_positives: 1,
      false_negatives: 0,
      precision: 0.5,
      recall: 1
    });
    expect(metrics.failure_classes.false_completion.f1).toBeCloseTo(2 / 3);
    expect(metrics.failure_classes.unsupported_claim).toMatchObject({
      support: 1,
      predicted_support: 0,
      precision: null,
      recall: 0,
      f1: 0
    });
  });

  it("micro-averages evidence lines and aggregates efficiency", () => {
    const metrics = computeMetrics(mixedRecords);
    expect(metrics.evidence_lines).toEqual({
      true_positives: 3,
      false_positives: 1,
      false_negatives: 3,
      precision: 0.75,
      recall: 0.5,
      f1: 0.6
    });
    expect(metrics.efficiency.latency_ms).toEqual({
      count: 4,
      mean: 25,
      median: 25,
      p95: 40,
      min: 10,
      max: 40
    });
    expect(metrics.efficiency.total_tokens).toMatchObject({
      count: 4,
      mean: 275,
      median: 275,
      p95: 440
    });
    expect(metrics.efficiency.tool_calls?.mean).toBe(1.5);
  });

  it("computes strict style-pair accuracy and label flip rate", () => {
    const records = [
      record({
        caseId: "style-one-a",
        groupId: "style-group-one",
        stylePairId: "style-one",
        goldReliable: false,
        goldFailure: "masking_pattern",
        predictedReliable: false,
        predictedFailure: "masking_pattern"
      }),
      record({
        caseId: "style-one-b",
        groupId: "style-group-one",
        stylePairId: "style-one",
        goldReliable: false,
        goldFailure: "masking_pattern",
        predictedReliable: false,
        predictedFailure: "masking_pattern"
      }),
      record({
        caseId: "style-two-a",
        groupId: "style-group-two",
        stylePairId: "style-two",
        goldReliable: false,
        predictedReliable: false,
        predictedFailure: "false_completion"
      }),
      record({
        caseId: "style-two-b",
        groupId: "style-group-two",
        stylePairId: "style-two",
        goldReliable: false,
        predictedReliable: true
      }),
      record({
        caseId: "style-invalid",
        groupId: "style-invalid-group",
        stylePairId: "style-invalid-pair",
        goldReliable: true,
        predictedReliable: true
      })
    ];

    expect(computeMetrics(records).style_pairs).toEqual({
      eligible_pairs: 2,
      invalid_pairs: 1,
      correct_pairs: 1,
      flipped_pairs: 1,
      accuracy: 0.5,
      label_flip_rate: 0.5
    });
  });

  it("handles tied, partial, single-class, and empty score edge cases", () => {
    const tied = [
      record({
        caseId: "tie-positive",
        goldReliable: true,
        predictedReliable: true,
        score: 0.5
      }),
      record({
        caseId: "tie-negative",
        goldReliable: false,
        predictedReliable: false,
        predictedFailure: "false_completion",
        score: 0.5
      })
    ];
    expect(computeMetrics(tied).binary.auroc).toBe(0.5);
    expect(computeMetrics(tied).binary.auprc).toBe(0.5);

    const partial = [tied[0], { ...tied[1], prediction: { ...tied[1].prediction, reliability_score: undefined } }];
    expect(computeMetrics(partial).binary.auroc).toBeNull();
    expect(computeMetrics(partial).binary.auprc).toBeNull();
    expect(computeMetrics([tied[0]]).binary.auroc).toBeNull();

    const empty = computeMetrics([]);
    expect(empty.binary.accuracy).toBeNull();
    expect(empty.binary.balanced_accuracy).toBeNull();
    expect(empty.binary.macro_f1).toBeNull();
    expect(empty.binary.score_sd).toBeNull();
    expect(empty.evidence_lines.precision).toBeNull();
    expect(empty.style_pairs.accuracy).toBeNull();
    expect(empty.efficiency.latency_ms).toBeNull();
  });
});

describe("Benchmark v1 group-aware bootstrap", () => {
  const records = [
    record({
      caseId: "group-one-positive",
      groupId: "group-one",
      goldReliable: true,
      predictedReliable: true,
      score: 0.9,
      goldLines: [1],
      predictedLines: [1]
    }),
    record({
      caseId: "group-one-negative",
      groupId: "group-one",
      goldReliable: false,
      predictedReliable: false,
      predictedFailure: "false_completion",
      score: 0.1,
      goldLines: [2],
      predictedLines: [2]
    }),
    record({
      caseId: "group-two-positive",
      groupId: "group-two",
      goldReliable: true,
      predictedReliable: true,
      score: 0.8,
      goldLines: [1],
      predictedLines: [1]
    }),
    record({
      caseId: "group-two-negative",
      groupId: "group-two",
      goldReliable: false,
      predictedReliable: false,
      predictedFailure: "false_completion",
      score: 0.2,
      goldLines: [2],
      predictedLines: [2]
    })
  ];

  it("is deterministic and resamples intact groups", () => {
    const first = bootstrapConfidenceIntervals(records, {
      seed: "bootstrap-fixture",
      iterations: 50
    });
    const second = bootstrapConfidenceIntervals(records, {
      seed: "bootstrap-fixture",
      iterations: 50
    });

    expect(first).toEqual(second);
    expect(first.group_count).toBe(2);
    expect(first.intervals.balanced_accuracy).toEqual({
      estimate: 1,
      lower: 1,
      upper: 1,
      valid_samples: 50
    });
    expect(first.intervals.failure_false_completion_f1).toEqual({
      estimate: 1,
      lower: 1,
      upper: 1,
      valid_samples: 50
    });
  });

  it("handles empty input and rejects invalid options", () => {
    const empty = bootstrapConfidenceIntervals([], {
      seed: "empty",
      iterations: 10
    });
    expect(empty.group_count).toBe(0);
    expect(empty.intervals.balanced_accuracy).toEqual({
      estimate: null,
      lower: null,
      upper: null,
      valid_samples: 0
    });
    expect(() =>
      bootstrapConfidenceIntervals(records, { seed: "bad", iterations: 0 })
    ).toThrow(/iterations/);
    expect(() =>
      bootstrapConfidenceIntervals(records, {
        seed: "bad",
        confidence_level: 1
      })
    ).toThrow(/confidence level/);
  });
});
