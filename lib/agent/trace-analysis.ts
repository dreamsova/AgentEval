import {
  getExecutionEvidenceForEvent,
  normalizeTrace,
  type CanonicalTraceEvent,
  type JsonValue,
  type NormalizedTrace,
  type ProvenanceLevel,
  type TraceStatus,
  type ToolCallTraceEvent
} from "@/lib/trace";

export type TraceAnalysisInput = string | NormalizedTrace;

export type TraceLine = {
  lineNumber: number;
  role: "user" | "agent" | "tool" | "system" | "unknown";
  quote: string;
  event_id: string;
  call_id: string | null;
  parent_id: string | null;
  status: TraceStatus;
  provenance: ProvenanceLevel;
};

export type TraceClaim = TraceLine & {
  kind: "promise" | "completion" | "confidence";
};

export type TraceAction = TraceLine & {
  kind: "tool_call" | "tool_result" | "artifact" | "failure";
};

type AnalysisContext = {
  trace: NormalizedTrace;
  legacyFallback: boolean;
  lines: TraceLine[];
};

const promisePattern = /\b(i will|i'll|i am going to|i can|next i(?:'m| am) going to)\b/i;
const completionPattern = /\b(done|completed|finished|created|moved|saved|handled|fixed|organized|already in place|task is complete|task is effectively complete)\b/i;
const confidencePattern = /\b(absolutely|definitely|precise|exact|accurate|nothing else needs your attention|use them as-is)\b/i;

function contentText(content: JsonValue): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || typeof content === "number" || typeof content === "boolean") {
    return String(content);
  }
  if (Array.isArray(content)) {
    return content.map(contentText).filter(Boolean).join(" ");
  }
  if (typeof content.text === "string") {
    return content.text;
  }
  if (content.content !== undefined) {
    return contentText(content.content);
  }
  return JSON.stringify(content);
}

function eventQuote(event: CanonicalTraceEvent): string {
  switch (event.type) {
    case "message":
      return `${event.role === "assistant" ? "Agent" : event.role}: ${contentText(event.content)}`;
    case "tool_call":
      return `Tool: call ${event.tool_name} arguments=${JSON.stringify(event.arguments)}`;
    case "tool_result":
      return `Tool: result${event.tool_name ? ` ${event.tool_name}` : ""} status=${event.status} result=${JSON.stringify(event.result)}`;
    case "artifact":
      return `Artifact: ${event.name ?? event.uri ?? JSON.stringify(event.data ?? null)} status=${event.status}`;
    case "error":
      return `Error: ${event.error.message}`;
    case "state_change":
      return `State: ${JSON.stringify(event.state)} status=${event.status}`;
  }
}

function eventRole(event: CanonicalTraceEvent): TraceLine["role"] {
  if (event.type === "tool_call" || event.type === "tool_result") {
    return "tool";
  }
  if (event.type !== "message") {
    return "unknown";
  }
  if (event.role === "assistant") {
    return "agent";
  }
  return event.role === "tool" ? "tool" : event.role;
}

function toTraceLine(event: CanonicalTraceEvent): TraceLine {
  return {
    lineNumber: event.source.line ?? event.sequence + 1,
    role: eventRole(event),
    quote: eventQuote(event),
    event_id: event.event_id,
    call_id: event.call_id ?? null,
    parent_id: event.parent_id ?? null,
    status: event.status,
    provenance: event.provenance
  };
}

function analysisContext(input: TraceAnalysisInput): AnalysisContext {
  const trace = typeof input === "string" ? normalizeTrace(input) : input;
  return {
    trace,
    legacyFallback: trace.source_format === "legacy_text",
    lines: trace.events.map(toTraceLine)
  };
}

export function getTraceLines(input: TraceAnalysisInput): TraceLine[] {
  return analysisContext(input).lines;
}

function claimsFromContext(context: AnalysisContext): TraceClaim[] {
  const claims: TraceClaim[] = [];
  for (const line of context.lines) {
    if (line.role !== "agent") {
      continue;
    }
    if (completionPattern.test(line.quote)) {
      claims.push({ ...line, kind: "completion" });
    } else if (promisePattern.test(line.quote)) {
      claims.push({ ...line, kind: "promise" });
    } else if (confidencePattern.test(line.quote)) {
      claims.push({ ...line, kind: "confidence" });
    }
  }
  return claims;
}

