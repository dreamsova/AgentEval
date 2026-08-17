import type OpenAI from "openai";

import { runEvaluationAgent } from "@/lib/agent/evaluation-agent";
import { buildEvaluationAgentPrompt } from "@/lib/agent/system-prompt";
import { evaluationTools } from "@/lib/agent/tool-registry";
import { reportEvidence, reportPrediction } from "@/lib/evaluators/prediction";
import type {
  BenchmarkEvaluator,
  BenchmarkEvaluatorInput,
  EvaluatorContext,
  EvaluatorDescriptor,
  EvaluatorResult
} from "@/lib/evaluators/types";

export class AdaptiveAgentEvalEvaluator implements BenchmarkEvaluator {
  readonly descriptor: EvaluatorDescriptor;

  constructor(
    private readonly client: OpenAI,
    private readonly model: string
  ) {
    this.descriptor = {
      id: "adaptive-agenteval",
      version: "1.0.0",
      engine: "agent",
      prompt_version: "agent-eval-prompt-v2",
      prompt: buildEvaluationAgentPrompt("research-eval"),
      toolset_version: "agent-eval-toolset-v2",
      toolset: evaluationTools.map((tool) => tool.name),
      requested_model: model,
      provider: "openai-responses"
    };
  }

  async evaluate(
    input: BenchmarkEvaluatorInput,
    _context: EvaluatorContext
  ): Promise<EvaluatorResult> {
    const report = await runEvaluationAgent(input.trace, "research-eval", {
      client: this.client,
      requestedModel: this.model
    });
    const metadata = report.run_metadata;
    return {
      engine: "agent",
      prediction: reportPrediction(report),
      evidence: reportEvidence(report),
      requested_model: metadata.requested_model,
      returned_model: metadata.returned_model,
      model_calls: metadata.model_calls,
      tool_calls: (report.agent_run?.steps ?? []).map((step) => ({
        index: step.index,
        name: step.tool,
        status: step.status === "completed" ? "succeeded" : "failed",
        latency_ms: step.duration_ms,
        observation: step.observation
      })),
      tokens: metadata.token_usage,
      latency_ms: metadata.total_wall_time_ms,
      errors: (report.agent_run?.steps ?? []).flatMap((step) =>
        step.status === "failed"
          ? [
              {
                code: "diagnostic_tool_failure",
                name: "DiagnosticToolError",
                message: step.observation,
                retryable: false
              }
            ]
          : []
      ),
      degraded: report.degraded,
      degradation_reason: report.degradation_reason,
      fallback: {
        used: metadata.fallback_reason !== null,
        engine: metadata.fallback_reason === null ? null : report.engine,
        reason: metadata.fallback_reason
      }
    };
  }
}
