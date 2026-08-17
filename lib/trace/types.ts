export const TRACE_SCHEMA_VERSION = "1.0.0" as const;
export const TRACE_ADAPTER_VERSION = "1.0.0" as const;

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TraceEventType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "artifact"
  | "error"
  | "state_change";

export type TraceStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

/**
 * declared: asserted in prose or supplied without execution evidence.
 * recorded: emitted by a structured runtime or tool transport.
 * verified: independently checked by a trusted verifier.
 */
export type ProvenanceLevel = "declared" | "recorded" | "verified";

export type TraceSourceFormat =
  | "legacy_text"
  | "generic_json"
  | "openai_responses";

export type TraceSourcePointer = {
  format: TraceSourceFormat;
  path?: string;
  line?: number;
  index?: number;
  raw_type?: string;
};

export type TraceEventBase = {
  event_id: string;
  sequence: number;
  timestamp?: string | number;
  call_id?: string;
  parent_id?: string;
  source: TraceSourcePointer;
  status: TraceStatus;
  provenance: ProvenanceLevel;
};

export type MessageTraceEvent = TraceEventBase & {
  type: "message";
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  content: JsonValue;
};

export type ToolCallTraceEvent = TraceEventBase & {
  type: "tool_call";
  tool_name: string;
  arguments: JsonValue;
};

export type ToolResultTraceEvent = TraceEventBase & {
  type: "tool_result";
  tool_name?: string;
  result: JsonValue;
};

export type ArtifactTraceEvent = TraceEventBase & {
  type: "artifact";
  name?: string;
  uri?: string;
  mime_type?: string;
  operation?: string;
  data?: JsonValue;
};

export type ErrorTraceEvent = TraceEventBase & {
  type: "error";
  error: {
    message: string;
    code?: string;
    details?: JsonValue;
  };
};

export type StateChangeTraceEvent = TraceEventBase & {
  type: "state_change";
  state: {
    name?: string;
    from?: JsonValue;
    to?: JsonValue;
    value?: JsonValue;
  };
};

export type CanonicalTraceEvent =
  | MessageTraceEvent
  | ToolCallTraceEvent
  | ToolResultTraceEvent
  | ArtifactTraceEvent
  | ErrorTraceEvent
  | StateChangeTraceEvent;

export type TraceDiagnosticSeverity = "info" | "warning" | "error";

export type TraceDiagnosticCategory =
  | "parsing"
  | "validation"
  | "pairing"
  | "redaction";

export type TraceDiagnostic = {
  code: string;
  severity: TraceDiagnosticSeverity;
  category: TraceDiagnosticCategory;
  message: string;
  source?: TraceSourcePointer;
  event_ids?: string[];
};

export type TraceCallPair = {
  pair_id: string;
  call_id: string | null;
  call_event_id: string;
  result_event_id: string | null;
  status: TraceStatus;
  provenance: ProvenanceLevel;
};

export type TraceRedactionSummary = {
  applied: boolean;
  count: number;
};

export type NormalizedTrace = {
  schema_version: typeof TRACE_SCHEMA_VERSION;
  adapter_version: typeof TRACE_ADAPTER_VERSION;
  source_format: TraceSourceFormat;
  events: CanonicalTraceEvent[];
  call_pairs: TraceCallPair[];
  orphan_result_event_ids: string[];
  diagnostics: TraceDiagnostic[];
  /** True only when parsing discarded or inferred information. */
  lossy: boolean;
  redaction: TraceRedactionSummary;
};

export type TraceAdapterOptions = {
  /** Redaction is enabled by default for every public adapter. */
  redact?: boolean;
};

export type NormalizeTraceOptions = TraceAdapterOptions & {
  format?: "auto" | TraceSourceFormat;
};
