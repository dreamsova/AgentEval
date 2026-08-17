import type {
  ArtifactTraceEvent,
  CanonicalTraceEvent,
  ErrorTraceEvent,
  MessageTraceEvent,
  StateChangeTraceEvent,
  ToolCallTraceEvent,
  ToolResultTraceEvent,
  TraceDiagnostic
} from "../types";
import {
  type AdapterParseResult,
  commonEventFields,
  diagnostic,
  firstDefined,
  firstString,
  isRecord,
  normalizeRole,
  normalizeStatus,
  parseJsonValue,
  sourcePointer,
  toJsonValue
} from "../internal";

type GenericParseContext = {
  diagnostics: TraceDiagnostic[];
  nextSequence: number;
  lossy: boolean;
};

function normalizedType(record: Record<string, unknown>): string {
  return (firstString(record, ["type", "kind", "event", "event_type"]) ?? "")
    .toLowerCase()
    .replace(/[.\s-]+/g, "_");
}

function parseMessageBlocks(
  record: Record<string, unknown>,
  path: string,
  context: GenericParseContext
): CanonicalTraceEvent[] | null {
  const content = record.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const structuredBlocks = content.filter(
    (block) =>
      isRecord(block) &&
      ["tool_use", "tool_call", "tool_result"].includes(
        normalizedType(block)
      )
  );
  if (!structuredBlocks.length) {
    return null;
  }

  const events: CanonicalTraceEvent[] = [];
  const textBlocks = content.filter(
    (block) => !structuredBlocks.includes(block as Record<string, unknown>)
  );
  if (textBlocks.length) {
    events.push(
      ...parseGenericEvent(
        { ...record, content: textBlocks },
        `${path}.content[text]`,
        context
      )
    );
  }
  content.forEach((block, blockIndex) => {
    if (isRecord(block) && structuredBlocks.includes(block)) {
      events.push(
        ...parseGenericEvent(
          block,
          `${path}.content[${blockIndex}]`,
          context
        )
      );
    }
  });
  return events;
}

function parseNestedToolCalls(
  record: Record<string, unknown>,
  path: string,
  context: GenericParseContext
): CanonicalTraceEvent[] {
  const rawToolCalls = firstDefined(record, ["tool_calls", "toolCalls"]);
  const singleFunctionCall = isRecord(record.function_call)
    ? record.function_call
    : undefined;
  const toolCalls = Array.isArray(rawToolCalls)
    ? rawToolCalls
    : singleFunctionCall
      ? [singleFunctionCall]
      : undefined;
  if (!toolCalls) {
    return [];
  }

  const events: CanonicalTraceEvent[] = [];
  toolCalls.forEach((call, callIndex) => {
    const pointer = sourcePointer(
      "generic_json",
      `${path}.tool_calls[${callIndex}]`,
      context.nextSequence,
      "tool_call"
    );
    if (!isRecord(call)) {
      context.diagnostics.push(
        diagnostic(
          "MALFORMED_EVENT",
          "error",
          "parsing",
          "Nested tool call must be an object.",
          pointer
        )
      );
      context.lossy = true;
      return;
    }

    const callId = firstString(call, ["call_id", "tool_call_id", "id"]);
    events.push(
      ...parseGenericEvent(
        {
          ...call,
          type: "tool_call",
          ...(callId ? { call_id: callId } : {})
        },
        `${path}.tool_calls[${callIndex}]`,
        context
      )
    );
  });
  return events;
}

