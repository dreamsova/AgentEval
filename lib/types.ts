export type EvaluationMode =
  | "founder-demo"
  | "research-eval"
  | "ops-reliability";

export type EvaluationEngine = "agent" | "llm" | "heuristic";

export type MonitoringTier = "light" | "standard" | "deep";

export type AgentStep = {
  index: number;
  tool: string;
  decision: string;
  observation: string;
  status: "completed" | "failed";
  duration_ms: number;
};

export type AgentRun = {
  objective: string;
  monitoring_tier: MonitoringTier;
  steps: AgentStep[];
  tools_used: string[];
  stop_reason: string;
  duration_ms: number;
  model: string;
};

export type EvaluationStreamEvent =
  | {
      type: "agent_started";
      objective: string;
    }
  | {
      type: "agent_step";
      step: AgentStep;
    }
  | {
      type: "complete";
      report: EvaluationReport;
    }
  | {
      type: "error";
      error: string;
    };

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
  agent_run?: AgentRun;
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
