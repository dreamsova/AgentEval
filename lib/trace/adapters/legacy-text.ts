import type {
  ArtifactTraceEvent,
  CanonicalTraceEvent,
  ErrorTraceEvent,
  MessageTraceEvent,
  StateChangeTraceEvent,
  ToolCallTraceEvent,
  ToolResultTraceEvent,
  TraceDiagnostic,
  TraceSourcePointer,
  TraceStatus
} from "../types";
import {
  type AdapterParseResult,
  diagnostic,
  parseJsonValue
} from "../internal";

const headerPattern = /^\s*(?:\[([^\]]+)\]\s*)?(user|agent|assistant|system|tool(?:\s+(?:call|result))?|artifact|error|state(?:_change)?)\s*:\s*(.*)$/i;
const failurePattern = /\b(?:error|failed|failure|exception|cancelled|canceled|exit[_ ]?code\s*[=:]?\s*[1-9]\d*)\b/i;
const successPattern = /\b(?:ok|success|succeeded|completed|exit[_ ]?code\s*[=:]?\s*0)\b/i;
const resultPrefixPattern = /^(?:result|output|returned|success|succeeded|failed|failure|error)\b/i;

function metadataValue(content: string, names: string[]): string | undefined {
  const escaped = names.map((name) => name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
  const pattern = new RegExp(
    `\\b(?:${escaped.join("|")})\\s*[=:]\\s*["']?([A-Za-z0-9_.:/-]+)`,
    "i"
  );
  return content.match(pattern)?.[1];
}

function legacyStatus(content: string, fallback: TraceStatus): TraceStatus {
  if (failurePattern.test(content)) {
    return content.match(/\b(?:cancelled|canceled)\b/i) ? "cancelled" : "failed";
  }
  return successPattern.test(content) ? "succeeded" : fallback;
}

function legacyBase(
  line: number,
  sequence: number,
  type: CanonicalTraceEvent["type"],
  content: string,
  timestamp?: string
) {
  const source: TraceSourcePointer = {
    format: "legacy_text",
    path: `$line[${line}]`,
    line,
    index: sequence,
    raw_type: type
  };
  const eventId =
    metadataValue(content, ["event_id", "event-id"]) ??
    `legacy:${line}:${type}`;
  const callId = metadataValue(content, [
    "call_id",
    "call-id",
    "tool_call_id",
    "tool-call-id"
  ]);
  const parentId = metadataValue(content, [
    "parent_id",
    "parent-id",
    "parent_event_id"
  ]);

  return {
    event_id: eventId,
    sequence,
    ...(timestamp ? { timestamp } : {}),
    ...(callId ? { call_id: callId } : {}),
    ...(parentId ? { parent_id: parentId } : {}),
    source,
    status: "unknown" as TraceStatus,
    provenance: "declared" as const
  };
}

function toolName(content: string): string {
  return (
    metadataValue(content, ["tool", "name"]) ??
    content
      .replace(/^call\s+/i, "")
      .match(/^([A-Za-z0-9_.:/-]+)/)?.[1] ??
    "unknown_tool"
  );
}

function argumentsValue(
  content: string,
  diagnostics: TraceDiagnostic[],
  source: TraceSourcePointer
) {
  const match = content.match(/\b(?:arguments|args|input)\s*[=:]\s*(.+)$/i);
  if (match) {
    return parseJsonValue(
      match[1],
      diagnostics,
      source,
      "MALFORMED_TOOL_ARGUMENTS"
    );
  }
  const name = toolName(content);
  const remainder = content.slice(content.indexOf(name) + name.length).trim();
  return remainder || content;
}

function resultValue(
  content: string,
  diagnostics: TraceDiagnostic[],
  source: TraceSourcePointer
) {
  const match = content.match(/\b(?:result|output|value)\s*[=:]\s*(.+)$/i);
  return parseJsonValue(
    match?.[1] ?? content,
    diagnostics,
    source,
    "MALFORMED_TOOL_RESULT"
  );
}

export function parseLegacyText(input: string): AdapterParseResult {
  const diagnostics: TraceDiagnostic[] = [];
  const events: CanonicalTraceEvent[] = [];
  let currentRole: MessageTraceEvent["role"] = "unknown";
  let lossy = false;

  input.split(/\r?\n/).forEach((rawLine, rawIndex) => {
    if (!rawLine.trim()) {
      return;
    }

    const line = rawIndex + 1;
    const match = rawLine.match(headerPattern);
    const timestamp = match?.[1];
    const header = match?.[2]?.toLowerCase();
    const content = (match?.[3] ?? rawLine).trim();
    const sequence = events.length;

    if (
      header === "user" ||
      header === "agent" ||
      header === "assistant" ||
      header === "system"
    ) {
      currentRole =
        header === "agent" ? "assistant" : (header as MessageTraceEvent["role"]);
      const event: MessageTraceEvent = {
        ...legacyBase(line, sequence, "message", content, timestamp),
        type: "message",
        role: currentRole,
        content
      };
      events.push(event);
      return;
    }

    const isToolHeader = header?.startsWith("tool");
    if (isToolHeader) {
      const isResult =
        header === "tool result" ||
        (header === "tool" && resultPrefixPattern.test(content));
      if (isResult) {
        const base = legacyBase(line, sequence, "tool_result", content, timestamp);
        const previous = events.at(-1);
        let inferredCallId: string | undefined;
        if (!base.call_id && previous?.type === "tool_call") {
          inferredCallId = previous.call_id ?? `legacy-call:${previous.source.line}`;
          previous.call_id = inferredCallId;
          diagnostics.push(
            diagnostic(
              "INFERRED_CALL_LINK",
              "warning",
              "parsing",
              "Adjacent legacy call/result lines were linked with a synthetic call_id.",
              base.source,
              [previous.event_id, base.event_id]
            )
          );
          lossy = true;
        }
        const event: ToolResultTraceEvent = {
          ...base,
          ...(inferredCallId ? { call_id: inferredCallId } : {}),
          status: legacyStatus(content, "unknown"),
          type: "tool_result",
          ...(metadataValue(content, ["tool", "name"])
            ? { tool_name: metadataValue(content, ["tool", "name"]) }
            : {}),
          result: resultValue(content, diagnostics, base.source)
        };
        events.push(event);
        return;
      }

      const base = legacyBase(line, sequence, "tool_call", content, timestamp);
      const event: ToolCallTraceEvent = {
        ...base,
        status: legacyStatus(content, "pending"),
        type: "tool_call",
        tool_name: toolName(content),
        arguments: argumentsValue(content, diagnostics, base.source)
      };
      events.push(event);
      return;
    }

    if (header === "artifact") {
      const base = legacyBase(line, sequence, "artifact", content, timestamp);
      const event: ArtifactTraceEvent = {
        ...base,
        status: legacyStatus(content, "unknown"),
        type: "artifact",
        ...(metadataValue(content, ["name", "filename"])
          ? { name: metadataValue(content, ["name", "filename"]) }
          : {}),
        ...(metadataValue(content, ["uri", "url", "path"])
          ? { uri: metadataValue(content, ["uri", "url", "path"]) }
          : {}),
        data: content
      };
      events.push(event);
      return;
    }

    if (header === "error") {
      const event: ErrorTraceEvent = {
        ...legacyBase(line, sequence, "error", content, timestamp),
        status: "failed",
        type: "error",
        error: {
          message: content,
          ...(metadataValue(content, ["code"])
            ? { code: metadataValue(content, ["code"]) }
            : {})
        }
      };
      events.push(event);
      return;
    }

    if (header === "state" || header === "state_change") {
      const base = legacyBase(line, sequence, "state_change", content, timestamp);
      const parsed = parseJsonValue(content, diagnostics, base.source);
      const event: StateChangeTraceEvent = {
        ...base,
        type: "state_change",
        state: { value: parsed }
      };
      events.push(event);
      return;
    }

    const event: MessageTraceEvent = {
      ...legacyBase(line, sequence, "message", content, timestamp),
      type: "message",
      role: currentRole,
      content
    };
    events.push(event);
  });

  if (!events.length) {
    diagnostics.push(
      diagnostic(
        "EMPTY_TRACE",
        "warning",
        "parsing",
        "Legacy trace contains no non-empty events.",
        { format: "legacy_text", path: "$" }
      )
    );
  }

  return { events, diagnostics, lossy };
}
