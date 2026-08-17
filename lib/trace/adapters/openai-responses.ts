import type {
  CanonicalTraceEvent,
  TraceDiagnostic,
  TraceSourcePointer
} from "../types";
import {
  type AdapterParseResult,
  diagnostic,
  firstDefined,
  firstString,
  isRecord,
  sourcePointer
} from "../internal";
import { parseGenericJson } from "./generic-json";

type PreparedEntry = {
  record: Record<string, unknown>;
  path: string;
};

function rawType(record: Record<string, unknown>): string {
  return firstString(record, ["type", "event", "kind"]) ?? "";
}

function responseOutputEntries(
  response: Record<string, unknown>,
  basePath: string
): PreparedEntry[] {
  if (!Array.isArray(response.output)) {
    return [];
  }
  const inheritedTimestamp = firstDefined(response, ["created_at", "timestamp"]);
  const entries: PreparedEntry[] = [];
  response.output.forEach((item, index) => {
    if (!isRecord(item)) {
      entries.push({
        record: { type: "__malformed_openai_item", value: item },
        path: `${basePath}.output[${index}]`
      });
      return;
    }
    entries.push({
      record: {
        ...item,
        ...(firstDefined(item, ["timestamp", "created_at"]) === undefined &&
        (typeof inheritedTimestamp === "string" ||
          typeof inheritedTimestamp === "number")
          ? { timestamp: inheritedTimestamp }
          : {})
      },
      path: `${basePath}.output[${index}]`
    });
  });
  return entries;
}

function streamEntries(
  events: unknown[],
  diagnostics: TraceDiagnostic[]
): PreparedEntry[] {
  const completedResponses = events.filter(
    (event) => isRecord(event) && rawType(event) === "response.completed"
  );
  const finalEnvelope = completedResponses.at(-1);
  if (isRecord(finalEnvelope) && isRecord(finalEnvelope.response)) {
    return responseOutputEntries(finalEnvelope.response, "$[response.completed].response");
  }

  const doneItemIds = new Set(
    events.flatMap((event) => {
      if (
        isRecord(event) &&
        rawType(event) === "response.output_item.done" &&
        isRecord(event.item)
      ) {
        const id = firstString(event.item, ["id"]);
        return id ? [id] : [];
      }
      return [];
    })
  );
  const entries: PreparedEntry[] = [];

  events.forEach((event, index) => {
    const eventPath = `$[${index}]`;
    if (!isRecord(event)) {
      entries.push({
        record: { type: "__malformed_openai_item", value: event },
        path: eventPath
      });
      return;
    }

    const type = rawType(event);
    if (type === "response.output_item.added" || type === "response.output_item.done") {
      if (!isRecord(event.item)) {
        diagnostics.push(
          diagnostic(
            "MALFORMED_EVENT",
            "error",
            "parsing",
            `${type} is missing its item object.`,
            sourcePointer("openai_responses", eventPath, index, type)
          )
        );
        return;
      }
      const itemId = firstString(event.item, ["id"]);
      if (type.endsWith("added") && itemId && doneItemIds.has(itemId)) {
        return;
      }
      entries.push({
        record: {
          ...event.item,
          ...(firstDefined(event.item, ["timestamp", "created_at"]) === undefined
            ? {
                timestamp: firstDefined(event, ["timestamp", "created_at"])
              }
            : {})
        },
        path: `${eventPath}.item`
      });
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const itemId = firstString(event, ["item_id"]);
      if (itemId && doneItemIds.has(itemId)) {
        return;
      }
      entries.push({
        record: {
          type: "function_call",
          event_id: firstString(event, ["id"]) ?? itemId,
          call_id: firstString(event, ["call_id"]) ?? itemId,
          name: firstString(event, ["name"]) ?? "unknown_tool",
          arguments: firstDefined(event, ["arguments"]),
          timestamp: firstDefined(event, ["timestamp", "created_at"])
        },
        path: eventPath
      });
      return;
    }

    if (type === "response.output_text.done") {
      const itemId = firstString(event, ["item_id"]);
      if (itemId && doneItemIds.has(itemId)) {
        return;
      }
      entries.push({
        record: {
          type: "message",
          event_id:
            firstString(event, ["id"]) ??
            `${itemId ?? `item-${index}`}:text`,
          parent_id: itemId,
          role: "assistant",
          content: firstDefined(event, ["text"]) ?? "",
          status: "completed",
          timestamp: firstDefined(event, ["timestamp", "created_at"])
        },
        path: eventPath
      });
      return;
    }

    if (type === "response.failed" || type === "error") {
      entries.push({
        record: {
          ...event,
          type: "error",
          error:
            (isRecord(event.response) ? event.response.error : undefined) ??
            event.error ??
            firstString(event, ["message"]) ??
            "OpenAI response failed"
        },
        path: eventPath
      });
      return;
    }

    if (
      type === "response.created" ||
      type === "response.in_progress" ||
      type === "response.incomplete"
    ) {
      const response = isRecord(event.response) ? event.response : {};
      entries.push({
        record: {
          type: "state_change",
          event_id: firstString(event, ["id"]),
          parent_id: firstString(response, ["id"]),
          state: {
            name: "response_status",
            to: firstString(response, ["status"]) ?? type.replace("response.", "")
          },
          status: firstString(response, ["status"]),
          timestamp: firstDefined(event, ["timestamp", "created_at"])
        },
        path: eventPath
      });
      return;
    }

    if (type.endsWith(".delta")) {
      const itemId = firstString(event, ["item_id"]);
      if (itemId && doneItemIds.has(itemId)) {
        return;
      }
      diagnostics.push(
        diagnostic(
          "INCOMPLETE_STREAM_DELTA",
          "warning",
          "parsing",
          `${type} was not used because no final item was available.`,
          sourcePointer("openai_responses", eventPath, index, type)
        )
      );
      return;
    }

    entries.push({ record: event, path: eventPath });
  });

  return entries;
}

