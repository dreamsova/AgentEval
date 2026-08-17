import type {
  CanonicalTraceEvent,
  JsonValue,
  ProvenanceLevel,
  TraceDiagnostic,
  TraceSourceFormat,
  TraceSourcePointer,
  TraceStatus
} from "./types";

export type AdapterParseResult = {
  events: CanonicalTraceEvent[];
  diagnostics: TraceDiagnostic[];
  lossy: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstDefined(
  record: Record<string, unknown>,
  keys: string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return undefined;
}

export function firstString(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  const value = firstDefined(record, keys);
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

export function sourcePointer(
  format: TraceSourceFormat,
  path: string,
  index?: number,
  rawType?: string
): TraceSourcePointer {
  return {
    format,
    path,
    ...(index === undefined ? {} : { index }),
    ...(rawType ? { raw_type: rawType } : {})
  };
}

export function diagnostic(
  code: string,
  severity: TraceDiagnostic["severity"],
  category: TraceDiagnostic["category"],
  message: string,
  source?: TraceSourcePointer,
  eventIds?: string[]
): TraceDiagnostic {
  return {
    code,
    severity,
    category,
    message,
    ...(source ? { source } : {}),
    ...(eventIds?.length ? { event_ids: eventIds } : {})
  };
}

export function toJsonValue(
  value: unknown,
  diagnostics?: TraceDiagnostic[],
  source?: TraceSourcePointer
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      diagnostics?.push(
        diagnostic(
          "NON_JSON_NUMBER",
          "warning",
          "parsing",
          "A non-finite number was converted to a string.",
          source
        )
      );
      return String(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item, diagnostics, source));
  }

  if (isRecord(value)) {
    const converted: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined && typeof child !== "function" && typeof child !== "symbol") {
        converted[key] = toJsonValue(child, diagnostics, source);
      }
    }
    return converted;
  }

  diagnostics?.push(
    diagnostic(
      "NON_JSON_VALUE",
      "warning",
      "parsing",
      `A ${typeof value} value was converted to a string.`,
      source
    )
  );
  return String(value);
}

export function parseJsonValue(
  value: unknown,
  diagnostics: TraceDiagnostic[],
  source: TraceSourcePointer,
  code = "MALFORMED_JSON_VALUE"
): JsonValue {
  if (typeof value !== "string") {
    return toJsonValue(value ?? null, diagnostics, source);
  }

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }

  try {
    return toJsonValue(JSON.parse(trimmed), diagnostics, source);
  } catch {
    diagnostics.push(
      diagnostic(
        code,
        "warning",
        "parsing",
        "JSON-looking content could not be parsed and was preserved as text.",
        source
      )
    );
    return value;
  }
}

export function normalizeStatus(
  record: Record<string, unknown>,
  fallback: TraceStatus = "unknown"
): TraceStatus {
  if (record.is_error === true || record.error === true || record.success === false) {
    return "failed";
  }
  if (record.success === true || record.ok === true) {
    return "succeeded";
  }

  const raw = firstString(record, ["status", "state"] )?.toLowerCase();
  switch (raw) {
    case "pending":
    case "queued":
      return "pending";
    case "running":
    case "in_progress":
    case "in-progress":
      return "running";
    case "ok":
    case "success":
    case "succeeded":
    case "complete":
    case "completed":
      return "succeeded";
    case "error":
    case "failure":
    case "failed":
    case "incomplete":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return fallback;
  }
}

export function normalizeProvenance(
  record: Record<string, unknown>,
  fallback: ProvenanceLevel
): ProvenanceLevel {
  const raw = firstString(record, ["provenance", "provenance_level"]);
  return raw === "declared" || raw === "recorded" || raw === "verified"
    ? raw
    : fallback;
}

export function eventIdentity(
  record: Record<string, unknown>,
  generated: string
): string {
  return firstString(record, ["event_id", "eventId", "id"]) ?? generated;
}

export function eventSequence(
  record: Record<string, unknown>,
  generated: number,
  diagnostics: TraceDiagnostic[],
  source: TraceSourcePointer
): number {
  const value = firstDefined(record, ["sequence", "seq", "index"]);
  if (value === undefined) {
    return generated;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  diagnostics.push(
    diagnostic(
      "INVALID_SEQUENCE",
      "warning",
      "validation",
      `Invalid sequence value was replaced with ${generated}.`,
      source
    )
  );
  return generated;
}

export function eventTimestamp(
  record: Record<string, unknown>,
  diagnostics: TraceDiagnostic[],
  source: TraceSourcePointer,
  inherited?: string | number
): string | number | undefined {
  const value = firstDefined(record, [
    "timestamp",
    "time",
    "created_at",
    "createdAt"
  ]) ?? inherited;

  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  if (value !== undefined) {
    diagnostics.push(
      diagnostic(
        "INVALID_TIMESTAMP",
        "warning",
        "validation",
        "Invalid timestamp was omitted.",
        source
      )
    );
  }
  return undefined;
}

export function commonEventFields(
  record: Record<string, unknown>,
  options: {
    format: TraceSourceFormat;
    path: string;
    index: number;
    generatedId: string;
    fallbackProvenance: ProvenanceLevel;
    diagnostics: TraceDiagnostic[];
    rawType?: string;
    inheritedTimestamp?: string | number;
  }
) {
  const source = sourcePointer(
    options.format,
    options.path,
    options.index,
    options.rawType
  );
  const timestamp = eventTimestamp(
    record,
    options.diagnostics,
    source,
    options.inheritedTimestamp
  );
  const callId = firstString(record, [
    "call_id",
    "callId",
    "tool_call_id",
    "toolCallId",
    "invocation_id"
  ]);
  const parentId = firstString(record, [
    "parent_id",
    "parentId",
    "parent_event_id",
    "previous_response_id"
  ]);

  return {
    event_id: eventIdentity(record, options.generatedId),
    sequence: eventSequence(
      record,
      options.index,
      options.diagnostics,
      source
    ),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(callId ? { call_id: callId } : {}),
    ...(parentId ? { parent_id: parentId } : {}),
    source,
    status: normalizeStatus(record),
    provenance: normalizeProvenance(record, options.fallbackProvenance)
  };
}

export function normalizeRole(
  value: unknown
): "user" | "assistant" | "system" | "tool" | "unknown" {
  if (value === "agent") {
    return "assistant";
  }
  return value === "user" ||
    value === "assistant" ||
    value === "system" ||
    value === "tool"
    ? value
    : "unknown";
}
