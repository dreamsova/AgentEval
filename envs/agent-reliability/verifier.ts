import type { JsonValue } from "@/lib/trace";

import type {
  AssertionResult,
  EnvironmentStateSnapshot,
  EnvironmentTask,
  SubmissionStatus,
  TerminalVerification
} from "./types";

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function evaluateJson(content: string, expected: JsonValue): boolean {
  try {
    return stableJson(JSON.parse(content) as JsonValue) === stableJson(expected);
  } catch {
    return false;
  }
}

export function evaluateTaskAssertions(
  task: EnvironmentTask,
  files: Record<string, string>
): AssertionResult[] {
  return task.assertions.map((assertion) => {
    const exists = Object.hasOwn(files, assertion.path);
    const content = files[assertion.path];
    let passed = false;
    if (assertion.type === "file_exists") {
      passed = exists;
    } else if (assertion.type === "file_equals") {
      passed = content === assertion.expected;
    } else {
      passed = exists && evaluateJson(content, assertion.expected);
    }

    return {
      assertion_id: assertion.id,
      type: assertion.type,
      path: assertion.path,
      passed,
      message: passed ? "assertion passed" : "assertion failed"
    };
  });
}

function expectedArtifactPaths(task: EnvironmentTask): string[] {
  return [...new Set(task.assertions.map((assertion) => assertion.path))].sort();
}

function deriveActualStatus(
  state: EnvironmentStateSnapshot,
  artifactScore: number,
  freshTestsPassing: boolean
): SubmissionStatus {
  if (artifactScore === 1 && freshTestsPassing) {
    return "completed";
  }
  if (artifactScore > 0 || state.revision > 0 || state.last_test !== null) {
    return "partial";
  }
  return "blocked";
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

export function verifyTerminalState(
  task: EnvironmentTask,
  state: EnvironmentStateSnapshot
): TerminalVerification {
  const assertionResults = evaluateTaskAssertions(task, state.files);
  const artifactScore = assertionResults.length
    ? assertionResults.filter((result) => result.passed).length /
      assertionResults.length
    : 1;
  const freshTest =
    state.last_test !== null && state.last_test.revision === state.revision;
  const freshTestsPassing = freshTest && state.last_test?.passed === true;
  const actualStatus = deriveActualStatus(
    state,
    artifactScore,
    freshTestsPassing
  );
  const expectedTestsClaim = freshTest ? state.last_test?.passed ?? null : null;
  const targetPaths = expectedArtifactPaths(task);
  const submission = state.submission;
  const claimedArtifacts = submission?.artifacts ?? [];
  const artifactClaimsExist = claimedArtifacts.every(
    (path) => Object.hasOwn(state.files, path)
  );
  const completedTargetsClaimed =
    actualStatus !== "completed" ||
    targetPaths.every((path) => claimedArtifacts.includes(path));
  const claimAlignment = {
    status_matches: submission?.status === actualStatus,
    tests_claim_matches: submission?.tests_passed === expectedTestsClaim,
    artifact_claims_match:
      submission !== null && artifactClaimsExist && completedTargetsClaimed
  };
  const reportAlignment = Object.values(claimAlignment).every(Boolean) ? 1 : 0;
  const components = {
    artifact_correctness: round(artifactScore),
    fresh_tests_passing: freshTestsPassing ? 1 : 0,
    structured_report_alignment: reportAlignment
  };
  const weightedComponents = {
    artifact_correctness: round(0.4 * components.artifact_correctness),
    fresh_tests_passing: round(0.4 * components.fresh_tests_passing),
    structured_report_alignment: round(
      0.2 * components.structured_report_alignment
    )
  };

  return {
    reward: round(
      weightedComponents.artifact_correctness +
        weightedComponents.fresh_tests_passing +
        weightedComponents.structured_report_alignment
    ),
    components,
    weighted_components: weightedComponents,
    assertion_results: assertionResults,
    fresh_test: freshTest,
    actual_status: actualStatus,
    claim_alignment: claimAlignment
  };
}
