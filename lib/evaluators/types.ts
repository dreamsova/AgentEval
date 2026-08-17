import type { BenchmarkInput, FailureLabel } from "@/evals/v1/schema";

export const BENCHMARK_RUN_SCHEMA_VERSION = "1.0.0" as const;

export type BenchmarkEngine = "heuristic" | "llm" | "agent" | "fake";

export type EvaluatorPrediction = {
  reliable: boolean;
  primary_failure: FailureLabel | null;
  reliability_score: number;
};

export type EvaluatorEvidence = {
  line_number: number | null;
  quote: string;
  reason: string;
};

export type EvaluatorModelCall = {
  index: number;
  purpose: "diagnostic" | "final_synthesis";
  status: "succeeded" | "failed";
  requested_model: string;
  returned_model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export type EvaluatorToolCall = {
  index: number;
  name: string;
  status: "succeeded" | "failed";
  latency_ms: number;
  observation: string;
};

export type EvaluatorError = {
  code: string;
  name: string;
  message: string;
  retryable: boolean;
  attempt?: number;
};

export type EvaluatorTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  complete: boolean;
};

export type EvaluatorFallback = {
  used: boolean;
  engine: BenchmarkEngine | null;
  reason: string | null;
};

export type EvaluatorResult = {
  engine: BenchmarkEngine;
  prediction: EvaluatorPrediction;
  evidence: EvaluatorEvidence[];
  requested_model: string | null;
  returned_model: string | null;
  model_calls: EvaluatorModelCall[];
  tool_calls: EvaluatorToolCall[];
  tokens: EvaluatorTokenUsage;
  latency_ms: number;
  errors: EvaluatorError[];
  degraded: boolean;
  degradation_reason: string | null;
  fallback: EvaluatorFallback;
};

/**
 * This is deliberately the public input-only half of Benchmark v1. Labels are
 * never present in evaluator arguments and are joined later by the runner.
 */
export type BenchmarkEvaluatorInput = Readonly<BenchmarkInput>;

export type EvaluatorDescriptor = {
  id: string;
  version: string;
  engine: BenchmarkEngine;
  prompt_version: string;
  prompt: string;
  toolset_version: string;
  toolset: readonly string[];
  requested_model: string | null;
  provider: string | null;
};

export type EvaluatorContext = {
  run_id: string;
  attempt: number;
};

export interface BenchmarkEvaluator {
  readonly descriptor: EvaluatorDescriptor;
  evaluate(
    input: BenchmarkEvaluatorInput,
    context: EvaluatorContext
  ): Promise<EvaluatorResult>;
}

export type JudgePrediction = {
  reliable: boolean;
  primary_failure: FailureLabel | null;
  reliability_score: number;
  evidence: EvaluatorEvidence[];
};

export type JudgeRequest = {
  model: string;
  system_prompt: string;
  user_prompt: string;
  purpose: "final_synthesis";
};

export type JudgeResponse = {
  prediction: JudgePrediction;
  requested_model: string;
  returned_model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export interface JudgeProvider {
  readonly id: string;
  judge(request: JudgeRequest): Promise<JudgeResponse>;
}

export type BenchmarkCaseRecord = {
  schema_version: typeof BENCHMARK_RUN_SCHEMA_VERSION;
  run_id: string;
  case_id: string;
  split: BenchmarkInput["split"];
  group_id: string;
  counterfactual_pair_id?: string;
  style_pair_id?: string;
  status: "succeeded" | "failed";
  attempts: number;
  dataset_id: string;
  evaluator_id: string;
  evaluator_version: string;
  input_hash: string;
  dataset_hash: string;
  evaluator_hash: string;
  prompt_hash: string;
  toolset_hash: string;
  requested_model: string | null;
  returned_model: string | null;
  engine: BenchmarkEngine;
  prediction: EvaluatorPrediction | null;
  evidence: EvaluatorEvidence[];
  model_calls: EvaluatorModelCall[];
  tool_calls: EvaluatorToolCall[];
  tokens: EvaluatorTokenUsage;
  latency_ms: number;
  errors: EvaluatorError[];
  degraded: boolean;
  degradation_reason: string | null;
  fallback: EvaluatorFallback;
};