export function extractTraceClaims(input: TraceAnalysisInput): TraceClaim[] {
  return claimsFromContext(analysisContext(input)).slice(0, 16);
}

function actionsFromContext(context: AnalysisContext): TraceAction[] {
  const actions: TraceAction[] = [];
  for (const event of context.trace.events) {
    const line = toTraceLine(event);
    if (event.type === "tool_call") {
      actions.push({ ...line, kind: "tool_call" });
    } else if (event.type === "tool_result") {
      actions.push({
        ...line,
        kind:
          event.status === "failed" || event.status === "cancelled"
            ? "failure"
            : "tool_result"
      });
    } else if (event.type === "artifact") {
      actions.push({
        ...line,
        kind:
          event.status === "failed" || event.status === "cancelled"
            ? "failure"
            : "artifact"
      });
    } else if (event.type === "error") {
      actions.push({ ...line, kind: "failure" });
    }
  }
  return actions;
}

export function extractTraceActions(input: TraceAnalysisInput): TraceAction[] {
  return actionsFromContext(analysisContext(input)).slice(0, 40);
}

function explicitlyLinkedEvidence(
  context: AnalysisContext,
  claim: TraceClaim,
  actions: TraceAction[]
): {
  evidence: TraceAction | null;
  rejectedEvidence: TraceAction | null;
  basis: string;
  provenance: ProvenanceLevel | null;
} {
  const callByEventId = new Map(
    context.trace.events
      .filter(
        (event): event is ToolCallTraceEvent => event.type === "tool_call"
      )
      .map((event) => [event.event_id, event])
  );
  const linkedPairs = context.trace.call_pairs.filter((pair) => {
    const call = callByEventId.get(pair.call_event_id);
    return (
      call?.parent_id === claim.event_id ||
      claim.parent_id === pair.call_event_id ||
      claim.parent_id === pair.result_event_id
    );
  });
  const parentPairs = getExecutionEvidenceForEvent(
    context.trace,
    claim.event_id
  );
  for (const pair of parentPairs) {
    if (!linkedPairs.some((candidate) => candidate.pair_id === pair.pair_id)) {
      linkedPairs.push(pair);
    }
  }

  const successfulPair = linkedPairs.find(
    (pair) =>
      pair.result_event_id !== null &&
      pair.status === "succeeded" &&
      pair.provenance !== "declared"
  );
  if (successfulPair?.result_event_id) {
    return {
      evidence:
        actions.find(
          (action) => action.event_id === successfulPair.result_event_id
        ) ?? null,
      rejectedEvidence: null,
      basis: "explicit_call_result_identity",
      provenance: successfulPair.provenance
    };
  }

  const linkedArtifacts = context.trace.events.filter(
    (event) =>
      event.type === "artifact" &&
      (event.parent_id === claim.event_id || claim.parent_id === event.event_id)
  );
  const linkedArtifact = linkedArtifacts.find(
    (event) =>
      event.type === "artifact" &&
      event.status === "succeeded" &&
      event.provenance !== "declared"
  );
  if (
    linkedArtifact?.type === "artifact" &&
    linkedArtifact.status === "succeeded" &&
    linkedArtifact.provenance !== "declared"
  ) {
    return {
      evidence:
        actions.find((action) => action.event_id === linkedArtifact.event_id) ??
        null,
      rejectedEvidence: null,
      basis: "explicit_artifact_identity",
      provenance: linkedArtifact.provenance
    };
  }

  const rejectedPair = linkedPairs.find(
    (pair) => pair.result_event_id !== null
  );
  const rejectedArtifactEvent = linkedArtifacts[0];
  const rejectedArtifact = rejectedArtifactEvent
    ? actions.find(
        (action) => action.event_id === rejectedArtifactEvent.event_id
      )
    : undefined;
  return {
    evidence: null,
    rejectedEvidence:
      (rejectedPair?.result_event_id
        ? actions.find(
            (action) => action.event_id === rejectedPair.result_event_id
          )
        : undefined) ??
      rejectedArtifact ??
      null,
    basis:
      rejectedPair || rejectedArtifactEvent
        ? "linked_evidence_rejected"
        : "none",
    provenance:
      rejectedPair?.provenance ?? rejectedArtifactEvent?.provenance ?? null
  };
}

