import { z } from "zod";

import {
  TRACE_ADAPTER_VERSION,
  TRACE_SCHEMA_VERSION
} from "./types";

export const traceEventTypeSchema = z.enum([
  "message",
  "tool_call",
  "tool_result",
  "artifact",
  "error",
  "state_change"
]);

export const traceStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "unknown"
]);

export const provenanceLevelSchema = z.enum([
  "declared",
  "recorded",
  "verified"
]);

export const traceSourceFormatSchema = z.enum([
  "legacy_text",
  "generic_json",
  "openai_responses"
]);

export const traceSourcePointerSchema = z
  .object({
    format: traceSourceFormatSchema,
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
    index: z.number().int().nonnegative().optional(),
    raw_type: z.string().optional()
  })
  .strict();

const eventBase = {
  event_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  call_id: z.string().min(1).optional(),
  parent_id: z.string().min(1).optional(),
  source: traceSourcePointerSchema,
  status: traceStatusSchema,
  provenance: provenanceLevelSchema
};

export const messageTraceEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("message"),
    role: z.enum(["user", "assistant", "system", "tool", "unknown"]),
    content: z.unknown()
  })
  .strict();

export const toolCallTraceEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("tool_call"),
    tool_name: z.string().min(1),
    arguments: z.unknown()
  })
  .strict();

export const toolResultTraceEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("tool_result"),
    tool_name: z.string().min(1).optional(),
    result: z.unknown()
  })
  .strict();

export const artifactTraceEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("artifact"),
    name: z.string().optional(),
    uri: z.string().optional(),
    mime_type: z.string().optional(),
    operation: z.string().optional(),
    data: z.unknown().optional()
  })
  .strict();

export const errorTraceEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("error"),
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional()
      })
      .strict()
  })
  .strict();

export const stateChangeTraceEventSchema = z
  .object({
    ...eventBase,
    type: z.literal("state_change"),
    state: z
      .object({
        name: z.string().optional(),
        from: z.unknown().optional(),
        to: z.unknown().optional(),
        value: z.unknown().optional()
      })
      .strict()
  })
  .strict();

export const canonicalTraceEventSchema = z.discriminatedUnion("type", [
  messageTraceEventSchema,
  toolCallTraceEventSchema,
  toolResultTraceEventSchema,
  artifactTraceEventSchema,
  errorTraceEventSchema,
  stateChangeTraceEventSchema
]);

export const traceDiagnosticSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(["info", "warning", "error"]),
    category: z.enum(["parsing", "validation", "pairing", "redaction"]),
    message: z.string().min(1),
    source: traceSourcePointerSchema.optional(),
    event_ids: z.array(z.string()).optional()
  })
  .strict();

export const traceCallPairSchema = z
  .object({
    pair_id: z.string().min(1),
    call_id: z.string().nullable(),
    call_event_id: z.string().min(1),
    result_event_id: z.string().min(1).nullable(),
    status: traceStatusSchema,
    provenance: provenanceLevelSchema
  })
  .strict();

export const normalizedTraceSchema = z
  .object({
    schema_version: z.literal(TRACE_SCHEMA_VERSION),
    adapter_version: z.literal(TRACE_ADAPTER_VERSION),
    source_format: traceSourceFormatSchema,
    events: z.array(canonicalTraceEventSchema),
    call_pairs: z.array(traceCallPairSchema),
    orphan_result_event_ids: z.array(z.string()),
    diagnostics: z.array(traceDiagnosticSchema),
    lossy: z.boolean(),
    redaction: z
      .object({
        applied: z.boolean(),
        count: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict()
  .superRefine((trace, context) => {
    const eventIds = new Set<string>();
    for (const event of trace.events) {
      if (eventIds.has(event.event_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate event_id: ${event.event_id}`,
          path: ["events"]
        });
      }
      eventIds.add(event.event_id);
    }

    const callEventIds = new Set(
      trace.events
        .filter((event) => event.type === "tool_call")
        .map((event) => event.event_id)
    );
    const resultEventIds = new Set(
      trace.events
        .filter((event) => event.type === "tool_result")
        .map((event) => event.event_id)
    );
    trace.call_pairs.forEach((pair, index) => {
      if (!callEventIds.has(pair.call_event_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "call_event_id must refer to a tool_call event.",
          path: ["call_pairs", index, "call_event_id"]
        });
      }
      if (
        pair.result_event_id !== null &&
        !resultEventIds.has(pair.result_event_id)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "result_event_id must refer to a tool_result event.",
          path: ["call_pairs", index, "result_event_id"]
        });
      }
    });
    trace.orphan_result_event_ids.forEach((eventId, index) => {
      if (!resultEventIds.has(eventId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Orphan ID must refer to a tool_result event.",
          path: ["orphan_result_event_ids", index]
        });
      }
    });
  });
