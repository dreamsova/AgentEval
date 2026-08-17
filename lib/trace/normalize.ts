import type {
  CanonicalTraceEvent,
  NormalizeTraceOptions,
  NormalizedTrace,
  TraceAdapterOptions,
  TraceDiagnostic,
  TraceSourceFormat
} from "./types";
import { TRACE_ADAPTER_VERSION, TRACE_SCHEMA_VERSION } from "./types";
import type { AdapterParseResult } from "./internal";
import { diagnostic, firstString, isRecord } from "./internal";
import { pairToolCallsAndResults } from "./pairing";
import { redactTrace } from "./redaction";
import { parseGenericJson } from "./adapters/generic-json";
import { parseLegacyText } from "./adapters/legacy-text";
import { parseOpenAIResponses } from "./adapters/openai-responses";

function ensureUniqueEventIds(
  events: CanonicalTraceEvent[],
  diagnostics: TraceDiagnostic[]
): { events: CanonicalTraceEvent[]; changed: boolean } {
  const occurrences = new Map<string, number>();
  let changed = false;
  const unique = events.map((event) => {
    const count = (occurrences.get(event.event_id) ?? 0) + 1;
    occurrences.set(event.event_id, count);
    if (count === 1) {
      return event;
    }

    changed = true;
    const replacement = `${event.event_id}#${count}`;
    diagnostics.push(
      diagnostic(
        "DUPLICATE_EVENT_ID",
        "warning",
        "validation",
        `Duplicate event_id ${event.event_id} was disambiguated as ${replacement}.`,
        event.source,
        [event.event_id, replacement]
      )
    );
    return { ...event, event_id: replacement };
  });
  return { events: unique, changed };
}

function finalizeTrace(
  sourceFormat: TraceSourceFormat,
  parsed: AdapterParseResult,
  options: TraceAdapterOptions
): NormalizedTrace {
  const diagnostics = [...parsed.diagnostics];
  const unique = ensureUniqueEventIds(parsed.events, diagnostics);
  const pairing = pairToolCallsAndResults(unique.events);
  const trace: NormalizedTrace = {
    schema_version: TRACE_SCHEMA_VERSION,
    adapter_version: TRACE_ADAPTER_VERSION,
    source_format: sourceFormat,
    events: unique.events,
    call_pairs: pairing.call_pairs,
    orphan_result_event_ids: pairing.orphan_result_event_ids,
    diagnostics: [...diagnostics, ...pairing.diagnostics],
    lossy: parsed.lossy || unique.changed,
    redaction: { applied: false, count: 0 }
  };

  return options.redact === false ? trace : redactTrace(trace);
}

export function adaptLegacyText(
  input: string,
  options: TraceAdapterOptions = {}
): NormalizedTrace {
  return finalizeTrace("legacy_text", parseLegacyText(input), options);
}

export function adaptGenericJson(
  input: unknown,
  options: TraceAdapterOptions = {}
): NormalizedTrace {
  return finalizeTrace("generic_json", parseGenericJson(input), options);
}

export function adaptOpenAIResponses(
  input: unknown,
  options: TraceAdapterOptions = {}
): NormalizedTrace {
  return finalizeTrace(
    "openai_responses",
    parseOpenAIResponses(input),
    options
  );
}

function isOpenAIResponsesInput(input: unknown): boolean {
  const values = Array.isArray(input) ? input : [input];
  return values.some((value) => {
    if (!isRecord(value)) {
      return false;
    }
    const type = firstString(value, ["type", "event"]);
    return (
      type?.startsWith("response.") === true ||
      Array.isArray(value.output) ||
      (isRecord(value.response) && Array.isArray(value.response.output))
    );
  });
}

export function normalizeTrace(
  input: unknown,
  options: NormalizeTraceOptions = {}
): NormalizedTrace {
  const format = options.format ?? "auto";
  if (format === "legacy_text") {
    return adaptLegacyText(typeof input === "string" ? input : String(input), options);
  }
  if (format === "generic_json") {
    return adaptGenericJson(input, options);
  }
  if (format === "openai_responses") {
    return adaptOpenAIResponses(input, options);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return adaptLegacyText(input, options);
    }

    try {
      const parsed: unknown = JSON.parse(input);
      return isOpenAIResponsesInput(parsed)
        ? adaptOpenAIResponses(parsed, options)
        : adaptGenericJson(parsed, options);
    } catch {
      if (
        /^(?:\[[^\]]+\]\s*)?(?:user|agent|assistant|system|tool(?:\s+(?:call|result))?|artifact|error|state(?:_change)?)\s*:/im.test(
          input
        )
      ) {
        return adaptLegacyText(input, options);
      }
      return adaptGenericJson(input, options);
    }
  }

  return isOpenAIResponsesInput(input)
    ? adaptOpenAIResponses(input, options)
    : adaptGenericJson(input, options);
}

export const adaptLegacyTrace = adaptLegacyText;
export const adaptGenericTrace = adaptGenericJson;
export const adaptOpenAIResponsesTrace = adaptOpenAIResponses;
