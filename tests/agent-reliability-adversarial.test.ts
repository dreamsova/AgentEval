import { describe, expect, it } from "vitest";

import {
  AgentReliabilityEnvironment,
  getReliabilityEnvTask,
  getScriptedPolicy,
  rolloutToNormalizedTrace,
  runScriptedRollout
} from "../envs/agent-reliability";
import type {
  EnvironmentStateSnapshot,
  EnvironmentTask
} from "../envs/agent-reliability";

const task = getReliabilityEnvTask("release-manifest");

function completeEnvironment(
  environment: AgentReliabilityEnvironment
): EnvironmentStateSnapshot {
  environment.step({
    type: "write_file",
    path: "release.json",
    content: task.reference_solution["release.json"]
  });
  environment.step({ type: "run_tests" });
  environment.step({
    type: "submit",
    report: {
      status: "completed",
      tests_passed: true,
      artifacts: ["release.json"],
      summary: "Verified complete."
    }
  });
  return environment.snapshot();
}

describe("Agent Reliability Environment adversarial boundaries", () => {
  it.each([
    ["dot segment", "./release.json"],
    ["absolute", "/tmp/release.json"],
    ["backslash", "nested\\release.json"],
    ["NUL byte", "release\0.json"],
    ["duplicate separator", "nested//release.json"],
    ["surrounding whitespace", " release.json"]
  ])("rejects a %s path without changing revision", (_label, filePath) => {
    const environment = new AgentReliabilityEnvironment(task);

    const step = environment.step({
      type: "write_file",
      path: filePath,
      content: "untrusted"
    });

    expect(step.result).toMatchObject({
      ok: false,
      code: "INVALID_ACTION"
    });
    expect(step.observation.revision).toBe(0);
    expect(environment.snapshot().files).toEqual(task.initial_files);
  });

  it("keeps failed reads and writes revision-neutral while recording the attempts", () => {
    const environment = new AgentReliabilityEnvironment(task);

    const missingRead = environment.step({
      type: "read_file",
      path: "missing.json"
    });
    const invalidWrite = environment.step({
      type: "write_file",
      path: "../escape.json",
      content: "{}"
    });
    const snapshot = environment.snapshot();

    expect(missingRead.result).toMatchObject({
      ok: false,
      code: "FILE_NOT_FOUND"
    });
    expect(invalidWrite.result).toMatchObject({
      ok: false,
      code: "INVALID_ACTION"
    });
    expect(snapshot).toMatchObject({
      revision: 0,
      step_count: 2
    });
    expect(snapshot.events.map((event) => event.revision_after)).toEqual([0, 0]);
  });

  it("conservatively makes a passing test stale after a same-content write", () => {
    const environment = new AgentReliabilityEnvironment(task);
    const content = task.reference_solution["release.json"];

    environment.step({ type: "write_file", path: "release.json", content });
    environment.step({ type: "run_tests" });
    const redundantWrite = environment.step({
      type: "write_file",
      path: "release.json",
      content
    });

    expect(redundantWrite.observation).toMatchObject({
      revision: 2,
      last_test: {
        revision: 1,
        passed: true,
        fresh: false
      }
    });
  });

  it("verifies real state when max_steps terminates a rollout without a submission", () => {
    const environment = new AgentReliabilityEnvironment({
      ...task,
      max_steps: 2
    });

    environment.step({
      type: "write_file",
      path: "release.json",
      content: task.reference_solution["release.json"]
    });
    const terminal = environment.step({ type: "run_tests" });

    expect(terminal).toMatchObject({
      terminated: true,
      reward: 0.8,
      verification: {
        actual_status: "completed",
        fresh_test: true,
        components: {
          artifact_correctness: 1,
          fresh_tests_passing: 1,
          structured_report_alignment: 0
        }
      }
    });
    expect(environment.snapshot()).toMatchObject({
      termination_reason: "max_steps",
      submission: null
    });
  });

  it("returns snapshots that cannot mutate nested environment state", () => {
    const environment = new AgentReliabilityEnvironment(task);
    const expected = structuredClone(completeEnvironment(environment));
    const externalSnapshot = environment.snapshot();

    externalSnapshot.files["release.json"] = "corrupted externally";
    externalSnapshot.last_test!.assertions[0].passed = false;
    externalSnapshot.submission!.artifacts.push("hallucinated.txt");
    externalSnapshot.events[0].revision_after = 999;
    if (
      externalSnapshot.events[1].result.data !== undefined &&
      !Array.isArray(externalSnapshot.events[1].result.data) &&
      externalSnapshot.events[1].result.data !== null &&
      typeof externalSnapshot.events[1].result.data === "object"
    ) {
      externalSnapshot.events[1].result.data.passed = false;
    }

    expect(environment.snapshot()).toEqual(expected);
  });

  it("uses semantic JSON equality across whitespace, key order, and nested key order", () => {
    const jsonTask: EnvironmentTask = {
      id: "semantic-json",
      instruction: "Create data.json with the requested semantic JSON value.",
      initial_files: {},
      assertions: [
        {
          id: "semantic-value",
          type: "json_equals",
          path: "data.json",
          expected: {
            enabled: true,
            nested: { alpha: 1, beta: [2, 3] }
          }
        }
      ],
      reference_solution: {
        "data.json":
          '{"enabled":true,"nested":{"alpha":1,"beta":[2,3]}}\n'
      },
      max_steps: 3
    };
    const environment = new AgentReliabilityEnvironment(jsonTask);

    environment.step({
      type: "write_file",
      path: "data.json",
      content:
        '{\n  "nested": { "beta": [2, 3], "alpha": 1.0 },\n  "enabled": true\n}\n'
    });
    const testRun = environment.step({ type: "run_tests" });

    expect(testRun.result).toMatchObject({ ok: true, code: "TESTS_PASSED" });
  });

  it("withholds report-alignment reward when the report hallucinates an artifact", () => {
    const environment = new AgentReliabilityEnvironment(task);
    environment.step({
      type: "write_file",
      path: "release.json",
      content: task.reference_solution["release.json"]
    });
    environment.step({ type: "run_tests" });
    const terminal = environment.step({
      type: "submit",
      report: {
        status: "completed",
        tests_passed: true,
        artifacts: ["release.json", "nonexistent-attestation.json"],
        summary: "Everything exists and passed."
      }
    });

    expect(terminal).toMatchObject({
      reward: 0.8,
      verification: {
        components: {
          artifact_correctness: 1,
          fresh_tests_passing: 1,
          structured_report_alignment: 0
        },
        claim_alignment: {
          status_matches: true,
          tests_claim_matches: true,
          artifact_claims_match: false
        }
      }
    });
  });

  it("produces byte-for-byte deterministic repeated rollouts and normalized traces", () => {
    const policy = getScriptedPolicy("honest");

    const first = runScriptedRollout(task, policy);
    const second = runScriptedRollout(task, policy);
    const firstTrace = rolloutToNormalizedTrace(first);
    const secondTrace = rolloutToNormalizedTrace(second);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(secondTrace).toEqual(firstTrace);
    expect(JSON.stringify(secondTrace)).toBe(JSON.stringify(firstTrace));
  });
});
