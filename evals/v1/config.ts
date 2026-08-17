import { readFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";
import { z } from "zod";

import {
  AdaptiveAgentEvalEvaluator,
  AllContextJudgeEvaluator,
  DirectJudgeEvaluator,
  HeuristicEvaluator,
  OpenAIJudgeProvider,
  type BenchmarkEvaluator,
  type BenchmarkRunOptions
} from "@/lib/evaluators";

const EvaluatorConfigSchema = z
  .object({
    id: z.enum([
      "current-heuristic",
      "direct-single-call-judge",
      "all-context-single-call-judge",
      "adaptive-agenteval"
    ]),
    model: z.string().min(1).optional()
  })
  .strict();

export const BenchmarkRunnerConfigSchema = z
  .object({
    input_path: z.string().min(1),
    label_path: z.string().min(1).optional(),
    output_directory: z.string().min(1).default("./evals/v1/results"),
    evaluator: EvaluatorConfigSchema,
    concurrency: z.number().int().positive().max(64).default(4),
    retry: z
      .object({
        max_attempts: z.number().int().positive().max(10).default(2),
        initial_delay_ms: z.number().nonnegative().default(100),
        max_delay_ms: z.number().nonnegative().default(1000)
      })
      .strict()
      .default({}),
    experimental_mode: z.boolean().default(true),
    resume: z.boolean().default(true),
    retry_failed_on_resume: z.boolean().default(false),
    max_cases: z.number().int().nonnegative().optional(),
    bootstrap: z
      .object({
        seed: z.string().min(1).optional(),
        iterations: z.number().int().positive().optional(),
        confidence_level: z.number().gt(0).lt(1).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type BenchmarkRunnerConfig = z.infer<typeof BenchmarkRunnerConfigSchema>;

function resolveFrom(baseDirectory: string, filePath: string) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(baseDirectory, filePath);
}

export async function loadBenchmarkRunnerConfig(configPath: string) {
  const parsed = BenchmarkRunnerConfigSchema.parse(
    JSON.parse(await readFile(configPath, "utf8"))
  );
  const baseDirectory = path.dirname(path.resolve(configPath));
  return {
    ...parsed,
    input_path: resolveFrom(baseDirectory, parsed.input_path),
    ...(parsed.label_path === undefined
      ? {}
      : { label_path: resolveFrom(baseDirectory, parsed.label_path) }),
    output_directory: resolveFrom(baseDirectory, parsed.output_directory)
  };
}

export function createConfiguredEvaluator(
  config: BenchmarkRunnerConfig["evaluator"],
  options: { apiKey?: string; client?: OpenAI } = {}
): BenchmarkEvaluator {
  if (config.id === "current-heuristic") return new HeuristicEvaluator();

  const model = config.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!options.client && !apiKey) {
    throw new Error(
      `${config.id} requires an explicit OpenAI client or OPENAI_API_KEY; heuristic fallback is disabled.`
    );
  }
  const client =
    options.client ??
    new OpenAI({
      apiKey,
      timeout: 25_000
    });
  if (config.id === "adaptive-agenteval") {
    return new AdaptiveAgentEvalEvaluator(client, model);
  }
  const provider = new OpenAIJudgeProvider(client);
  return config.id === "direct-single-call-judge"
    ? new DirectJudgeEvaluator(provider, model)
    : new AllContextJudgeEvaluator(provider, model);
}

export function toRunOptions(
  config: BenchmarkRunnerConfig,
  evaluator: BenchmarkEvaluator
): BenchmarkRunOptions {
  return {
    input_path: config.input_path,
    ...(config.label_path === undefined ? {} : { label_path: config.label_path }),
    output_directory: config.output_directory,
    evaluator,
    concurrency: config.concurrency,
    retry: config.retry,
    experimental_mode: config.experimental_mode,
    resume: config.resume,
    retry_failed_on_resume: config.retry_failed_on_resume,
    ...(config.max_cases === undefined ? {} : { max_cases: config.max_cases }),
    ...(config.bootstrap === undefined ? {} : { bootstrap: config.bootstrap })
  };
}
