import { evaluateWithHeuristics } from "@/lib/heuristics";
import { evaluateWithOpenAI } from "@/lib/openai-evaluator";
import type { EvaluationReport } from "@/lib/types";

export async function evaluateTrace(trace: string): Promise<EvaluationReport> {
  if (!process.env.OPENAI_API_KEY) {
    return evaluateWithHeuristics(trace);
  }

  try {
    return await evaluateWithOpenAI(trace);
  } catch {
    return evaluateWithHeuristics(trace);
  }
}