function prepareEntries(
  root: unknown,
  diagnostics: TraceDiagnostic[]
): PreparedEntry[] | null {
  if (Array.isArray(root)) {
    return streamEntries(root, diagnostics);
  }
  if (!isRecord(root)) {
    diagnostics.push(
      diagnostic(
        "INVALID_TRACE_ROOT",
        "error",
        "parsing",
        "OpenAI Responses trace must be a response object or event array.",
        sourcePointer("openai_responses", "$")
      )
    );
    return null;
  }

  const type = rawType(root);
  if (type.startsWith("response.")) {
    return streamEntries([root], diagnostics);
  }
  if (isRecord(root.response)) {
    return responseOutputEntries(root.response, "$.response");
  }
  if (Array.isArray(root.output)) {
    return responseOutputEntries(root, "$response");
  }
  if (Array.isArray(root.events)) {
    return streamEntries(root.events, diagnostics);
  }
  if (type || typeof root.role === "string") {
    return [{ record: root, path: "$" }];
  }

  diagnostics.push(
    diagnostic(
      "INVALID_TRACE_ROOT",
      "error",
      "parsing",
      "Object does not contain OpenAI Responses output or events.",
      sourcePointer("openai_responses", "$")
    )
  );
  return null;
}

function remapSource(
  source: TraceSourcePointer,
  entries: PreparedEntry[]
): TraceSourcePointer {
  const match = source.path?.match(/^\$\[(\d+)\](.*)$/);
  const preparedIndex = match ? Number(match[1]) : source.index ?? 0;
  const entry = entries[preparedIndex];
  return {
    ...source,
    format: "openai_responses",
    path: entry ? `${entry.path}${match?.[2] ?? ""}` : source.path
  };
}

export function parseOpenAIResponses(input: unknown): AdapterParseResult {
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
            "OpenAI Responses trace input is not valid JSON.",
            sourcePointer("openai_responses", "$")
          )
        ],
        lossy: true
      };
    }
  }

  const entries = prepareEntries(root, diagnostics);
  if (!entries) {
    return { events: [], diagnostics, lossy: true };
  }

  const preparedRecords = entries.map((entry, index) => ({
    ...entry.record,
    ...(firstDefined(entry.record, ["sequence", "seq", "index"]) === undefined
      ? { sequence: index }
      : {})
  }));
  const generic = parseGenericJson(preparedRecords);
  const events: CanonicalTraceEvent[] = generic.events.map((event) => ({
    ...event,
    event_id: event.event_id.startsWith("generic:")
      ? event.event_id.replace("generic:", "openai:")
      : event.event_id,
    source: remapSource(event.source, entries)
  }));
  const remappedDiagnostics = generic.diagnostics.map((item) => ({
    ...item,
    ...(item.source ? { source: remapSource(item.source, entries) } : {})
  }));

  return {
    events,
    diagnostics: [...diagnostics, ...remappedDiagnostics],
    lossy:
      generic.lossy ||
      diagnostics.some(
        (item) => item.severity === "error" || item.category === "parsing"
      )
  };
}
