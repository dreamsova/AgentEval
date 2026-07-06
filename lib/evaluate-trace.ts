import { evaluateWithHeuristics } from "@/lib/heuristics";
import { evaluateWithOpenAI } from "@/lib/openai-evaluator";
import type { EvaluationMode, EvaluationReport } from "@/lib/types";

export async function evaluateTrace(
  trace: string,
  mode: EvaluationMode
): Promise<EvaluationReport> {
  if (!process.env.OPENAI_API_KEY) {
    return evaluateWithHeuristics(trace, mode);
  }

  try {
    return await evaluateWithOpenAI(trace, mode);
  } catch (error) {
    console.error("OpenAI evaluation failed; falling back to heuristics.", error);
    return evaluateWithHeuristics(trace, mode);
  }
}