function alignFromContext(context: AnalysisContext) {
  const completionClaims = claimsFromContext(context).filter(
    (claim) => claim.kind === "completion"
  );
  const actions = actionsFromContext(context);

  const alignments = completionClaims.map((claim) => {
    if (context.legacyFallback) {
      const evidence = actions.find(
        (action) =>
          Math.abs(action.lineNumber - claim.lineNumber) <= 14 &&
          (action.kind === "tool_result" || action.kind === "artifact")
      );
      return {
        claim,
        supported: Boolean(evidence),
        evidence: evidence ?? null,
        rejectedEvidence: null,
        basis: evidence ? "legacy_declared_proximity" : "none",
        provenance: evidence?.provenance ?? null,
        lossy: true
      };
    }

    const linked = explicitlyLinkedEvidence(context, claim, actions);
    return {
      claim,
      supported: Boolean(linked.evidence),
      evidence: linked.evidence,
      rejectedEvidence: linked.rejectedEvidence,
      basis: linked.basis,
      provenance: linked.provenance,
      lossy: false
    };
  });

  return {
    alignments,
    supportedCount: alignments.filter((item) => item.supported).length,
    unsupportedCount: alignments.filter((item) => !item.supported).length,
    analysis_basis: context.legacyFallback
      ? "legacy_declared_lossy_fallback"
      : "canonical_explicit_identity",
    lossy: context.legacyFallback || context.trace.lossy
  };
}

export function alignClaimsWithActions(input: TraceAnalysisInput) {
  return alignFromContext(analysisContext(input));
}

export function inspectMaskingSignals(input: TraceAnalysisInput) {
  const context = analysisContext(input);
  const maskingPattern = /\b(happy to help|neatly organized|everything should|important part|effectively complete|directionally reliable|accurate enough|nothing else needs your attention|should match)\b/i;
  const verificationGapPattern = /\b(do not have the exact|don't have the exact|did not open|didn't open|did not verify|didn't verify|cannot verify|can't verify|not public)\b/i;
  const maskingLines = context.lines.filter((line) =>
    maskingPattern.test(line.quote)
  );
  const verificationGapLines = context.lines.filter((line) =>
    verificationGapPattern.test(line.quote)
  );
  const alignment = alignFromContext(context);

  return {
    maskingLines: maskingLines.slice(0, 8),
    verificationGapLines: verificationGapLines.slice(0, 8),
    unsupportedCompletionClaims: alignment.unsupportedCount,
    analysis_basis: alignment.analysis_basis,
    elevated:
      verificationGapLines.length > 0 ||
      (maskingLines.length > 0 && alignment.unsupportedCount > 0)
  };
}

export function inspectTraceStructure(input: TraceAnalysisInput) {
  const context = analysisContext(input);
  const actions = actionsFromContext(context);
  const claims = claimsFromContext(context);
  const roles = Array.from(new Set(context.lines.map((line) => line.role)));
  const provenance = { declared: 0, recorded: 0, verified: 0 };
  for (const event of context.trace.events) {
    provenance[event.provenance] += 1;
  }

  return {
    lines: context.lines.length,
    turns: context.trace.events.filter((event) => event.type === "message").length,
    roles,
    claims: claims.length,
    completionClaims: claims.filter((claim) => claim.kind === "completion").length,
    observableActions: actions.length,
    toolEvents: actions.filter(
      (action) => action.kind === "tool_call" || action.kind === "tool_result"
    ).length,
    failureEvents: actions.filter((action) => action.kind === "failure").length,
    pairedCalls: context.trace.call_pairs.filter(
      (pair) => pair.result_event_id !== null
    ).length,
    orphanResults: context.trace.orphan_result_event_ids.length,
    diagnostics: context.trace.diagnostics.map((item) => item.code),
    provenance,
    analysis_basis: context.legacyFallback
      ? "legacy_declared_lossy_fallback"
      : "canonical_explicit_identity",
    lossy: context.legacyFallback || context.trace.lossy
  };
}
