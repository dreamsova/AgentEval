import { scriptedPolicies } from "./policies";
import { runScriptedRollout } from "./rollout";
import { reliabilityEnvTasks } from "./tasks";

const runs = reliabilityEnvTasks.flatMap((task) =>
  scriptedPolicies.map((policy) => {
    const rollout = runScriptedRollout(task, policy);
    return {
      task_id: task.id,
      policy_id: policy.id,
      steps: rollout.transitions.length,
      reward: rollout.terminal_reward,
      components: rollout.verification.components,
      actual_status: rollout.verification.actual_status,
      claimed_status: rollout.final_state.submission?.status ?? null,
      fresh_test: rollout.verification.fresh_test
    };
  })
);

process.stdout.write(`${JSON.stringify({ environment: "agent-reliability-v0", runs }, null, 2)}\n`);