function parseGenericEvent(
  record: Record<string, unknown>,
  path: string,
  context: GenericParseContext
): CanonicalTraceEvent[] {
  const type = normalizedType(record);
  const index = context.nextSequence;
  const rawType = type || (typeof record.role === "string" ? "message" : "unknown");
  const common = commonEventFields(record, {
    format: "generic_json",
    path,
    index,
    generatedId: `generic:${index}`,
    fallbackProvenance: "recorded",
    diagnostics: context.diagnostics,
    rawType
  });
  const source = common.source;
  const isToolResultType =
    type === "tool_result" ||
    type === "function_result" ||
    type === "function_call_output" ||
    type === "tool_output" ||
    type.endsWith("_call_output");
  const isToolCallType =
    type === "tool_call" ||
    type === "function_call" ||
    type === "tool_use" ||
    type === "function" ||
    type.endsWith("_call");

  if (isToolCallType && !isToolResultType) {
    const functionObject = isRecord(record.function) ? record.function : undefined;
    const derivedToolName = type.endsWith("_call")
      ? type.slice(0, -"_call".length)
      : undefined;
    const toolName =
      firstString(record, ["tool_name", "name"]) ??
      (functionObject ? firstString(functionObject, ["name"]) : undefined) ??
      derivedToolName;
    const rawArguments =
      firstDefined(record, [
        "arguments",
        "args",
        "input",
        "parameters",
        "action"
      ]) ??
      (functionObject
        ? firstDefined(functionObject, ["arguments", "args", "input"])
        : undefined) ??
      null;
    const callId =
      common.call_id ?? firstString(record, ["tool_use_id", "id"]);

    if (!toolName) {
      context.diagnostics.push(
        diagnostic(
          "MALFORMED_TOOL_CALL",
          "error",
          "parsing",
          "Tool call is missing a tool name.",
          source,
          [common.event_id]
        )
      );
      context.lossy = true;
    }

    context.nextSequence += 1;
    const event: ToolCallTraceEvent = {
      ...common,
      ...(callId ? { call_id: callId } : {}),
      status: normalizeStatus(record, "pending"),
      type: "tool_call",
      tool_name: toolName ?? "unknown_tool",
      arguments: parseJsonValue(
        rawArguments,
        context.diagnostics,
        source,
        "MALFORMED_TOOL_ARGUMENTS"
      )
    };
    return [event];
  }

  if (isToolResultType) {
    const callId =
      common.call_id ??
      firstString(record, ["tool_use_id", "function_call_id"]);
    const rawResult =
      firstDefined(record, ["result", "output", "content", "value", "data"]) ??
      null;
    context.nextSequence += 1;
    const event: ToolResultTraceEvent = {
      ...common,
      ...(callId ? { call_id: callId } : {}),
      status: normalizeStatus(record, "unknown"),
      type: "tool_result",
      ...(firstString(record, ["tool_name", "name"])
        ? { tool_name: firstString(record, ["tool_name", "name"]) }
        : {}),
      result: parseJsonValue(
        rawResult,
        context.diagnostics,
        source,
        "MALFORMED_TOOL_RESULT"
      )
    };
    return [event];
  }

  if (type === "artifact" || type === "file" || type === "attachment") {
    context.nextSequence += 1;
    const data = firstDefined(record, ["data", "content", "value"]);
    const event: ArtifactTraceEvent = {
      ...common,
      status: normalizeStatus(record, "unknown"),
      type: "artifact",
      ...(firstString(record, ["name", "filename", "id"])
        ? { name: firstString(record, ["name", "filename", "id"]) }
        : {}),
      ...(firstString(record, ["uri", "url", "path"])
        ? { uri: firstString(record, ["uri", "url", "path"]) }
        : {}),
      ...(firstString(record, ["mime_type", "mimeType", "media_type"])
        ? {
            mime_type: firstString(record, [
              "mime_type",
              "mimeType",
              "media_type"
            ])
          }
        : {}),
      ...(firstString(record, ["operation", "action"])
        ? { operation: firstString(record, ["operation", "action"]) }
        : {}),
      ...(data === undefined
        ? {}
        : { data: toJsonValue(data, context.diagnostics, source) })
    };
    return [event];
  }

  if (type === "error" || type === "exception" || record.error instanceof Error) {
    const rawError = record.error;
    const errorRecord = isRecord(rawError) ? rawError : undefined;
    const message =
      (rawError instanceof Error ? rawError.message : undefined) ??
      (typeof rawError === "string" ? rawError : undefined) ??
      (errorRecord ? firstString(errorRecord, ["message"]) : undefined) ??
      firstString(record, ["message", "detail"]) ??
      "Unknown trace error";
    const details =
      (errorRecord ? firstDefined(errorRecord, ["details", "data"]) : undefined) ??
      firstDefined(record, ["details", "data"]);
    context.nextSequence += 1;
    const event: ErrorTraceEvent = {
      ...common,
      status: "failed",
      type: "error",
      error: {
        message,
        ...((errorRecord ? firstString(errorRecord, ["code", "type"]) : undefined) ??
        firstString(record, ["code"])
          ? {
              code:
                (errorRecord
                  ? firstString(errorRecord, ["code", "type"])
                  : undefined) ?? firstString(record, ["code"])
            }
          : {}),
        ...(details === undefined
          ? {}
          : { details: toJsonValue(details, context.diagnostics, source) })
      }
    };
    return [event];
  }

  if (
    type === "state_change" ||
    type === "state_changed" ||
    type === "transition"
  ) {
    const stateRecord = isRecord(record.state) ? record.state : record;
    context.nextSequence += 1;
    const event: StateChangeTraceEvent = {
      ...common,
      type: "state_change",
      state: {
        ...(firstString(stateRecord, ["name", "key"])
          ? { name: firstString(stateRecord, ["name", "key"]) }
          : {}),
        ...(firstDefined(stateRecord, ["from", "previous", "old_value"]) === undefined
          ? {}
          : {
              from: toJsonValue(
                firstDefined(stateRecord, ["from", "previous", "old_value"]),
                context.diagnostics,
                source
              )
            }),
        ...(firstDefined(stateRecord, ["to", "next", "new_value", "current"]) === undefined
          ? {}
          : {
              to: toJsonValue(
                firstDefined(stateRecord, ["to", "next", "new_value", "current"]),
                context.diagnostics,
                source
              )
            }),
        ...(firstDefined(stateRecord, ["value"]) === undefined
          ? {}
          : {
              value: toJsonValue(
                firstDefined(stateRecord, ["value"]),
                context.diagnostics,
                source
              )
            })
      }
    };
    return [event];
  }

  if (record.role === "tool") {
    return parseGenericEvent(
      { ...record, type: "tool_result" },
      path,
      context
    );
  }

  if (
    type === "message" ||
    type === "input_text" ||
    type === "output_text" ||
    typeof record.role === "string"
  ) {
    const blockEvents = parseMessageBlocks(record, path, context);
    if (blockEvents) {
      return blockEvents;
    }

    const events: CanonicalTraceEvent[] = [];
    const content =
      firstDefined(record, ["content", "text", "message", "value"]) ?? "";
    const hasContent =
      typeof content !== "string" || content.length > 0 ||
      !Array.isArray(firstDefined(record, ["tool_calls", "toolCalls"])) &&
      !isRecord(record.function_call);
    if (hasContent) {
      context.nextSequence += 1;
      const event: MessageTraceEvent = {
        ...common,
        status: normalizeStatus(record, "succeeded"),
        type: "message",
        role: normalizeRole(record.role),
        content: toJsonValue(content, context.diagnostics, source)
      };
      events.push(event);
    }
    events.push(...parseNestedToolCalls(record, path, context));
    return events;
  }

  context.diagnostics.push(
    diagnostic(
      "UNSUPPORTED_EVENT",
      "warning",
      "parsing",
      `Unsupported generic event type ${type || "(missing)"} was skipped.`,
      source
    )
  );
  context.lossy = true;
  return [];
}

