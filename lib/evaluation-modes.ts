import type { EvaluationMode } from "@/lib/types";

export const evaluationModeIds = [
  "founder-demo",
  "research-eval",
  "ops-reliability"
] as const satisfies readonly EvaluationMode[];

export const evaluationModes: Array<{
  id: EvaluationMode;
  label: string;
  summary: string;
}> = [
  {
    id: "founder-demo",
    label: "Founder demo",
    summary:
      "Optimized for quick, legible reports that highlight the biggest behavioral risk in under 30 seconds."
  },
  {
    id: "research-eval",
    label: "Research eval",
    summary:
      "More conservative and explanation-heavy. Emphasizes evidence quality, internal consistency, and explicit uncertainty."
  },
  {
    id: "ops-reliability",
    label: "Ops reliability",
    summary:
      "Prioritizes execution proof, escalation behavior, and whether claimed completion is backed by observable artifacts."
  }
];

export function getEvaluationModeCopy(mode: EvaluationMode) {
  return (
    evaluationModes.find((item) => item.id === mode) ?? evaluationModes[0]
  );
}
