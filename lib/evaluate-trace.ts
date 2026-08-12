import { runEvaluationAgent } from "@/lib/agent/evaluation-agent";
import { evaluateWithHeuristics } from "@/lib/heuristics";
import type {
  AgentStep,
  EvaluationMode,
  EvaluationReport
} from "@/lib/types";

type EvaluateTraceOptions = {
  onStep?: (step: AgentStep) => void | Promise<void>;
};

export async function evaluateTrace(
  trace: string,
  mode: EvaluationMode,
  options: EvaluateTraceOptions = {}
): Promise<EvaluationReport> {
  if (!process.env.OPENAI_API_KEY) {
    return evaluateWithHeuristics(trace, mode);
  }

  try {
    return await runEvaluationAgent(trace, mode, options);
  } catch (error) {
    console.error("Evaluation agent failed; falling back to heuristics.", error);
    return evaluateWithHeuristics(trace, mode);
  }
}
