import { normalizeTrace, type JsonValue, type NormalizedTrace } from "@/lib/trace";

import type { AgentAction, RolloutResult } from "./types";

type GenericTraceEvent = Record<string, JsonValue>;

function actionArguments(action: AgentAction): JsonValue {
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

export function rolloutToGenericTrace(rollout: RolloutResult): {
  events: GenericTraceEvent[];
} {
  const events: GenericTraceEvent[] = [
    {
      event_id: "env-task",
      type: "message",
      role: "user",
      content: rollout.task.instruction,
      status: "succeeded",
      provenance: "recorded"
    }
  ];

  for (const [index, transition] of rollout.transitions.entries()) {
    const callId = `env-call-${index + 1}`;
    const verifiedResult =
      transition.action.type === "submit"
        ? {
            ok: transition.step.result.ok,
            tool: transition.step.result.tool,
            code: transition.step.result.code,
            message: transition.step.result.message
          }
        : transition.step.result;
    events.push({
      event_id: `${callId}:call`,
      type: "tool_call",
      call_id: callId,
      tool_name: transition.action.type,
      arguments: actionArguments(transition.action),
      status: "succeeded",
      provenance: "recorded"
    });
    events.push({
      event_id: `${callId}:result`,
      type: "tool_result",
      call_id: callId,
      tool_name: transition.action.type,
      result: {
        ...verifiedResult,
        revision: transition.step.observation.revision,
        terminated: transition.step.terminated,
        ...(transition.step.verification
          ? { terminal_verification: transition.step.verification }
          : {})
      },
      status: transition.step.result.ok ? "succeeded" : "failed",
      provenance: "verified"
    });
    events.push({
      event_id: `${callId}:state`,
      type: "state_change",
      state: {
        name: "agent_reliability_environment",
        from: {
          revision: transition.observation_before.revision,
          terminated: transition.observation_before.terminated
        },
        to: {
          revision: transition.step.observation.revision,
          terminated: transition.step.terminated
        }
      },
      status: "succeeded",
      provenance: "verified"
    });
  }

  const report = rollout.final_state.submission;
  if (report) {
    events.push({
      event_id: "env-final-report",
      type: "message",
      role: "assistant",
      content: report,
      status: "succeeded",
      provenance: "declared"
    });
  }
  return { events };
}

export function rolloutToNormalizedTrace(
  rollout: RolloutResult
): NormalizedTrace {
  return normalizeTrace(rolloutToGenericTrace(rollout), {
    format: "generic_json"
  });
}
