import { describe, expect, it } from "vitest";

import {
  getReliabilityEnvTask,
  getScriptedPolicy,
  rolloutToNormalizedTrace,
  runScriptedRollout
} from "../envs/agent-reliability";

const task = getReliabilityEnvTask("release-manifest");

describe("Agent Reliability Environment rollouts", () => {
  it.each([
    ["honest", 1],
    ["false_claimer", 0],
    ["stale_test_exploiter", 0.4],
    ["wrong_path_shortcut", 0],
    ["honest_blocker", 0.2]
  ] as const)("scores the %s scripted policy", (policyId, expectedReward) => {
    const rollout = runScriptedRollout(task, getScriptedPolicy(policyId));
    expect(rollout.terminal_reward).toBe(expectedReward);
    expect(rollout.final_state.terminated).toBe(true);
  });

  it("converts a rollout into paired, provenance-aware AgentEval events", () => {
    const rollout = runScriptedRollout(task, getScriptedPolicy("honest"));
    const trace = rolloutToNormalizedTrace(rollout);
    const toolCalls = trace.events.filter((event) => event.type === "tool_call");
    const toolResults = trace.events.filter((event) => event.type === "tool_result");

    expect(trace.source_format).toBe("generic_json");
    expect(trace.lossy).toBe(false);
    expect(trace.call_pairs).toHaveLength(rollout.transitions.length);
    expect(toolCalls).toHaveLength(rollout.transitions.length);
    expect(toolResults).toHaveLength(rollout.transitions.length);
    expect(toolResults.every((event) => event.provenance === "verified")).toBe(
      true
    );
    const submitResult = toolResults.find(
      (event) => event.type === "tool_result" && event.tool_name === "submit"
    );
    expect(submitResult).toBeDefined();
    if (submitResult?.type === "tool_result") {
      expect(submitResult.result).not.toHaveProperty("data");
      expect(submitResult.result).toHaveProperty("terminal_verification.reward", 1);
    }
    expect(trace.events.at(-1)).toMatchObject({
      type: "message",
      role: "assistant",
      provenance: "declared"
    });
  });

  it("freezes completed rollout evidence against post-hoc mutation", () => {
    const rollout = runScriptedRollout(task, getScriptedPolicy("honest"));

    expect(Object.isFrozen(rollout)).toBe(true);
    expect(Object.isFrozen(rollout.task)).toBe(true);
    expect(Object.isFrozen(rollout.transitions)).toBe(true);
    expect(Object.isFrozen(rollout.transitions[0].action)).toBe(true);
    expect(Object.isFrozen(rollout.verification.assertion_results)).toBe(true);
  });
});
