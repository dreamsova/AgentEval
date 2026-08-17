import { createHash } from "node:crypto";

import {
  formatTraceForEvaluation,
  normalizeTrace,
  type NormalizeTraceOptions,
  type NormalizedTrace
} from "@/lib/trace";

export type PreparedEvaluationTrace = {
  normalized_trace: NormalizedTrace;
  safe_text: string;
  input_hash: string;
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map(
      (key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )
    .join(",")}}`;
}

export function hashNormalizedTrace(trace: NormalizedTrace): string {
  const canonicalHashPayload = {
    schema_version: trace.schema_version,
    adapter_version: trace.adapter_version,
    source_format: trace.source_format,
    events: trace.events,
    call_pairs: trace.call_pairs,
    orphan_result_event_ids: trace.orphan_result_event_ids,
    lossy: trace.lossy
  };
  const digest = createHash("sha256")
    .update(stableSerialize(canonicalHashPayload))
    .digest("hex");
  return `sha256:${digest}`;
}

/** Normalizes and redacts exactly once, then derives all downstream views. */
export function prepareEvaluationTrace(
  input: unknown,
  options: Omit<NormalizeTraceOptions, "redact"> = {}
): PreparedEvaluationTrace {
  const normalizedTrace = normalizeTrace(input, { ...options, redact: true });
  return {
    normalized_trace: normalizedTrace,
    safe_text: formatTraceForEvaluation(normalizedTrace, { redact: false }),
    input_hash: hashNormalizedTrace(normalizedTrace)
  };
}