function getGenericItems(
  root: unknown,
  diagnostics: TraceDiagnostic[]
): { items: unknown[]; basePath: string } | null {
  if (Array.isArray(root)) {
    return { items: root, basePath: "$" };
  }
  if (!isRecord(root)) {
    diagnostics.push(
      diagnostic(
        "INVALID_TRACE_ROOT",
        "error",
        "parsing",
        "Generic trace JSON must be an event object or an array of events.",
        sourcePointer("generic_json", "$")
      )
    );
    return null;
  }

  for (const key of ["events", "messages", "trace", "items"] as const) {
    if (Array.isArray(root[key])) {
      return { items: root[key], basePath: `$.${key}` };
    }
  }
  return { items: [root], basePath: "$single" };
}

export function parseGenericJson(input: unknown): AdapterParseResult {
  const diagnostics: TraceDiagnostic[] = [];
  let root = input;
  if (typeof input === "string") {
    try {
      root = JSON.parse(input);
    } catch {
      return {
        events: [],
        diagnostics: [
          diagnostic(
            "INVALID_JSON",
            "error",
            "parsing",
            "Generic trace input is not valid JSON.",
            sourcePointer("generic_json", "$")
          )
        ],
        lossy: true
      };
    }
  }

  const collection = getGenericItems(root, diagnostics);
  if (!collection) {
    return { events: [], diagnostics, lossy: true };
  }

  const context: GenericParseContext = {
    diagnostics,
    nextSequence: 0,
    lossy: false
  };
  const events: CanonicalTraceEvent[] = [];
  collection.items.forEach((item, itemIndex) => {
    const path =
      collection.basePath === "$single"
        ? "$"
        : `${collection.basePath}[${itemIndex}]`;
    if (!isRecord(item)) {
      context.diagnostics.push(
        diagnostic(
          "MALFORMED_EVENT",
          "error",
          "parsing",
          "Trace event must be an object.",
          sourcePointer("generic_json", path, itemIndex)
        )
      );
      context.lossy = true;
      return;
    }
    events.push(...parseGenericEvent(item, path, context));
  });

  return {
    events,
    diagnostics,
    lossy: context.lossy
  };
}
