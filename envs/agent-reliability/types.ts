import type { JsonValue } from "@/lib/trace";

export type FileExistsAssertion = {
  id: string;
  type: "file_exists";
  path: string;
};

export type FileEqualsAssertion = {
  id: string;
  type: "file_equals";
  path: string;
  expected: string;
};

export type JsonEqualsAssertion = {
  id: string;
  type: "json_equals";
  path: string;
  expected: JsonValue;
};

export type TaskAssertion =
  | FileExistsAssertion
  | FileEqualsAssertion
  | JsonEqualsAssertion;

export type EnvironmentTask = {
  id: string;
  instruction: string;
  initial_files: Record<string, string>;
  assertions: TaskAssertion[];
  /** Used only by scripted reference policies, never exposed in observations. */
  reference_solution: Record<string, string>;
  max_steps: number;
};

export type SubmissionStatus = "completed" | "partial" | "blocked";

export type SubmissionReport = {
  status: SubmissionStatus;
  tests_passed: boolean | null;
  artifacts: string[];
  summary: string;
};

export type AgentAction =
  | { type: "read_file"; path: string }
  | { type: "write_file"; path: string; content: string }
  | { type: "run_tests" }
  | { type: "submit"; report: SubmissionReport };

export type AssertionResult = {
  assertion_id: string;
  type: TaskAssertion["type"];
  path: string;
  passed: boolean;
  message: string;
};

export type TestRun = {
  revision: number;
  passed: boolean;
  assertions: AssertionResult[];
};

export type EnvironmentObservation = {
  task_id: string;
  instruction: string;
  files: string[];
  revision: number;
  step_count: number;
  remaining_steps: number;
  last_test: { revision: number; passed: boolean; fresh: boolean } | null;
  terminated: boolean;
};

export type ToolResult = {
  ok: boolean;
  tool: AgentAction["type"];
  code: string;
  message: string;
  data?: JsonValue;
};

export type ClaimAlignmentChecks = {
  status_matches: boolean;
  tests_claim_matches: boolean;
  artifact_claims_match: boolean;
};

export type TerminalVerification = {
  reward: number;
  components: {
    artifact_correctness: number;
    fresh_tests_passing: number;
    structured_report_alignment: number;
  };
  weighted_components: {
    artifact_correctness: number;
    fresh_tests_passing: number;
    structured_report_alignment: number;
  };
  assertion_results: AssertionResult[];
  fresh_test: boolean;
  actual_status: SubmissionStatus;
  claim_alignment: ClaimAlignmentChecks;
};

export type EnvironmentEvent = {
  index: number;
  call_id: string;
  action: AgentAction;
  result: ToolResult;
  revision_before: number;
  revision_after: number;
};

export type EnvironmentStateSnapshot = {
  files: Record<string, string>;
  revision: number;
  step_count: number;
  last_test: TestRun | null;
  submission: SubmissionReport | null;
  terminated: boolean;
  termination_reason: "submitted" | "max_steps" | null;
  events: EnvironmentEvent[];
};

export type EnvironmentStep = {
  observation: EnvironmentObservation;
  result: ToolResult;
  reward: number;
  terminated: boolean;
  verification: TerminalVerification | null;
};

export type ScriptedPolicyId =
  | "honest"
  | "false_claimer"
  | "stale_test_exploiter"
  | "wrong_path_shortcut"
  | "honest_blocker";

export type ScriptedPolicy = {
  id: ScriptedPolicyId;
  description: string;
  plan(task: EnvironmentTask): AgentAction[];
};

export type RolloutTransition = {
  observation_before: EnvironmentObservation;
  action: AgentAction;
  step: EnvironmentStep;
};

export type RolloutResult = {
  task: EnvironmentTask;
  policy_id: ScriptedPolicyId;
  transitions: RolloutTransition[];
  final_state: EnvironmentStateSnapshot;
  terminal_reward: number;
  verification: TerminalVerification;
};
