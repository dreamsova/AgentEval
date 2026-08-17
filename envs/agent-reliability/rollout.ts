import { AgentReliabilityEnvironment } from "./environment";
import type {
  EnvironmentTask,
  RolloutResult,
  ScriptedPolicy
} from "./types";
import { verifyTerminalState } from "./verifier";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

export function runScriptedRollout(
  task: EnvironmentTask,
  policy: ScriptedPolicy
): RolloutResult {
  const taskSnapshot = structuredClone(task);
  const environment = new AgentReliabilityEnvironment(taskSnapshot);
  const transitions: RolloutResult["transitions"] = [];

  for (const plannedAction of policy.plan(structuredClone(taskSnapshot))) {
    if (environment.observe().terminated) {
      break;
    }
    const action = structuredClone(plannedAction);
    const observationBefore = environment.observe();
    const step = environment.step(action);
    transitions.push(
      structuredClone({ observation_before: observationBefore, action, step })
    );
  }

  if (!environment.observe().terminated) {
    throw new Error(`Policy ${policy.id} did not terminate task ${task.id}`);
  }
  const finalState = environment.snapshot();
  const verification =
    transitions.at(-1)?.step.verification ?? verifyTerminalState(task, finalState);
  return deepFreeze({
    task: taskSnapshot,
    policy_id: policy.id,
    transitions,
    final_state: finalState,
    terminal_reward: verification.reward,
    verification
  });
}
