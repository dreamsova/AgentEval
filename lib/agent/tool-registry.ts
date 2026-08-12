import type { FunctionTool } from "openai/resources/responses/responses";
import { z } from "zod";

import {
  alignClaimsWithActions,
  extractTraceActions,
  extractTraceClaims,
  inspectMaskingSignals,
  inspectTraceStructure
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
    description: "Inspect concrete actions, artifacts, tool calls, tool results, and visible failures.",
    strict: true,
    parameters
  },
  {
    type: "function",
    name: "verify_claim_action_alignment",
    description: "Compare completion claims with nearby observable execution evidence and identify unsupported claims.",
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
  trace: string
): AgentToolExecution {
  const { reason } = toolArgumentsSchema.parse(JSON.parse(rawArguments));
  let data: unknown;
  let observation: string;

  switch (name) {
    case "inspect_trace": {
      const result = inspectTraceStructure(trace);
      data = result;
      observation = `Parsed ${result.lines} non-empty lines across ${result.turns} turns; found ${result.completionClaims} completion claims, ${result.observableActions} observable action signals, and ${result.toolEvents} tool events.`;
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
      observation = `Found ${result.length} observable execution signals: ${result.filter((item) => item.kind === "tool_result").length} tool results, ${result.filter((item) => item.kind === "artifact").length} artifacts, and ${result.filter((item) => item.kind === "failure").length} failures.`;
      break;
    }
    case "verify_claim_action_alignment": {
      const result = alignClaimsWithActions(trace);
      data = result;
      observation = `Matched ${result.supportedCount} completion claims to nearby evidence; ${result.unsupportedCount} completion claims remain unsupported.`;
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
