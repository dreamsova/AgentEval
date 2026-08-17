import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  bootstrapConfidenceIntervals,
  computeMetrics,
  PredictionRecordSchema,
  type PredictionRecord
} from "@/evals/v1/metrics";
import {
  BENCHMARK_SCHEMA_VERSION,
  BenchmarkInputFileSchema,
  BenchmarkLabelFileSchema,
  type BenchmarkInput,
  type BenchmarkLabel
} from "@/evals/v1/schema";
import {
  canonicalJson,
  computeCanonicalSha256,
  validateInputLabelCoverage
} from "@/evals/v1/validation";
import type {
  BenchmarkCaseRecord,
  BenchmarkEvaluator,
  EvaluatorError,
  EvaluatorResult
} from "@/lib/evaluators/types";
import { BENCHMARK_RUN_SCHEMA_VERSION } from "@/lib/evaluators/types";

export type RetryPolicy = {
  max_attempts: number;
  initial_delay_ms: number;
  max_delay_ms: number;
};

export type BenchmarkRunOptions = {
  input_path: string;
  label_path?: string;
  output_directory: string;
  evaluator: BenchmarkEvaluator;
  concurrency?: number;
  retry?: Partial<RetryPolicy>;
  experimental_mode?: boolean;
  resume?: boolean;
  retry_failed_on_resume?: boolean;
  max_cases?: number;
  bootstrap?: {
    seed?: string;
    iterations?: number;
    confidence_level?: number;
  };
};

export type BenchmarkManifest = {
  schema_version: typeof BENCHMARK_RUN_SCHEMA_VERSION;
  benchmark_schema_version: typeof BENCHMARK_SCHEMA_VERSION;
  run_id: string;
  dataset_id: string;
  split: string;
  input_file: string;
  case_ids: string[];
  evaluator: BenchmarkEvaluator["descriptor"];
  hashes: {
    dataset: string;
    evaluator: string;
    prompt: string;
    toolset: string;
  };
  execution_policy: {
    concurrency: number;
    retry: RetryPolicy;
    experimental_mode: boolean;
  };
  artifacts: {
    predictions: "predictions.jsonl";
    summary: "summary.json";
  };
};

export type BenchmarkSummary = {
  schema_version: typeof BENCHMARK_RUN_SCHEMA_VERSION;
  run_id: string;
  dataset_id: string;
  evaluator_id: string;
  status: "complete" | "partial" | "failed";
  execution: {
    total_cases: number;
    selected_cases: number;
    succeeded: number;
    failed: number;
    pending: number;
    degraded: number;
    fallback_records: number;
    model_calls: number;
    tool_calls: number;
  };
  classification: ReturnType<typeof computeMetrics>["binary"] | null;
  failure_classes: ReturnType<typeof computeMetrics>["failure_classes"] | null;
  evidence: ReturnType<typeof computeMetrics>["evidence_lines"] | null;
  pair_stability: {
    style_pairs: ReturnType<typeof computeMetrics>["style_pairs"];
    counterfactual_pairs: CounterfactualPairSummary;
  } | null;
  efficiency: ReturnType<typeof computeMetrics>["efficiency"] | RawEfficiency;
  confidence_intervals: ReturnType<typeof bootstrapConfidenceIntervals> | null;
  scoring: {
    labels_provided: boolean;
    label_hash: string | null;
    scored_records: number;
  };
};

export type BenchmarkRunResult = {
  run_id: string;
  run_directory: string;
  manifest_path: string;
  predictions_path: string;
  summary_path: string;
  records: BenchmarkCaseRecord[];
  manifest: BenchmarkManifest;
  summary: BenchmarkSummary;
};

type CounterfactualPairSummary = {
  eligible_pairs: number;
  invalid_pairs: number;
  correct_pairs: number;
  predicted_flip_pairs: number;
  strict_accuracy: number | null;
  predicted_flip_rate: number | null;
};

type RawAggregate = {
  count: number;
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
};

