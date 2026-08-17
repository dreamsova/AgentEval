import type {
  CanonicalTraceEvent,
  NormalizedTrace,
  ProvenanceLevel,
  TraceCallPair,
  TraceDiagnostic,
  ToolCallTraceEvent,
  ToolResultTraceEvent
} from "./types";
import { diagnostic } from "./internal";

export type TracePairingResult = {
  call_pairs: TraceCallPair[];
  orphan_result_event_ids: string[];
  diagnostics: TraceDiagnostic[];
};

export type TraceExecutionEvidence = TraceCallPair & {
  parent_event_id: string;
};

const provenanceRank: Record<ProvenanceLevel, number> = {
  declared: 0,
  recorded: 1,
  verified: 2
};

function weakestProvenance(
  left: ProvenanceLevel,
  right: ProvenanceLevel
): ProvenanceLevel {
  return provenanceRank[left] <= provenanceRank[right] ? left : right;
}

function pairStatus(
  call: ToolCallTraceEvent,
  result: ToolResultTraceEvent | undefined
) {
  if (call.status === "failed" || result?.status === "failed") {
    return "failed" as const;
  }
  if (call.status === "cancelled" || result?.status === "cancelled") {
    return "cancelled" as const;
  }
  return result?.status ?? call.status;
}

/**
 * Pairs only by explicit identity: call_id first, then parent_id -> call event_id.
 * Array proximity and tool names are intentionally never evidence of identity.
 */
export function pairToolCallsAndResults(
  events: CanonicalTraceEvent[]
): TracePairingResult {
  const diagnostics: TraceDiagnostic[] = [];
  const calls = events.filter(
    (event): event is ToolCallTraceEvent => event.type === "tool_call"
  );
  const results = events.filter(
    (event): event is ToolResultTraceEvent => event.type === "tool_result"
  );
  const callsByCallId = new Map<string, ToolCallTraceEvent[]>();
  const callsByEventId = new Map(calls.map((call) => [call.event_id, call]));
  const resultByCallEventId = new Map<string, ToolResultTraceEvent>();
  const orphanResultEventIds: string[] = [];

  for (const call of calls) {
    if (!call.call_id) {
      diagnostics.push(
        diagnostic(
          "MISSING_CALL_ID",
          "warning",
          "pairing",
          "Tool call has no call_id; only a result parent_id pointing to its event_id can pair it.",
          call.source,
          [call.event_id]
        )
      );
      continue;
    }
    const matching = callsByCallId.get(call.call_id) ?? [];
    matching.push(call);
    callsByCallId.set(call.call_id, matching);
  }

  for (const [callId, matching] of callsByCallId) {
    if (matching.length > 1) {
      diagnostics.push(
        diagnostic(
          "DUPLICATE_CALL_ID",
          "warning",
          "pairing",
          `call_id ${callId} is used by ${matching.length} calls; results are assigned to unmatched calls in source order.`,
          matching[0].source,
          matching.map((event) => event.event_id)
        )
      );
    }
  }

  for (const result of results) {
    let call: ToolCallTraceEvent | undefined;
    if (result.call_id) {
      call = callsByCallId
        .get(result.call_id)
        ?.find((candidate) => !resultByCallEventId.has(candidate.event_id));
    } else if (result.parent_id) {
      const candidate = callsByEventId.get(result.parent_id);
      if (candidate && !resultByCallEventId.has(candidate.event_id)) {
        call = candidate;
      }
    }

    if (!call) {
      orphanResultEventIds.push(result.event_id);
      diagnostics.push(
        diagnostic(
          result.call_id || result.parent_id
            ? "ORPHAN_TOOL_RESULT"
            : "MISSING_CALL_ID",
          "warning",
          "pairing",
          result.call_id || result.parent_id
            ? "Tool result does not identify an unmatched call."
            : "Tool result has neither call_id nor a parent_id that can identify its call.",
          result.source,
          [result.event_id]
        )
      );
      continue;
    }

    resultByCallEventId.set(call.event_id, result);
  }

  const callPairs = calls.map((call): TraceCallPair => {
    const result = resultByCallEventId.get(call.event_id);
    if (!result) {
      diagnostics.push(
        diagnostic(
          "UNMATCHED_TOOL_CALL",
          "warning",
          "pairing",
          "Tool call has no result with matching identity.",
          call.source,
          [call.event_id]
        )
      );
    }

    return {
      pair_id: result
        ? `${call.event_id}::${result.event_id}`
        : `${call.event_id}::unmatched`,
      call_id: call.call_id ?? null,
      call_event_id: call.event_id,
      result_event_id: result?.event_id ?? null,
      status: pairStatus(call, result),
      provenance: result
        ? weakestProvenance(call.provenance, result.provenance)
        : call.provenance
    };
  });

  return {
    call_pairs: callPairs,
    orphan_result_event_ids: orphanResultEventIds,
    diagnostics
  };
}

/**
 * Returns execution evidence only through an explicit call.parent_id edge.
 * It never treats a nearby or same-named successful action as support.
 */
export function getExecutionEvidenceForEvent(
  trace: NormalizedTrace,
  parentEventId: string
): TraceExecutionEvidence[] {
  const childCallIds = new Set(
    trace.events
      .filter(
        (event): event is ToolCallTraceEvent =>
          event.type === "tool_call" && event.parent_id === parentEventId
      )
      .map((event) => event.event_id)
  );

  return trace.call_pairs
    .filter((pair) => childCallIds.has(pair.call_event_id))
    .map((pair) => ({ ...pair, parent_event_id: parentEventId }));
}
