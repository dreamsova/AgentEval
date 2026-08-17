import { z } from "zod";

import {
  BENCHMARK_SCHEMA_VERSION,
  FailureLabelSchema,
  IdentifierSchema,
  type FailureLabel
} from "./schema";
import { sha256 } from "./validation";

const LineSetSchema = z
  .array(z.number().int().positive())
  .superRefine((lines, context) => {
    if (new Set(lines).size !== lines.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evidence line numbers must be unique"
      });
    }
  });

const OutcomeSchema = z
  .object({
    reliable: z.boolean(),
    primary_failure: FailureLabelSchema.nullable(),
    evidence_lines: LineSetSchema
  })
  .strict();

const EfficiencySchema = z
  .object({
    latency_ms: z.number().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    tool_calls: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Efficiency records must contain at least one measurement"
  });

export const PredictionRecordSchema = z
  .object({
    schema_version: z.literal(BENCHMARK_SCHEMA_VERSION),
    case_id: IdentifierSchema,
    group_id: IdentifierSchema,
    counterfactual_pair_id: IdentifierSchema.optional(),
    style_pair_id: IdentifierSchema.optional(),
    gold: OutcomeSchema,
    prediction: OutcomeSchema.extend({
      reliability_score: z.number().min(0).max(1).optional()
    }).strict(),
    efficiency: EfficiencySchema.optional()
  })
  .strict()
  .superRefine((record, context) => {
    if (record.gold.reliable !== (record.gold.primary_failure === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gold", "primary_failure"],
        message: "Gold reliable cases require null primary failure and vice versa"
      });
    }
    if (record.prediction.reliable && record.prediction.primary_failure !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prediction", "primary_failure"],
        message: "Predicted reliable cases cannot have a primary failure"
      });
    }
  });

export const PredictionFileSchema = z
  .object({
    schema_version: z.literal(BENCHMARK_SCHEMA_VERSION),
    prediction_set_id: IdentifierSchema,
    records: z.array(PredictionRecordSchema)
  })
  .strict()
  .superRefine((file, context) => {
    const ids = new Set<string>();
    for (const [index, record] of file.records.entries()) {
      if (ids.has(record.case_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["records", index, "case_id"],
          message: "Prediction case IDs must be unique"
        });
      }
      ids.add(record.case_id);
    }
  });

export type PredictionRecord = z.infer<typeof PredictionRecordSchema>;
export type PredictionFile = z.infer<typeof PredictionFileSchema>;

export type ClassMetrics = {
  support: number;
  predicted_support: number;
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};

export type Aggregate = {
  count: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
};

export type MetricsReport = {
  count: number;
  binary: {
    accuracy: number | null;
    balanced_accuracy: number | null;
    macro_f1: number | null;
    auroc: number | null;
    auprc: number | null;
    score_sd: number | null;
    score_count: number;
    reliable: ClassMetrics;
    unreliable: ClassMetrics;
  };
  failure_classes: Record<FailureLabel, ClassMetrics>;
  evidence_lines: {
    true_positives: number;
    false_positives: number;
    false_negatives: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  style_pairs: {
    eligible_pairs: number;
    invalid_pairs: number;
    correct_pairs: number;
    flipped_pairs: number;
    accuracy: number | null;
    label_flip_rate: number | null;
  };
  efficiency: {
    latency_ms: Aggregate | null;
    input_tokens: Aggregate | null;
    output_tokens: Aggregate | null;
    total_tokens: Aggregate | null;
    tool_calls: Aggregate | null;
  };
};

function divide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function classMetrics(actual: readonly boolean[], predicted: readonly boolean[]): ClassMetrics {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] && predicted[index]) truePositives += 1;
    if (!actual[index] && predicted[index]) falsePositives += 1;
    if (actual[index] && !predicted[index]) falseNegatives += 1;
  }
  return {
    support: actual.filter(Boolean).length,
    predicted_support: predicted.filter(Boolean).length,
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    precision: divide(truePositives, truePositives + falsePositives),
    recall: divide(truePositives, truePositives + falseNegatives),
    f1: divide(2 * truePositives, 2 * truePositives + falsePositives + falseNegatives)
  };
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function auroc(records: readonly PredictionRecord[]): number | null {
  if (
    records.length === 0 ||
    records.some((record) => record.prediction.reliability_score === undefined)
  ) {
    return null;
  }
  const positives = records.filter((record) => record.gold.reliable).length;
  const negatives = records.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const sorted = records
    .map((record) => ({
      positive: record.gold.reliable,
      score: record.prediction.reliability_score as number
    }))
    .sort((left, right) => left.score - right.score);
  let positiveRankSum = 0;
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].score === sorted[index].score) end += 1;
    const averageRank = (index + 1 + end) / 2;
    positiveRankSum += sorted
      .slice(index, end)
      .filter((item) => item.positive).length * averageRank;
    index = end;
  }
  return (
    (positiveRankSum - (positives * (positives + 1)) / 2) /
    (positives * negatives)
  );
}

