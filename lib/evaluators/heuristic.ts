import { evaluateWithHeuristics } from "@/lib/heuristics";
import { reportEvidence, reportPrediction } from "@/lib/evaluators/prediction";
import type {
  BenchmarkEvaluator,
  BenchmarkEvaluatorInput,
  EvaluatorContext,
  EvaluatorDescriptor,
  EvaluatorResult
} from "@/lib/evaluators/types";

const HEURISTIC_PROMPT =
  "Current AgentEval deterministic heuristic scoring and evidence extraction.";

export class HeuristicEvaluator implements BenchmarkEvaluator {
  readonly descriptor: EvaluatorDescriptor = {
    id: "current-heuristic",
    version: "1.0.0",
    engine: "heuristic",
    prompt_version: "heuristic-v1",
    prompt: HEURISTIC_PROMPT,
    toolset_version: "no-tools-v1",
    toolset: [],
    requested_model: null,
    provider: null
  };

  async evaluate(
    input: BenchmarkEvaluatorInput,
    _context: EvaluatorContext
  ): Promise<EvaluatorResult> {
    const startedAt = Date.now();
    const report = evaluateWithHeuristics(input.trace, "research-eval");
    return {
      engine: "heuristic",
      prediction: reportPrediction(report),
      evidence: reportEvidence(report),
      requested_model: null,
      returned_model: null,
      model_calls: [],
      tool_calls: [],
      tokens: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        complete: true
      },
      latency_ms: Math.max(0, Date.now() - startedAt),
      errors: [],
      degraded: false,
      degradation_reason: null,
      fallback: { used: false, engine: null, reason: null }
    };
  }
}
