import type OpenAI from "openai";

import { runEvaluationAgent } from "@/lib/agent/evaluation-agent";
import {
  createRunTelemetry,
  fallbackPolicyForMode
} from "@/lib/agent/telemetry";
import { prepareEvaluationTrace } from "@/lib/evaluation-input";
import { evaluateWithHeuristics } from "@/lib/heuristics";
import type {
  AgentStep,
  EvaluationMode,
  EvaluationReport
} from "@/lib/types";

type EvaluateTraceOptions = {
  onStep?: (step: AgentStep) => void | Promise<void>;
  client?: OpenAI;
  requestedModel?: string;
};

export async function evaluateTrace(
  trace: string,
  mode: EvaluationMode,
  options: EvaluateTraceOptions = {}
): Promise<EvaluationReport> {
  const prepared = prepareEvaluationTrace(trace);
  const fallbackPolicy = fallbackPolicyForMode(mode);
  const requestedModel =
    options.requestedModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const telemetry = createRunTelemetry(prepared, {
    requestedModel,
    fallbackPolicy
  });
  const canRunAgent = Boolean(options.client || process.env.OPENAI_API_KEY);

  if (!canRunAgent) {
    if (fallbackPolicy === "strict-no-fallback") {
      throw new Error(
        `Agent evaluation is unavailable in ${mode}; heuristic fallback is disabled for non-demo results.`
      );
    }
    return evaluateWithHeuristics(prepared, mode, {
      telemetry,
      degraded: true,
      degradationReason: "agent_unavailable",
      fallbackReason: "missing_api_key",
      fallbackPolicy
    });
  }

  try {
    return await runEvaluationAgent(prepared, mode, {
      ...options,
      telemetry,
      requestedModel
    });
  } catch (error) {
    if (fallbackPolicy === "strict-no-fallback") {
      throw error;
    }
    console.error(
      "Evaluation agent failed; returning a degraded demo fallback.",
      error
    );
    return evaluateWithHeuristics(prepared, mode, {
      telemetry,
      degraded: true,
      degradationReason: "agent_failure",
      fallbackReason:
        error instanceof Error
          ? `agent_error:${error.name}`
          : "agent_error:unknown",
      fallbackPolicy
    });
  }
}
