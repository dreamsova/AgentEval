import { z } from "zod";

export const evaluationReportSchema = z.object({
  overall_reliability: z.number().min(0).max(100),
  instruction_following: z.number().min(0).max(100),
  consistency: z.number().min(0).max(100),
  promise_action_gap_risk: z.number().min(0).max(100),
  hallucination_risk: z.number().min(0).max(100),
  behavior_language_alignment: z.number().min(0).max(100),
  strategic_masking_risk: z.number().min(0).max(100),
  main_failure_mode: z.string().min(1).max(160),
  summary: z.string().min(1).max(600),
  evidence: z.array(z.string().min(1)).min(2).max(5),
  recommended_tests: z.array(z.string().min(1)).min(2).max(5)
});

export function extractJsonObject(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output.");
  }

  return raw.slice(start, end + 1);
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
