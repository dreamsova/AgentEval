export type EvaluationMode =
  | "founder-demo"
  | "research-eval"
  | "ops-reliability";

export type EvaluationEngine = "agent" | "llm" | "heuristic";

export type MonitoringTier = "light" | "standard" | "deep";

export type EvaluationFallbackPolicy =
  | "demo-continuity"
  | "strict-no-fallback"
  | "explicit-heuristic";

export type ModelCallTelemetry = {
  index: number;
  purpose: "diagnostic" | "final_synthesis";
  status: "succeeded" | "failed";
  requested_model: string;
  returned_model: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

export type EvaluationRunMetadata = {
  run_id: string;
  input_hash: string;
  trace_schema_version: string;
  trace_adapter_version: string;
  trace_source_format: string;
  trace_lossy: boolean;
  prompt_version: string;
  toolset_version: string;
  rubric_version: string;
  weights_version: string;
  requested_model: string | null;
  returned_model: string | null;
  model_calls: ModelCallTelemetry[];
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    complete: boolean;
  };
  total_model_time_ms: number;
  total_tool_time_ms: number;
  total_wall_time_ms: number;
  calls: {
    model: number;
    tool: number;
  };
  fallback_policy: EvaluationFallbackPolicy;
  fallback_reason: string | null;
  degraded: boolean;
  degradation_reason: string | null;
};

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
  requested_model: string;
  returned_model: string | null;
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
  degraded: boolean;
  degradation_reason: string | null;
  evaluation_mode: EvaluationMode;
  generated_at: string;
  run_metadata: EvaluationRunMetadata;
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
