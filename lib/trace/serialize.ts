import type {
  CanonicalTraceEvent,
  JsonValue,
  NormalizedTrace
} from "./types";
import { redactTrace } from "./redaction";

function json(value: JsonValue | undefined): string {
  return JSON.stringify(value ?? null);
}

function eventText(event: CanonicalTraceEvent): string {
  const identity = [
    `sequence=${event.sequence}`,
    `event_id=${event.event_id}`,
    event.call_id ? `call_id=${event.call_id}` : null,
    event.parent_id ? `parent_id=${event.parent_id}` : null,
    `status=${event.status}`,
    `provenance=${event.provenance}`
  ]
    .filter(Boolean)
    .join(" ");

  switch (event.type) {
    case "message":
      return `${event.role}: ${json(event.content)} (${identity})`;
    case "tool_call":
      return `Tool: call ${event.tool_name} arguments=${json(event.arguments)} (${identity})`;
    case "tool_result":
      return `Tool: result${event.tool_name ? ` ${event.tool_name}` : ""} result=${json(event.result)} (${identity})`;
    case "artifact":
      return `Artifact: name=${event.name ?? "unknown"} uri=${event.uri ?? "unknown"} data=${json(event.data)} (${identity})`;
    case "error":
      return `Error: ${event.error.message} code=${event.error.code ?? "unknown"} (${identity})`;
    case "state_change":
      return `State: ${json(event.state)} (${identity})`;
  }
}

/**
 * Produces line-oriented evaluator input while retaining exact event identities.
 * Redaction is on by default so callers cannot accidentally send raw secrets.
 */
export function formatTraceForEvaluation(
  trace: NormalizedTrace,
  options: { redact?: boolean } = {}
): string {
  const safeTrace = options.redact === false ? trace : redactTrace(trace);
  return safeTrace.events
    .map((event) => eventText(event))
    .join("\n");
}

/** Redacts by default for persistence and transport. */
export function serializeNormalizedTrace(
  trace: NormalizedTrace,
  options: { redact?: boolean; space?: number } = {}
): string {
  const safeTrace = options.redact === false ? trace : redactTrace(trace);
  return JSON.stringify(safeTrace, null, options.space);
}