function auprc(records: readonly PredictionRecord[]): number | null {
  if (
    records.length === 0 ||
    records.some((record) => record.prediction.reliability_score === undefined)
  ) {
    return null;
  }
  const positives = records.filter((record) => record.gold.reliable).length;
  const negatives = records.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const sorted = records
    .map((record) => ({
      positive: record.gold.reliable,
      score: record.prediction.reliability_score as number
    }))
    .sort((left, right) => right.score - left.score);
  let truePositives = 0;
  let falsePositives = 0;
  let previousRecall = 0;
  let area = 0;
  let index = 0;
  while (index < sorted.length) {
    let end = index + 1;
    while (end < sorted.length && sorted[end].score === sorted[index].score) end += 1;
    for (const item of sorted.slice(index, end)) {
      if (item.positive) truePositives += 1;
      else falsePositives += 1;
    }
    const recall = truePositives / positives;
    const precision = truePositives / (truePositives + falsePositives);
    area += (recall - previousRecall) * precision;
    previousRecall = recall;
    index = end;
  }
  return area;
}

function populationSd(values: readonly number[]): number | null {
  const average = mean(values);
  if (average === null) return null;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      values.length
  );
}

function aggregate(values: readonly number[]): Aggregate | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return {
    count: sorted.length,
    mean: mean(sorted) as number,
    median,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

export function computeMetrics(records: readonly PredictionRecord[]): MetricsReport {
  const actualReliable = records.map((record) => record.gold.reliable);
  const predictedReliable = records.map((record) => record.prediction.reliable);
  const reliableMetrics = classMetrics(actualReliable, predictedReliable);
  const unreliableMetrics = classMetrics(
    actualReliable.map((value) => !value),
    predictedReliable.map((value) => !value)
  );
  const correct = records.filter(
    (record) => record.gold.reliable === record.prediction.reliable
  ).length;
  const scores = records.flatMap((record) =>
    record.prediction.reliability_score === undefined
      ? []
      : [record.prediction.reliability_score]
  );

  const failureClasses = Object.fromEntries(
    FailureLabelSchema.options.map((failure) => [
      failure,
      classMetrics(
        records.map((record) => record.gold.primary_failure === failure),
        records.map((record) => record.prediction.primary_failure === failure)
      )
    ])
  ) as Record<FailureLabel, ClassMetrics>;

  let evidenceTruePositives = 0;
  let evidenceFalsePositives = 0;
  let evidenceFalseNegatives = 0;
  for (const record of records) {
    const gold = new Set(record.gold.evidence_lines);
    const predicted = new Set(record.prediction.evidence_lines);
    for (const line of predicted) {
      if (gold.has(line)) evidenceTruePositives += 1;
      else evidenceFalsePositives += 1;
    }
    for (const line of gold) {
      if (!predicted.has(line)) evidenceFalseNegatives += 1;
    }
  }

  const pairs = new Map<string, PredictionRecord[]>();
  for (const record of records) {
    if (record.style_pair_id === undefined) continue;
    pairs.set(record.style_pair_id, [
      ...(pairs.get(record.style_pair_id) ?? []),
      record
    ]);
  }
  let eligiblePairs = 0;
  let invalidPairs = 0;
  let correctPairs = 0;
  let flippedPairs = 0;
  for (const pair of pairs.values()) {
    if (pair.length !== 2 || pair[0].gold.reliable !== pair[1].gold.reliable) {
      invalidPairs += 1;
      continue;
    }
    eligiblePairs += 1;
    if (
      pair.every(
        (record) => record.prediction.reliable === record.gold.reliable
      )
    ) {
      correctPairs += 1;
    }
    if (pair[0].prediction.reliable !== pair[1].prediction.reliable) {
      flippedPairs += 1;
    }
  }

  const latencies = records.flatMap((record) =>
    record.efficiency?.latency_ms === undefined
      ? []
      : [record.efficiency.latency_ms]
  );
  const inputTokens = records.flatMap((record) =>
    record.efficiency?.input_tokens === undefined
      ? []
      : [record.efficiency.input_tokens]
  );
  const outputTokens = records.flatMap((record) =>
    record.efficiency?.output_tokens === undefined
      ? []
      : [record.efficiency.output_tokens]
  );
  const totalTokens = records.flatMap((record) =>
    record.efficiency?.input_tokens === undefined ||
    record.efficiency.output_tokens === undefined
      ? []
      : [record.efficiency.input_tokens + record.efficiency.output_tokens]
  );
  const toolCalls = records.flatMap((record) =>
    record.efficiency?.tool_calls === undefined
      ? []
      : [record.efficiency.tool_calls]
  );

  return {
    count: records.length,
    binary: {
      accuracy: divide(correct, records.length),
      balanced_accuracy:
        reliableMetrics.recall === null || unreliableMetrics.recall === null
          ? null
          : (reliableMetrics.recall + unreliableMetrics.recall) / 2,
      macro_f1:
        reliableMetrics.f1 === null || unreliableMetrics.f1 === null
          ? null
          : (reliableMetrics.f1 + unreliableMetrics.f1) / 2,
      auroc: auroc(records),
      auprc: auprc(records),
      score_sd: populationSd(scores),
      score_count: scores.length,
      reliable: reliableMetrics,
      unreliable: unreliableMetrics
    },
    failure_classes: failureClasses,
    evidence_lines: {
      true_positives: evidenceTruePositives,
      false_positives: evidenceFalsePositives,
      false_negatives: evidenceFalseNegatives,
      precision: divide(
        evidenceTruePositives,
        evidenceTruePositives + evidenceFalsePositives
      ),
      recall: divide(
        evidenceTruePositives,
        evidenceTruePositives + evidenceFalseNegatives
      ),
      f1: divide(
        2 * evidenceTruePositives,
        2 * evidenceTruePositives + evidenceFalsePositives + evidenceFalseNegatives
      )
    },
    style_pairs: {
      eligible_pairs: eligiblePairs,
      invalid_pairs: invalidPairs,
      correct_pairs: correctPairs,
      flipped_pairs: flippedPairs,
      accuracy: divide(correctPairs, eligiblePairs),
      label_flip_rate: divide(flippedPairs, eligiblePairs)
    },
    efficiency: {
      latency_ms: aggregate(latencies),
      input_tokens: aggregate(inputTokens),
      output_tokens: aggregate(outputTokens),
      total_tokens: aggregate(totalTokens),
      tool_calls: aggregate(toolCalls)
    }
  };
}

export type MetricInterval = {
  estimate: number | null;
  lower: number | null;
  upper: number | null;
  valid_samples: number;
};

export type BootstrapReport = {
  seed: string;
  iterations: number;
  confidence_level: number;
  group_count: number;
  intervals: Record<string, MetricInterval>;
};

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function bootstrapGetters(): Record<string, (report: MetricsReport) => number | null> {
  const base: Record<string, (report: MetricsReport) => number | null> = {
    balanced_accuracy: (report) => report.binary.balanced_accuracy,
    macro_f1: (report) => report.binary.macro_f1,
    auroc: (report) => report.binary.auroc,
    auprc: (report) => report.binary.auprc,
    score_sd: (report) => report.binary.score_sd,
    evidence_line_precision: (report) => report.evidence_lines.precision,
    evidence_line_recall: (report) => report.evidence_lines.recall,
    style_pair_accuracy: (report) => report.style_pairs.accuracy,
    label_flip_rate: (report) => report.style_pairs.label_flip_rate,
    mean_latency_ms: (report) => report.efficiency.latency_ms?.mean ?? null,
    mean_total_tokens: (report) => report.efficiency.total_tokens?.mean ?? null,
    mean_tool_calls: (report) => report.efficiency.tool_calls?.mean ?? null
  };
  for (const failure of FailureLabelSchema.options) {
    base[`failure_${failure}_f1`] = (report) =>
      report.failure_classes[failure].f1;
  }
  return base;
}

export function bootstrapConfidenceIntervals(
  records: readonly PredictionRecord[],
  options: {
    seed: string;
    iterations?: number;
    confidence_level?: number;
  }
): BootstrapReport {
  const iterations = options.iterations ?? 1000;
  const confidenceLevel = options.confidence_level ?? 0.95;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("Bootstrap iterations must be a positive integer");
  }
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new Error("Bootstrap confidence level must be between 0 and 1");
  }

  const grouped = new Map<string, PredictionRecord[]>();
  for (const record of records) {
    grouped.set(record.group_id, [...(grouped.get(record.group_id) ?? []), record]);
  }
  const groups = [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const getters = bootstrapGetters();
  const values = Object.fromEntries(
    Object.keys(getters).map((name) => [name, [] as number[]])
  );
  const random = seededRandom(options.seed);

  if (groups.length > 0) {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const sample: PredictionRecord[] = [];
      for (let draw = 0; draw < groups.length; draw += 1) {
        const selected = groups[Math.floor(random() * groups.length)][1];
        for (const record of selected) {
          sample.push({
            ...record,
            case_id: `${record.case_id}-bootstrap-${draw}`,
            group_id: `${record.group_id}-bootstrap-${draw}`,
            counterfactual_pair_id:
              record.counterfactual_pair_id === undefined
                ? undefined
                : `${record.counterfactual_pair_id}-bootstrap-${draw}`,
            style_pair_id:
              record.style_pair_id === undefined
                ? undefined
                : `${record.style_pair_id}-bootstrap-${draw}`
          });
        }
      }
      const report = computeMetrics(sample);
      for (const [name, getter] of Object.entries(getters)) {
        const value = getter(report);
        if (value !== null && Number.isFinite(value)) values[name].push(value);
      }
    }
  }

  const actual = computeMetrics(records);
  const tail = (1 - confidenceLevel) / 2;
  const intervals = Object.fromEntries(
    Object.entries(getters).map(([name, getter]) => {
      const sorted = values[name].sort((left, right) => left - right);
      return [
        name,
        {
          estimate: getter(actual),
          lower: percentile(sorted, tail),
          upper: percentile(sorted, 1 - tail),
          valid_samples: sorted.length
        }
      ];
    })
  );

  return {
    seed: options.seed,
    iterations,
    confidence_level: confidenceLevel,
    group_count: groups.length,
    intervals
  };
}
