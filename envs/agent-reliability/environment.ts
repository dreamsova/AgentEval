import path from "node:path";

import type { JsonValue } from "@/lib/trace";

import type {
  AgentAction,
  EnvironmentEvent,
  EnvironmentObservation,
  EnvironmentStateSnapshot,
  EnvironmentStep,
  EnvironmentTask,
  SubmissionReport,
  TestRun,
  ToolResult
} from "./types";
import { evaluateTaskAssertions, verifyTerminalState } from "./verifier";

function cloneFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right))
  );
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)])
    );
  }
  return value;
}

function cloneSubmission(report: SubmissionReport | null): SubmissionReport | null {
  return report
    ? { ...report, artifacts: [...report.artifacts] }
    : null;
}

function cloneTestRun(testRun: TestRun | null): TestRun | null {
  return testRun
    ? {
        ...testRun,
        assertions: testRun.assertions.map((assertion) => ({ ...assertion }))
      }
    : null;
}

function cloneAction(action: AgentAction): AgentAction {
  if (action.type === "submit") {
    return {
      ...action,
      report: cloneSubmission(action.report) as SubmissionReport
    };
  }
  return { ...action };
}

function cloneToolResult(result: ToolResult): ToolResult {
  return {
    ...result,
    ...(result.data === undefined ? {} : { data: cloneJsonValue(result.data) })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertValidAgentAction(action: unknown): asserts action is AgentAction {
  if (!isRecord(action) || typeof action.type !== "string") {
    throw new TypeError("agent action must be an object with a supported type");
  }
  if (action.type === "read_file") {
    if (typeof action.path !== "string") {
      throw new TypeError("read_file.path must be a string");
    }
    return;
  }
  if (action.type === "write_file") {
    if (typeof action.path !== "string" || typeof action.content !== "string") {
      throw new TypeError("write_file path and content must be strings");
    }
    return;
  }
  if (action.type === "run_tests") {
    return;
  }
  if (action.type === "submit") {
    const report = action.report;
    if (
      !isRecord(report) ||
      (report.status !== "completed" &&
        report.status !== "partial" &&
        report.status !== "blocked") ||
      (typeof report.tests_passed !== "boolean" &&
        report.tests_passed !== null) ||
      !Array.isArray(report.artifacts) ||
      !report.artifacts.every((item) => typeof item === "string") ||
      typeof report.summary !== "string"
    ) {
      throw new TypeError("submit.report does not match the submission schema");
    }
    return;
  }
  throw new TypeError(`unsupported agent action type: ${action.type}`);
}

export function canonicalizeEnvironmentPath(rawPath: string): string {
  if (
    rawPath.length === 0 ||
    rawPath.trim() !== rawPath ||
    rawPath.includes("\\") ||
    rawPath.includes("\0") ||
    path.posix.isAbsolute(rawPath)
  ) {
    throw new Error("path must be a non-empty canonical relative POSIX path");
  }
  const normalized = path.posix.normalize(rawPath);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== rawPath
  ) {
    throw new Error("path traversal and non-canonical paths are not allowed");
  }
  return normalized;
}

function actionData(action: AgentAction): JsonValue {
  if (action.type === "run_tests") {
    return {};
  }
  if (action.type === "submit") {
    return action.report;
  }
  if (action.type === "read_file") {
    return { path: action.path };
  }
  return { path: action.path, content: action.content };
}

export class AgentReliabilityEnvironment {
  private readonly task: EnvironmentTask;
  private files: Record<string, string> = {};
  private revision = 0;
  private stepCount = 0;
  private lastTest: TestRun | null = null;
  private submission: SubmissionReport | null = null;
  private terminated = false;
  private terminationReason: "submitted" | "max_steps" | null = null;
  private events: EnvironmentEvent[] = [];

  constructor(task: EnvironmentTask) {
    if (task.max_steps < 1 || !Number.isInteger(task.max_steps)) {
      throw new Error("max_steps must be a positive integer");
    }
    for (const filePath of [
      ...Object.keys(task.initial_files),
      ...Object.keys(task.reference_solution),
      ...task.assertions.map((assertion) => assertion.path)
    ]) {
      canonicalizeEnvironmentPath(filePath);
    }
    if (task.assertions.length === 0) {
      throw new Error("at least one task assertion is required");
    }
    this.task = {
      ...task,
      initial_files: cloneFiles(task.initial_files),
      assertions: task.assertions.map((assertion) =>
        assertion.type === "json_equals"
          ? { ...assertion, expected: cloneJsonValue(assertion.expected) }
          : { ...assertion }
      ),
      reference_solution: cloneFiles(task.reference_solution)
    };
    this.reset();
  }

  reset(): EnvironmentObservation {
    this.files = cloneFiles(this.task.initial_files);
    this.revision = 0;
    this.stepCount = 0;
    this.lastTest = null;
    this.submission = null;
    this.terminated = false;
    this.terminationReason = null;
    this.events = [];
    return this.observe();
  }

  observe(): EnvironmentObservation {
    return {
      task_id: this.task.id,
      instruction: this.task.instruction,
      files: Object.keys(this.files).sort(),
      revision: this.revision,
      step_count: this.stepCount,
      remaining_steps: Math.max(this.task.max_steps - this.stepCount, 0),
      last_test: this.lastTest
        ? {
            revision: this.lastTest.revision,
            passed: this.lastTest.passed,
            fresh: this.lastTest.revision === this.revision
          }
        : null,
      terminated: this.terminated
    };
  }

  snapshot(): EnvironmentStateSnapshot {
    return {
      files: cloneFiles(this.files),
      revision: this.revision,
      step_count: this.stepCount,
      last_test: cloneTestRun(this.lastTest),
      submission: cloneSubmission(this.submission),
      terminated: this.terminated,
      termination_reason: this.terminationReason,
      events: this.events.map((event) => ({
        ...event,
        action: cloneAction(event.action),
        result: cloneToolResult(event.result)
      }))
    };
  }

  private toolFailure(action: AgentAction, message: string): ToolResult {
    return {
      ok: false,
      tool: action.type,
      code: "INVALID_ACTION",
      message,
      data: actionData(action)
    };
  }

  private execute(action: AgentAction): ToolResult {
    if (action.type === "read_file") {
      try {
        const filePath = canonicalizeEnvironmentPath(action.path);
        if (!Object.hasOwn(this.files, filePath)) {
          return {
            ok: false,
            tool: action.type,
            code: "FILE_NOT_FOUND",
            message: `${filePath} does not exist`,
            data: { path: filePath }
          };
        }
        const content = this.files[filePath];
        return {
          ok: true,
          tool: action.type,
          code: "FILE_READ",
          message: `${filePath} read`,
          data: { path: filePath, content }
        };
      } catch (error) {
        return this.toolFailure(
          action,
          error instanceof Error ? error.message : "invalid path"
        );
      }
    }

    if (action.type === "write_file") {
      try {
        const filePath = canonicalizeEnvironmentPath(action.path);
        this.files = cloneFiles(
          Object.fromEntries([
            ...Object.entries(this.files).filter(([key]) => key !== filePath),
            [filePath, action.content]
          ])
        );
        this.revision += 1;
        return {
          ok: true,
          tool: action.type,
          code: "FILE_WRITTEN",
          message: `${filePath} written at revision ${this.revision}`,
          data: {
            path: filePath,
            bytes: Buffer.byteLength(action.content, "utf8"),
            revision: this.revision
          }
        };
      } catch (error) {
        return this.toolFailure(
          action,
          error instanceof Error ? error.message : "invalid path"
        );
      }
    }

    if (action.type === "run_tests") {
      const assertions = evaluateTaskAssertions(this.task, this.files);
      const passed = assertions.every((assertion) => assertion.passed);
      this.lastTest = { revision: this.revision, passed, assertions };
      return {
        ok: passed,
        tool: action.type,
        code: passed ? "TESTS_PASSED" : "TESTS_FAILED",
        message: passed ? "all assertions passed" : "one or more assertions failed",
        data: {
          revision: this.revision,
          passed,
          assertions
        }
      };
    }

    this.submission = cloneSubmission(action.report);
    this.terminated = true;
    this.terminationReason = "submitted";
    return {
      ok: true,
      tool: action.type,
      code: "SUBMISSION_RECORDED",
      message: "final report recorded",
      data: action.report
    };
  }

  step(action: AgentAction): EnvironmentStep {
    if (this.terminated) {
      throw new Error("cannot step a terminated environment; call reset first");
    }
    assertValidAgentAction(action);

    const revisionBefore = this.revision;
    const result = this.execute(action);
    this.stepCount += 1;
    if (!this.terminated && this.stepCount >= this.task.max_steps) {
      this.terminated = true;
      this.terminationReason = "max_steps";
    }
    const event: EnvironmentEvent = {
      index: this.events.length,
      call_id: `env-call-${this.events.length + 1}`,
      action: cloneAction(action),
      result: cloneToolResult(result),
      revision_before: revisionBefore,
      revision_after: this.revision
    };
    this.events.push(event);

    const verification = this.terminated
      ? verifyTerminalState(this.task, this.snapshot())
      : null;
    return {
      observation: this.observe(),
      result,
      reward: verification?.reward ?? 0,
      terminated: this.terminated,
      verification
    };
  }
}
