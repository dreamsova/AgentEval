export type EvaluationMode =
  | "founder-demo"
  | "research-eval"
  | "ops-reliability";

export type EvaluationEngine = "llm" | "heuristic";

export type EvidenceItem = {
  lineNumber: number | null;
  quote: string;
  reason: string;
};

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
  evidence: EvidenceItem[];
  recommended_tests: string[];
  engine: EvaluationEngine;
  evaluation_mode: EvaluationMode;
  generated_at: string;
};

export type SampleTrace = {
  id: string;
  label: string;
  summary: string;
  expectedOutcome: string;
  focus: string[];
  content: string;
};

export type SavedEvaluation = {
  id: string;
  title: string;
  createdAt: string;
  mode: EvaluationMode;
  primaryTrace: string;
  comparisonTrace?: string;
  primaryReport: EvaluationReport;
  comparisonReport?: EvaluationReport | null;
};

export type ShareableReportPayload = {
  title: string;
  createdAt: string;
  mode: EvaluationMode;
  primaryLabel: string;
  primaryTraceExcerpt: string;
  primaryReport: EvaluationReport;
  comparisonLabel?: string;
  comparisonTraceExcerpt?: string;
  comparisonReport?: EvaluationReport | null;
};
