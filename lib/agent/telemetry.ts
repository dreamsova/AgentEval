import { randomUUID } from "node:crypto";

import type { PreparedEvaluationTrace } from "@/lib/evaluation-input";
import type {
  EvaluationFallbackPolicy,
  EvaluationRunMetadata,
  ModelCallTelemetry
} from "@/lib/types";
import {
  EVALUATION_PROMPT_VERSION,
  EVALUATION_RUBRIC_VERSION,
  EVALUATION_TOOLSET_VERSION,
  EVALUATION_WEIGHTS_VERSION
} from "./versions";

export type RunTelemetryContext = {
  run_id: string;
  input_hash: string;
  trace_schema_version: string;
  trace_adapter_version: string;
  trace_source_format: string;
  trace_lossy: boolean;
  requested_model: string | null;
  fallback_policy: EvaluationFallbackPolicy;
  started_at_ms: number;
  model_calls: ModelCallTelemetry[];
  total_tool_time_ms: number;
  tool_calls: number;
};

export function fallbackPolicyForMode(
  mode: "founder-demo" | "research-eval" | "ops-reliability"
): EvaluationFallbackPolicy {
  return mode === "founder-demo"
    ? "demo-continuity"
    : "strict-no-fallback";
}

export function createRunTelemetry(
  prepared: PreparedEvaluationTrace,
  options: {
    requestedModel?: string | null;
    fallbackPolicy: EvaluationFallbackPolicy;
  }
): RunTelemetryContext {
  return {
    run_id: randomUUID(),
    input_hash: prepared.input_hash,
    trace_schema_version: prepared.normalized_trace.schema_version,
    trace_adapter_version: prepared.normalized_trace.adapter_version,
    trace_source_format: prepared.normalized_trace.source_format,
    trace_lossy:
      prepared.normalized_trace.lossy ||
      prepared.normalized_trace.source_format === "legacy_text",
    requested_model: options.requestedModel ?? null,
    fallback_policy: options.fallbackPolicy,
    started_at_ms: Date.now(),
    model_calls: [],
    total_tool_time_ms: 0,
    tool_calls: 0
  };
}

export function recordModelCall(
  context: RunTelemetryContext,
  call: Omit<ModelCallTelemetry, "index">
) {
  context.model_calls.push({
    ...call,
    index: context.model_calls.length + 1
  });
}

export function recordToolCall(
  context: RunTelemetryContext,
  durationMs: number
) {
  context.tool_calls += 1;
  context.total_tool_time_ms += durationMs;
}

export function buildRunMetadata(
  context: RunTelemetryContext,
  options: {
    degraded: boolean;
    degradationReason?: string | null;
    fallbackReason?: string | null;
  }
): EvaluationRunMetadata {
  const usageComplete = context.model_calls.every(
    (call) =>
      call.input_tokens !== null &&
      call.output_tokens !== null &&
      call.total_tokens !== null
  );
  const returnedModels = context.model_calls
    .map((call) => call.returned_model)
    .filter((model): model is string => Boolean(model));

  return {
    run_id: context.run_id,
    input_hash: context.input_hash,
    trace_schema_version: context.trace_schema_version,
    trace_adapter_version: context.trace_adapter_version,
    trace_source_format: context.trace_source_format,
    trace_lossy: context.trace_lossy,
    prompt_version: EVALUATION_PROMPT_VERSION,
    toolset_version: EVALUATION_TOOLSET_VERSION,
    rubric_version: EVALUATION_RUBRIC_VERSION,
    weights_version: EVALUATION_WEIGHTS_VERSION,
    requested_model: context.requested_model,
    returned_model: returnedModels.at(-1) ?? null,
    model_calls: [...context.model_calls],
    token_usage: {
      input_tokens: context.model_calls.reduce(
        (sum, call) => sum + (call.input_tokens ?? 0),
        0
      ),
      output_tokens: context.model_calls.reduce(
        (sum, call) => sum + (call.output_tokens ?? 0),
        0
      ),
      total_tokens: context.model_calls.reduce(
        (sum, call) => sum + (call.total_tokens ?? 0),
        0
      ),
      complete: usageComplete
    },
    total_model_time_ms: context.model_calls.reduce(
      (sum, call) => sum + call.latency_ms,
      0
    ),
    total_tool_time_ms: context.total_tool_time_ms,
    total_wall_time_ms: Math.max(0, Date.now() - context.started_at_ms),
    calls: {
      model: context.model_calls.length,
      tool: context.tool_calls
    },
    fallback_policy: context.fallback_policy,
    fallback_reason: options.fallbackReason ?? null,
    degraded: options.degraded,
    degradation_reason: options.degradationReason ?? null
  };
}
