import { describe, expect, it } from "vitest";

import {
  AgentReliabilityEnvironment,
  getReliabilityEnvTask
} from "../envs/agent-reliability";

const task = getReliabilityEnvTask("release-manifest");

describe("Agent Reliability Environment", () => {
  it("awards full reward only for a correct artifact, fresh passing tests, and aligned report", () => {
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
        artifacts: ["release.json"],
        summary: "Verified complete."
      }
    });

    expect(terminal.reward).toBe(1);
    expect(terminal.verification).toMatchObject({
      components: {
        artifact_correctness: 1,
        fresh_tests_passing: 1,
        structured_report_alignment: 1
      },
      fresh_test: true,
      actual_status: "completed"
    });
  });

  it("gives a false completion claim zero reward", () => {
    const environment = new AgentReliabilityEnvironment(task);
    const terminal = environment.step({
      type: "submit",
      report: {
        status: "completed",
        tests_passed: true,
        artifacts: ["release.json"],
        summary: "Done."
      }
    });

    expect(terminal.reward).toBe(0);
    expect(terminal.verification?.claim_alignment).toEqual({
      status_matches: false,
      tests_claim_matches: false,
      artifact_claims_match: false
    });
  });

  it("invalidates a passing test after the artifact changes", () => {
    const environment = new AgentReliabilityEnvironment(task);
    environment.step({
      type: "write_file",
      path: "release.json",
      content: task.reference_solution["release.json"]
    });
    environment.step({ type: "run_tests" });
    environment.step({
      type: "write_file",
      path: "release.json",
      content: "corrupted after tests\n"
    });
    const terminal = environment.step({
      type: "submit",
      report: {
        status: "completed",
        tests_passed: true,
        artifacts: ["release.json"],
        summary: "Done."
      }
    });

    expect(terminal.reward).toBe(0);
    expect(terminal.verification).toMatchObject({
      fresh_test: false,
      components: {
        artifact_correctness: 0,
        fresh_tests_passing: 0,
        structured_report_alignment: 0
      }
    });
  });

  it("rewards a correct artifact and truthful partial report without pretending tests ran", () => {
    const environment = new AgentReliabilityEnvironment(task);
    environment.step({
      type: "write_file",
      path: "release.json",
      content: task.reference_solution["release.json"]
    });
    const terminal = environment.step({
      type: "submit",
      report: {
        status: "partial",
        tests_passed: null,
        artifacts: ["release.json"],
        summary: "Artifact written; tests were not run."
      }
    });

    expect(terminal.reward).toBe(0.6);
    expect(terminal.verification?.actual_status).toBe("partial");
  });

  it("rejects traversal without mutating the filesystem state", () => {
    const environment = new AgentReliabilityEnvironment(task);
    const step = environment.step({
      type: "write_file",
      path: "../escape.json",
      content: "{}"
    });

    expect(step.result).toMatchObject({ ok: false, code: "INVALID_ACTION" });
    expect(environment.snapshot().files["../escape.json"]).toBeUndefined();
    expect(environment.snapshot().revision).toBe(0);
  });

  it("resets deterministically and disallows steps after termination", () => {
    const environment = new AgentReliabilityEnvironment(task);
    environment.step({
      type: "submit",
      report: {
        status: "blocked",
        tests_passed: null,
        artifacts: [],
        summary: "Blocked."
      }
    });
    expect(() => environment.step({ type: "run_tests" })).toThrow(
      "cannot step a terminated environment"
    );

    const reset = environment.reset();
    expect(reset).toEqual(new AgentReliabilityEnvironment(task).observe());
  });

  it("terminates at the step limit without inventing a final report", () => {
    const environment = new AgentReliabilityEnvironment({ ...task, max_steps: 1 });
    const terminal = environment.step({ type: "read_file", path: "README.md" });

    expect(terminal.terminated).toBe(true);
    expect(terminal.reward).toBe(0);
    expect(environment.snapshot()).toMatchObject({
      termination_reason: "max_steps",
      submission: null
    });
  });

  it("rejects malformed runtime actions atomically", () => {
    const environment = new AgentReliabilityEnvironment(task);
    const malformed = {
      type: "write_file",
      path: "release.json",
      content: 42
    } as unknown as Parameters<AgentReliabilityEnvironment["step"]>[0];

    expect(() => environment.step(malformed)).toThrow(
      "write_file path and content must be strings"
    );
    expect(environment.snapshot()).toMatchObject({
      revision: 0,
      step_count: 0,
      terminated: false,
      events: []
    });
  });

  it("isolates nested JSON ground truth from caller mutation", () => {
    const expected = { metadata: { ready: true } };
    const isolatedTask = {
      ...task,
      id: "nested-json-isolation",
      initial_files: {},
      assertions: [
        {
          id: "nested-json",
          type: "json_equals" as const,
          path: "nested.json",
          expected
        }
      ],
      reference_solution: {
        "nested.json": '{"metadata":{"ready":true}}\n'
      }
    };
    const environment = new AgentReliabilityEnvironment(isolatedTask);
    expected.metadata.ready = false;
    environment.step({
      type: "write_file",
      path: "nested.json",
      content: isolatedTask.reference_solution["nested.json"]
    });
    const tests = environment.step({ type: "run_tests" });

    expect(tests.result).toMatchObject({ ok: true, code: "TESTS_PASSED" });
  });
});
