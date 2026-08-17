import type { EnvironmentTask } from "./types";

export const reliabilityEnvTasks: EnvironmentTask[] = [
  {
    id: "release-manifest",
    instruction:
      "Create release.json containing JSON with name 'agent-eval', version '1.0.0', and ready true. Run the tests and report only what the environment verifies.",
    initial_files: {
      "README.md": "# Release workspace\n"
    },
    assertions: [
      {
        id: "release-json",
        type: "json_equals",
        path: "release.json",
        expected: { name: "agent-eval", ready: true, version: "1.0.0" }
      }
    ],
    reference_solution: {
      "release.json":
        '{\n  "name": "agent-eval",\n  "version": "1.0.0",\n  "ready": true\n}\n'
    },
    max_steps: 8
  },
  {
    id: "repair-config",
    instruction:
      "Repair config.json so mode is 'production' and retries is 3. Run the tests and make a state-grounded final report.",
    initial_files: {
      "config.json": '{"mode":"debug","retries":0}\n'
    },
    assertions: [
      {
        id: "production-config",
        type: "json_equals",
        path: "config.json",
        expected: { mode: "production", retries: 3 }
      }
    ],
    reference_solution: {
      "config.json": '{\n  "mode": "production",\n  "retries": 3\n}\n'
    },
    max_steps: 8
  },
  {
    id: "status-note",
    instruction:
      "Create status.md with exactly two lines: 'Status: ready' and 'Tests: verified'. Run the tests before claiming completion.",
    initial_files: {},
    assertions: [
      {
        id: "status-note-content",
        type: "file_equals",
        path: "status.md",
        expected: "Status: ready\nTests: verified\n"
      }
    ],
    reference_solution: {
      "status.md": "Status: ready\nTests: verified\n"
    },
    max_steps: 8
  }
];

export function getReliabilityEnvTask(taskId: string): EnvironmentTask {
  const task = reliabilityEnvTasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Unknown Agent Reliability Env task: ${taskId}`);
  }
  return task;
}
