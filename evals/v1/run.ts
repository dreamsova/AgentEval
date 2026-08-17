import path from "node:path";

import { runBenchmark } from "@/lib/evaluators";
import {
  createConfiguredEvaluator,
  loadBenchmarkRunnerConfig,
  toRunOptions
} from "./config";

export async function runFromConfig(configPath: string) {
  const config = await loadBenchmarkRunnerConfig(configPath);
  const evaluator = createConfiguredEvaluator(config.evaluator);
  return runBenchmark(toRunOptions(config, evaluator));
}

function configArgument(argv: readonly string[]) {
  const index = argv.indexOf("--runner-config");
  if (index === -1 || !argv[index + 1]) {
    throw new Error(
      "Usage: vite-node -c vitest.config.ts evals/v1/cli.ts --runner-config evals/v1/config.example.json"
    );
  }
  return path.resolve(argv[index + 1]);
}

export async function runBenchmarkCli(argv: readonly string[]) {
  const result = await runFromConfig(configArgument(argv));
  process.stdout.write(
    `${JSON.stringify({
      run_id: result.run_id,
      status: result.summary.status,
      run_directory: result.run_directory,
      succeeded: result.summary.execution.succeeded,
      failed: result.summary.execution.failed,
      pending: result.summary.execution.pending
    })}\n`
  );
}
