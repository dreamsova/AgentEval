import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const index = argv.indexOf("--config");
  if (index === -1 || !argv[index + 1]) {
    throw new Error(
      "Usage: vite-node evals/v1/run.ts --config evals/v1/config.example.json"
    );
  }
  return path.resolve(argv[index + 1]);
}

async function main() {
  const result = await runFromConfig(configArgument(process.argv.slice(2)));
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

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (executedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
