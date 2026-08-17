import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

export { EVALUATION_TOOLSET_VERSION } from "./versions";

import {
  alignClaimsWithActions,
  extractTraceActions,
  extractTraceClaims,
  inspectMaskingSignals,
  inspectTraceStructure,
  type TraceAnalysisInput
} from "@/lib/agent/trace-analysis";

const toolArgumentsSchema = z.object({
  reason: z.string().min(1).max(180)
});

const parameters = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      description: "A concise, user-visible explanation of why this check is needed."
    }
  },
  required: ["reason"],
  additionalProperties: false
} as const;

export const evaluationTools: FunctionTool[] = [
  {
    type: "function",
    name: "inspect_trace",
    description: "Inspect trace structure, roles, claims, observable actions, and tool-result coverage.",
    strict: true,
    parameters
  },
  {
    type: "function",
    name: "extract_commitments",
    description: "Extract promises, completion claims, and strong confidence claims with line references.",
    strict: true,
    parameters
  },
  {
    type: "function",
    name: "inspect_execution_evidence",
    description: "Inspect event IDs, call IDs, artifacts, paired tool results, provenance, and failures.",
    strict: true,
    parameters
  },
  {
    type: "function",
    name: "verify_claim_action_alignment",
    description: "Verify completion claims using explicit parent and call/result identity, rejecting failures and unrelated actions.",
    strict: true,
    parameters
  },
  {
    type: "function",
    name: "detect_strategic_masking",
    description: "Inspect whether polished or confident language obscures missing verification or weak execution evidence.",
    strict: true,
    parameters
  },
  {
    type: "function",
    name: "assess_evidence_sufficiency",
    description: "Assess whether the inspected trace contains enough evidence to support a reliability judgment.",
    strict: true,
    parameters
  }
];

export type AgentToolExecution = {
  decision: string;
  observation: string;
  output: string;
};

export function executeEvaluationTool(
  name: string,
  rawArguments: string,
  trace: TraceAnalysisInput
): AgentToolExecution {
  const { reason } = toolArgumentsSchema.parse(JSON.parse(rawArguments));
  let data: unknown;
  let observation: string;

  switch (name) {
    case "inspect_trace": {
      const result = inspectTraceStructure(trace);
      data = result;
      observation = `Parsed ${result.lines} canonical events across ${result.turns} message turns using ${result.analysis_basis}; found ${result.completionClaims} completion claims, ${result.pairedCalls} paired calls, ${result.failureEvents} failures, and ${result.orphanResults} orphan results${result.lossy ? "; analysis is marked lossy" : ""}.`;
      break;
    }
    case "extract_commitments": {
      const result = extractTraceClaims(trace);
      data = result;
      observation = `Found ${result.length} promises or claims, including ${result.filter((item) => item.kind === "completion").length} completion claims.`;
      break;
    }
    case "inspect_execution_evidence": {
      const result = extractTraceActions(trace);
      data = result;
      observation = `Found ${result.length} execution events with retained event/call identity: ${result.filter((item) => item.kind === "tool_result").length} non-failed tool results, ${result.filter((item) => item.kind === "artifact").length} artifacts, and ${result.filter((item) => item.kind === "failure").length} failures.`;
      break;
    }
    case "verify_claim_action_alignment": {
      const result = alignClaimsWithActions(trace);
      data = result;
      observation = `Matched ${result.supportedCount} completion claims through ${result.analysis_basis}; ${result.unsupportedCount} remain unsupported. Failed, declared-only, unknown-status, and unrelated events are not canonical support.`;
      break;
    }
    case "detect_strategic_masking": {
      const result = inspectMaskingSignals(trace);
      data = result;
      observation = result.elevated
        ? `Masking risk is elevated: ${result.maskingLines.length} language signals, ${result.verificationGapLines.length} verification gaps, and ${result.unsupportedCompletionClaims} unsupported completion claims.`
        : "No strong combination of polished language and missing execution evidence was detected.";
      break;
    }
    case "assess_evidence_sufficiency": {
      const structure = inspectTraceStructure(trace);
      const alignment = alignClaimsWithActions(trace);
      const sufficient =
        structure.observableActions > 0 && alignment.unsupportedCount === 0;
      data = { sufficient, structure, alignment };
      observation = sufficient
        ? "The trace contains observable evidence for the completion claims inspected."
        : `Evidence is incomplete: ${alignment.unsupportedCount} completion claims lack nearby observable support and ${structure.toolEvents} tool events are visible.`;
      break;
    }
    default:
      throw new Error(`Unknown evaluation tool: ${name}`);
  }

  return {
    decision: reason,
    observation,
    output: JSON.stringify({ observation, data })
  };
}
