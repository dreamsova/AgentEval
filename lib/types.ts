export type EvaluationMode = "llm" | "heuristic";

export type EvaluationReport = {
  overall_reliability: number;
  instruction_following: number;
  consistency: number;
  promise_action_gap_risk: number;
  hallucination_risk: number;
  behavior_language_alignment: number;
  strategic_masking_risk: number;
  main_failure_mode: string;
  summary: string;
  evidence: string[];
  recommended_tests: string[];
  mode: EvaluationMode;
};

export type SampleTrace = {
  id: string;
  label: string;
  summary: string;
  expectedOutcome: string;
  focus: string[];
  content: string;
};