type RawEfficiency = {
  latency_ms: RawAggregate | null;
  input_tokens: RawAggregate | null;
  output_tokens: RawAggregate | null;
  total_tokens: RawAggregate | null;
  tool_calls: RawAggregate | null;
};

const DEFAULT_RETRY: RetryPolicy = {
  max_attempts: 2,
  initial_delay_ms: 100,
  max_delay_ms: 1_000
};

class FallbackRejectedError extends Error {
  readonly code = "fallback_rejected";
  readonly retryable = false;

  constructor(readonly result: EvaluatorResult) {
    super(
      `Evaluator returned fallback engine ${result.fallback.engine ?? "unknown"}: ${result.fallback.reason ?? "no reason supplied"}`
    );
    this.name = "FallbackRejectedError";
  }
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function retryPolicy(input: Partial<RetryPolicy> | undefined): RetryPolicy {
  const result = { ...DEFAULT_RETRY, ...input };
  positiveInteger(result.max_attempts, "retry.max_attempts");
  if (!Number.isFinite(result.initial_delay_ms) || result.initial_delay_ms < 0) {
    throw new Error("retry.initial_delay_ms must be non-negative");
  }
  if (!Number.isFinite(result.max_delay_ms) || result.max_delay_ms < 0) {
    throw new Error("retry.max_delay_ms must be non-negative");
  }
  return result;
}

function assertFiniteNonNegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function validateEvaluatorResult(result: EvaluatorResult) {
  const score = result.prediction.reliability_score;
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("Evaluator reliability_score must be between 0 and 1");
  }
  if (result.prediction.reliable && result.prediction.primary_failure !== null) {
    throw new Error("Reliable evaluator predictions cannot name a primary failure");
  }
  assertFiniteNonNegative(result.latency_ms, "Evaluator latency_ms");
  assertFiniteNonNegative(result.tokens.input_tokens, "Evaluator input tokens");
  assertFiniteNonNegative(result.tokens.output_tokens, "Evaluator output tokens");
  assertFiniteNonNegative(result.tokens.total_tokens, "Evaluator total tokens");
  if (result.fallback.used && result.fallback.engine === null) {
    throw new Error("Fallback results must identify the fallback engine");
  }
}

function errorRecord(error: unknown, attempt: number): EvaluatorError {
  const retryable =
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
      ? error.retryable
      : true;
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "evaluation_error";
  return {
    code,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    retryable,
    attempt
  };
}

function emptyTokens() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    complete: false
  };
}

function hashesFor(
  inputFile: ReturnType<typeof BenchmarkInputFileSchema.parse>,
  evaluator: BenchmarkEvaluator
) {
  return {
    dataset: computeCanonicalSha256(inputFile),
    evaluator: computeCanonicalSha256(evaluator.descriptor),
    prompt: computeCanonicalSha256({
      version: evaluator.descriptor.prompt_version,
      prompt: evaluator.descriptor.prompt
    }),
    toolset: computeCanonicalSha256({
      version: evaluator.descriptor.toolset_version,
      tools: evaluator.descriptor.toolset
    })
  };
}

function buildManifest(
  inputPath: string,
  inputFile: ReturnType<typeof BenchmarkInputFileSchema.parse>,
  evaluator: BenchmarkEvaluator,
  concurrency: number,
  retry: RetryPolicy,
  experimentalMode: boolean
): BenchmarkManifest {
  const hashes = hashesFor(inputFile, evaluator);
  const runPayload = {
    benchmark_schema_version: BENCHMARK_SCHEMA_VERSION,
    dataset_id: inputFile.dataset_id,
    split: inputFile.split,
    case_ids: inputFile.cases.map((item) => item.case_id),
    hashes,
    execution_policy: {
      concurrency,
      retry,
      experimental_mode: experimentalMode
    }
  };
  const runId = `run-${computeCanonicalSha256(runPayload).slice(0, 24)}`;
  return {
    schema_version: BENCHMARK_RUN_SCHEMA_VERSION,
    benchmark_schema_version: BENCHMARK_SCHEMA_VERSION,
    run_id: runId,
    dataset_id: inputFile.dataset_id,
    split: inputFile.split,
    input_file: path.basename(inputPath),
    case_ids: [...runPayload.case_ids],
    evaluator: evaluator.descriptor,
    hashes,
    execution_policy: runPayload.execution_policy,
    artifacts: {
      predictions: "predictions.jsonl",
      summary: "summary.json"
    }
  };
}

async function writeAtomic(filePath: string, content: string) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

async function readExistingRecords(
  predictionsPath: string,
  manifest: BenchmarkManifest
): Promise<Map<string, BenchmarkCaseRecord>> {
  let raw: string;
  try {
    raw = await readFile(predictionsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const records = new Map<string, BenchmarkCaseRecord>();
  for (const [index, line] of raw.split("\n").entries()) {
    if (line.trim() === "") continue;
    const record = JSON.parse(line) as BenchmarkCaseRecord;
    if (
      record.schema_version !== BENCHMARK_RUN_SCHEMA_VERSION ||
      record.run_id !== manifest.run_id ||
      record.dataset_hash !== manifest.hashes.dataset ||
      record.evaluator_hash !== manifest.hashes.evaluator ||
      record.prompt_hash !== manifest.hashes.prompt ||
      record.toolset_hash !== manifest.hashes.toolset
    ) {
      throw new Error(`Resume record ${index + 1} does not match the manifest`);
    }
    if (records.has(record.case_id)) {
      throw new Error(`Duplicate resume record for ${record.case_id}`);
    }
    records.set(record.case_id, record);
  }
  return records;
}

function orderedRecords(
  cases: readonly BenchmarkInput[],
  records: ReadonlyMap<string, BenchmarkCaseRecord>
) {
  return cases.flatMap((input) => {
    const record = records.get(input.case_id);
    return record ? [record] : [];
  });
}

function recordJsonl(records: readonly BenchmarkCaseRecord[]) {
  return records.length === 0
    ? ""
    : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function sleep(milliseconds: number) {
  return milliseconds === 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function mapConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let next = 0;
  async function consume() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
}

function baseRecord(
  input: BenchmarkInput,
  manifest: BenchmarkManifest,
  attempts: number
) {
  return {
    schema_version: BENCHMARK_RUN_SCHEMA_VERSION,
    run_id: manifest.run_id,
    case_id: input.case_id,
    split: input.split,
    group_id: input.group_id,
    ...(input.counterfactual_pair_id === undefined
      ? {}
      : { counterfactual_pair_id: input.counterfactual_pair_id }),
    ...(input.style_pair_id === undefined
      ? {}
      : { style_pair_id: input.style_pair_id }),
    attempts,
    dataset_id: manifest.dataset_id,
    evaluator_id: manifest.evaluator.id,
    evaluator_version: manifest.evaluator.version,
    input_hash: computeCanonicalSha256(input),
    dataset_hash: manifest.hashes.dataset,
    evaluator_hash: manifest.hashes.evaluator,
    prompt_hash: manifest.hashes.prompt,
    toolset_hash: manifest.hashes.toolset
  };
}

async function evaluateCase(
  input: BenchmarkInput,
  evaluator: BenchmarkEvaluator,
  manifest: BenchmarkManifest,
  retry: RetryPolicy,
  experimentalMode: boolean
): Promise<BenchmarkCaseRecord> {
  const startedAt = Date.now();
  const errors: EvaluatorError[] = [];
  let fallbackResult: EvaluatorResult | null = null;
  for (let attempt = 1; attempt <= retry.max_attempts; attempt += 1) {
    try {
      const result = await evaluator.evaluate(input, {
        run_id: manifest.run_id,
        attempt
      });
      validateEvaluatorResult(result);
      if (experimentalMode && result.fallback.used) {
        fallbackResult = result;
        throw new FallbackRejectedError(result);
      }
      return {
        ...baseRecord(input, manifest, attempt),
        status: "succeeded",
        requested_model: result.requested_model,
        returned_model: result.returned_model,
        engine: result.engine,
        prediction: result.prediction,
        evidence: result.evidence,
        model_calls: result.model_calls,
        tool_calls: result.tool_calls,
        tokens: result.tokens,
        latency_ms: Math.max(result.latency_ms, Date.now() - startedAt),
        errors: [...errors, ...result.errors],
        degraded: result.degraded,
        degradation_reason: result.degradation_reason,
        fallback: result.fallback
      };
    } catch (error) {
      const captured = errorRecord(error, attempt);
      errors.push(captured);
      if (!captured.retryable || attempt === retry.max_attempts) break;
      const delay = Math.min(
        retry.max_delay_ms,
        retry.initial_delay_ms * 2 ** (attempt - 1)
      );
      await sleep(delay);
    }
  }
  const attempts = errors.at(-1)?.attempt ?? retry.max_attempts;
  return {
    ...baseRecord(input, manifest, attempts),
    status: "failed",
    requested_model:
      fallbackResult?.requested_model ?? evaluator.descriptor.requested_model,
    returned_model: fallbackResult?.returned_model ?? null,
    engine: fallbackResult?.engine ?? evaluator.descriptor.engine,
    prediction: null,
    evidence: [],
    model_calls: fallbackResult?.model_calls ?? [],
    tool_calls: fallbackResult?.tool_calls ?? [],
    tokens: fallbackResult?.tokens ?? emptyTokens(),
    latency_ms: Math.max(0, Date.now() - startedAt),
    errors: [...errors, ...(fallbackResult?.errors ?? [])],
    degraded: fallbackResult?.degraded ?? false,
    degradation_reason: fallbackResult?.degradation_reason ?? null,
    fallback: fallbackResult?.fallback ?? {
      used: false,
      engine: null,
      reason: null
    }
  };
}

function labelEvidenceLines(label: BenchmarkLabel) {
  const lines = new Set<number>();
  for (const evidence of label.gold_evidence) {
    const end = evidence.line_end ?? evidence.line_start;
    for (let line = evidence.line_start; line <= end; line += 1) lines.add(line);
  }
  return [...lines].sort((left, right) => left - right);
}

function predictionRecords(
  records: readonly BenchmarkCaseRecord[],
  labels: readonly BenchmarkLabel[]
): PredictionRecord[] {
  const labelById = new Map(labels.map((label) => [label.case_id, label]));
  return records.flatMap((record) => {
    if (record.status !== "succeeded" || record.prediction === null) return [];
    const label = labelById.get(record.case_id);
    if (!label) throw new Error(`Missing scoring label for ${record.case_id}`);
    const efficiency: NonNullable<PredictionRecord["efficiency"]> = {
      latency_ms: record.latency_ms,
      tool_calls: record.tool_calls.length,
      ...(record.tokens.complete
        ? {
            input_tokens: record.tokens.input_tokens,
            output_tokens: record.tokens.output_tokens
          }
        : {})
    };
    return [
      PredictionRecordSchema.parse({
        schema_version: BENCHMARK_SCHEMA_VERSION,
        case_id: record.case_id,
        group_id: record.group_id,
        ...(record.counterfactual_pair_id === undefined
          ? {}
          : { counterfactual_pair_id: record.counterfactual_pair_id }),
        ...(record.style_pair_id === undefined
          ? {}
          : { style_pair_id: record.style_pair_id }),
        gold: {
          reliable: label.reliable,
          primary_failure: label.primary_failure,
          evidence_lines: labelEvidenceLines(label)
        },
        prediction: {
          reliable: record.prediction.reliable,
          primary_failure: record.prediction.primary_failure,
          reliability_score: record.prediction.reliability_score,
          evidence_lines: [
            ...new Set(
              record.evidence.flatMap((item) =>
                item.line_number === null ? [] : [item.line_number]
              )
            )
          ].sort((left, right) => left - right)
        },
        efficiency
      })
    ];
  });
}

function divide(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function counterfactualSummary(
  records: readonly PredictionRecord[]
): CounterfactualPairSummary {
  const grouped = new Map<string, PredictionRecord[]>();
  for (const record of records) {
    if (!record.counterfactual_pair_id) continue;
    grouped.set(record.counterfactual_pair_id, [
      ...(grouped.get(record.counterfactual_pair_id) ?? []),
      record
    ]);
  }
  let eligible = 0;
  let invalid = 0;
  let correct = 0;
  let flips = 0;
  for (const pair of grouped.values()) {
    if (pair.length !== 2 || pair[0].gold.reliable === pair[1].gold.reliable) {
      invalid += 1;
      continue;
    }
    eligible += 1;
    if (
      pair.every(
        (record) => record.gold.reliable === record.prediction.reliable
      )
    ) {
      correct += 1;
    }
    if (pair[0].prediction.reliable !== pair[1].prediction.reliable) flips += 1;
  }
  return {
    eligible_pairs: eligible,
    invalid_pairs: invalid,
    correct_pairs: correct,
    predicted_flip_pairs: flips,
    strict_accuracy: divide(correct, eligible),
    predicted_flip_rate: divide(flips, eligible)
  };
}

function aggregate(values: readonly number[]): RawAggregate | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median:
      sorted.length % 2 === 0
        ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
        : sorted[midpoint],
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    min: sorted[0],
    max: sorted.at(-1) as number
  };
}

function rawEfficiency(records: readonly BenchmarkCaseRecord[]): RawEfficiency {
  const succeeded = records.filter((record) => record.status === "succeeded");
  const completeTokens = succeeded.filter((record) => record.tokens.complete);
  return {
    latency_ms: aggregate(succeeded.map((record) => record.latency_ms)),
    input_tokens: aggregate(
      completeTokens.map((record) => record.tokens.input_tokens)
    ),
    output_tokens: aggregate(
      completeTokens.map((record) => record.tokens.output_tokens)
    ),
    total_tokens: aggregate(
      completeTokens.map((record) => record.tokens.total_tokens)
    ),
    tool_calls: aggregate(
      succeeded.map((record) => record.tool_calls.length)
    )
  };
}

async function summarize(
  manifest: BenchmarkManifest,
  records: readonly BenchmarkCaseRecord[],
  selectedCases: number,
  inputFile: ReturnType<typeof BenchmarkInputFileSchema.parse>,
  options: BenchmarkRunOptions
): Promise<BenchmarkSummary> {
  let scoring: BenchmarkSummary["scoring"] = {
    labels_provided: false,
    label_hash: null,
    scored_records: 0
  };
  let metrics: ReturnType<typeof computeMetrics> | null = null;
  let intervals: ReturnType<typeof bootstrapConfidenceIntervals> | null = null;
  let counterfactual: CounterfactualPairSummary | null = null;

  // The label file is intentionally opened only after every evaluator call is
  // finalized. Nothing derived from this block can enter evaluator inputs.
  if (options.label_path) {
    const labelFile = BenchmarkLabelFileSchema.parse(
      JSON.parse(await readFile(options.label_path, "utf8"))
    );
    const issues = validateInputLabelCoverage(inputFile, labelFile);
    if (issues.length > 0) {
      throw new Error(issues.map((issue) => issue.message).join("; "));
    }
    const joined = predictionRecords(records, labelFile.labels);
    metrics = computeMetrics(joined);
    counterfactual = counterfactualSummary(joined);
    const seed = options.bootstrap?.seed ?? `${manifest.run_id}-bootstrap`;
    intervals = bootstrapConfidenceIntervals(joined, {
      seed,
      ...(options.bootstrap?.iterations === undefined
        ? {}
        : { iterations: options.bootstrap.iterations }),
      ...(options.bootstrap?.confidence_level === undefined
        ? {}
        : { confidence_level: options.bootstrap.confidence_level })
    });
    scoring = {
      labels_provided: true,
      label_hash: computeCanonicalSha256(labelFile),
      scored_records: joined.length
    };
  }

  const succeeded = records.filter((record) => record.status === "succeeded");
  const failed = records.filter((record) => record.status === "failed");
  const pending = inputFile.cases.length - records.length;
  return {
    schema_version: BENCHMARK_RUN_SCHEMA_VERSION,
    run_id: manifest.run_id,
    dataset_id: manifest.dataset_id,
    evaluator_id: manifest.evaluator.id,
    status: failed.length > 0 ? "failed" : pending > 0 ? "partial" : "complete",
    execution: {
      total_cases: inputFile.cases.length,
      selected_cases: selectedCases,
      succeeded: succeeded.length,
      failed: failed.length,
      pending,
      degraded: records.filter((record) => record.degraded).length,
      fallback_records: records.filter((record) => record.fallback.used).length,
      model_calls: records.reduce(
        (sum, record) => sum + record.model_calls.length,
        0
      ),
      tool_calls: records.reduce(
        (sum, record) => sum + record.tool_calls.length,
        0
      )
    },
    classification: metrics?.binary ?? null,
    failure_classes: metrics?.failure_classes ?? null,
    evidence: metrics?.evidence_lines ?? null,
    pair_stability:
      metrics && counterfactual
        ? {
            style_pairs: metrics.style_pairs,
            counterfactual_pairs: counterfactual
          }
        : null,
    efficiency: metrics?.efficiency ?? rawEfficiency(records),
    confidence_intervals: intervals,
    scoring
  };
}

export async function runBenchmark(
  options: BenchmarkRunOptions
): Promise<BenchmarkRunResult> {
  const inputFile = BenchmarkInputFileSchema.parse(
    JSON.parse(await readFile(options.input_path, "utf8"))
  );
  const concurrency = positiveInteger(options.concurrency ?? 4, "concurrency");
  const retry = retryPolicy(options.retry);
  const experimentalMode = options.experimental_mode ?? true;
  const manifest = buildManifest(
    options.input_path,
    inputFile,
    options.evaluator,
    concurrency,
    retry,
    experimentalMode
  );
  const runDirectory = path.join(options.output_directory, manifest.run_id);
  const manifestPath = path.join(runDirectory, "manifest.json");
  const predictionsPath = path.join(runDirectory, "predictions.jsonl");
  const summaryPath = path.join(runDirectory, "summary.json");
  await mkdir(runDirectory, { recursive: true });

  const manifestJson = `${canonicalJson(manifest)}\n`;
  try {
    const existing = await readFile(manifestPath, "utf8");
    if (existing !== manifestJson) {
      throw new Error("Existing manifest does not match this deterministic run");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeAtomic(manifestPath, manifestJson);
  }

  const records = options.resume === false
    ? new Map<string, BenchmarkCaseRecord>()
    : await readExistingRecords(predictionsPath, manifest);
  const retryFailed = options.retry_failed_on_resume ?? false;
  const pending = inputFile.cases.filter((input) => {
    const existing = records.get(input.case_id);
    return !existing || (retryFailed && existing.status === "failed");
  });
  const maxCases =
    options.max_cases === undefined
      ? pending.length
      : Math.max(0, Math.min(pending.length, Math.floor(options.max_cases)));
  const selected = pending.slice(0, maxCases);
  let persist = Promise.resolve();

  await mapConcurrent(selected, concurrency, async (input) => {
    const record = await evaluateCase(
      input,
      options.evaluator,
      manifest,
      retry,
      experimentalMode
    );
    records.set(input.case_id, record);
    persist = persist.then(() =>
      writeAtomic(
        predictionsPath,
        recordJsonl(orderedRecords(inputFile.cases, records))
      )
    );
    await persist;
  });
  await persist;
  if (selected.length === 0 && records.size === 0) {
    await writeAtomic(predictionsPath, "");
  }

  const finalRecords = orderedRecords(inputFile.cases, records);
  const summary = await summarize(
    manifest,
    finalRecords,
    selected.length,
    inputFile,
    options
  );
  await writeAtomic(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    run_id: manifest.run_id,
    run_directory: runDirectory,
    manifest_path: manifestPath,
    predictions_path: predictionsPath,
    summary_path: summaryPath,
    records: finalRecords,
    manifest,
    summary
  };
}
