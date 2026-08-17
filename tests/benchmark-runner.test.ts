import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import devInputs from "../evals/v1/datasets/dev/inputs.json";
import devLabels from "../evals/v1/datasets/dev/labels.json";
import {
  FakeEvaluator,
  fakeResult,
  runBenchmark,
  type BenchmarkEvaluatorInput
} from "../lib/evaluators";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenteval-runner-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function fixtureFiles(directory: string, count = devInputs.cases.length) {
  const caseIds = new Set(
    devInputs.cases.slice(0, count).map((item) => item.case_id)
  );
  const input = {
    ...devInputs,
    dataset_id: `runner-fixture-${count}`,
    cases: devInputs.cases.slice(0, count)
  };
  const labels = {
    ...devLabels,
    dataset_id: input.dataset_id,
    labels: devLabels.labels.filter((item) => caseIds.has(item.case_id))
  };
  const inputPath = path.join(directory, "inputs.json");
  const labelPath = path.join(directory, "labels.json");
  await writeFile(inputPath, JSON.stringify(input), "utf8");
  await writeFile(labelPath, JSON.stringify(labels), "utf8");
  return { inputPath, labelPath, input, labels };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Benchmark v1 runner", () => {
  it("resumes partial runs, writes stable JSONL, and is idempotent", async () => {
    const directory = await temporaryDirectory();
    const { inputPath } = await fixtureFiles(directory, 4);
    const evaluator = new FakeEvaluator(async (input) =>
      fakeResult(input.trace.includes("Tool: result"))
    );
    const output = path.join(directory, "results");
    const common = {
      input_path: inputPath,
      output_directory: output,
      evaluator,
      concurrency: 2,
      retry: { max_attempts: 1, initial_delay_ms: 0, max_delay_ms: 0 },
      bootstrap: { iterations: 5 }
    };

    const partial = await runBenchmark({ ...common, max_cases: 2 });
    expect(partial.summary.status).toBe("partial");
    expect(partial.records).toHaveLength(2);
    expect(partial.summary.execution.pending).toBe(2);

    const completed = await runBenchmark(common);
    expect(completed.run_id).toBe(partial.run_id);
    expect(completed.records).toHaveLength(4);
    expect(evaluator.calls).toBe(4);
    const before = await readFile(completed.predictions_path, "utf8");
    expect(before.trim().split("\n")).toHaveLength(4);

    const resumed = await runBenchmark(common);
    expect(evaluator.calls).toBe(4);
    expect(await readFile(resumed.predictions_path, "utf8")).toBe(before);
    expect(resumed.summary.status).toBe("complete");
  });

  it("bounds concurrency and retries transient failures", async () => {
    const directory = await temporaryDirectory();
    const { inputPath } = await fixtureFiles(directory, 6);
    const attempts = new Map<string, number>();
    const evaluator = new FakeEvaluator(async (input, context) => {
      attempts.set(input.case_id, context.attempt);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (input.case_id === devInputs.cases[0].case_id && context.attempt === 1) {
        throw new Error("transient provider failure");
      }
      return fakeResult(true);
    });

    const result = await runBenchmark({
      input_path: inputPath,
      output_directory: path.join(directory, "results"),
      evaluator,
      concurrency: 3,
      retry: { max_attempts: 2, initial_delay_ms: 0, max_delay_ms: 0 }
    });

    expect(evaluator.maxActive).toBeLessThanOrEqual(3);
    expect(evaluator.maxActive).toBeGreaterThan(1);
    expect(evaluator.calls).toBe(7);
    expect(attempts.get(devInputs.cases[0].case_id)).toBe(2);
    expect(result.records[0].attempts).toBe(2);
    expect(result.records[0].errors).toHaveLength(1);
    expect(result.records.every((record) => record.status === "succeeded")).toBe(
      true
    );
  });

  it("keeps labels outside evaluator calls and opens them only after evaluation", async () => {
    const directory = await temporaryDirectory();
    const { inputPath, labels } = await fixtureFiles(directory, 3);
    const delayedLabelPath = path.join(directory, "delayed-labels.json");
    let completed = 0;
    const evaluator = new FakeEvaluator(async (input) => {
      expect("label" in input).toBe(false);
      expect("reliable" in input).toBe(false);
      expect("gold_evidence" in input).toBe(false);
      completed += 1;
      if (completed === 3) {
        await writeFile(delayedLabelPath, JSON.stringify(labels), "utf8");
      }
      return fakeResult(true);
    });

    const result = await runBenchmark({
      input_path: inputPath,
      label_path: delayedLabelPath,
      output_directory: path.join(directory, "results"),
      evaluator,
      concurrency: 1,
      retry: { max_attempts: 1, initial_delay_ms: 0, max_delay_ms: 0 },
      bootstrap: { iterations: 5 }
    });

    expect(evaluator.seenInputs).toHaveLength(3);
    expect(result.summary.scoring.labels_provided).toBe(true);
    expect(result.summary.scoring.scored_records).toBe(3);
  });

  it("fails closed without contaminating predictions when fallback is returned", async () => {
    const directory = await temporaryDirectory();
    const { inputPath } = await fixtureFiles(directory, 1);
    const evaluator = new FakeEvaluator(() =>
      fakeResult(false, {
        engine: "heuristic",
        degraded: true,
        degradation_reason: "provider_unavailable",
        fallback: {
          used: true,
          engine: "heuristic",
          reason: "provider_unavailable"
        }
      })
    );

    const result = await runBenchmark({
      input_path: inputPath,
      output_directory: path.join(directory, "results"),
      evaluator,
      experimental_mode: true,
      retry: { max_attempts: 3, initial_delay_ms: 0, max_delay_ms: 0 }
    });
    const record = result.records[0];

    expect(evaluator.calls).toBe(1);
    expect(record.status).toBe("failed");
    expect(record.prediction).toBeNull();
    expect(record.fallback).toEqual({
      used: true,
      engine: "heuristic",
      reason: "provider_unavailable"
    });
    expect(record.errors[0].code).toBe("fallback_rejected");
    expect(result.summary.execution.fallback_records).toBe(1);
  });

  it("records terminal errors after the configured retry policy", async () => {
    const directory = await temporaryDirectory();
    const { inputPath } = await fixtureFiles(directory, 1);
    const evaluator = new FakeEvaluator(() => {
      throw new Error("provider is down");
    });

    const result = await runBenchmark({
      input_path: inputPath,
      output_directory: path.join(directory, "results"),
      evaluator,
      retry: { max_attempts: 2, initial_delay_ms: 0, max_delay_ms: 0 }
    });

    expect(evaluator.calls).toBe(2);
    expect(result.summary.status).toBe("failed");
    expect(result.records[0]).toMatchObject({
      status: "failed",
      attempts: 2,
      prediction: null
    });
    expect(result.records[0].errors).toHaveLength(2);
  });

  it("generates byte-identical deterministic manifests", async () => {
    const directory = await temporaryDirectory();
    const { inputPath } = await fixtureFiles(directory, 2);
    const evaluatorA = new FakeEvaluator(() => fakeResult(true));
    const evaluatorB = new FakeEvaluator(() => fakeResult(true));
    const options = {
      input_path: inputPath,
      evaluator: evaluatorA,
      concurrency: 2,
      retry: { max_attempts: 1, initial_delay_ms: 0, max_delay_ms: 0 }
    };
    const first = await runBenchmark({
      ...options,
      output_directory: path.join(directory, "one")
    });
    const second = await runBenchmark({
      ...options,
      evaluator: evaluatorB,
      output_directory: path.join(directory, "two")
    });

    expect(second.run_id).toBe(first.run_id);
    expect(await readFile(second.manifest_path, "utf8")).toBe(
      await readFile(first.manifest_path, "utf8")
    );
  });

  it("completes an end-to-end offline run with metrics and group-aware intervals", async () => {
    const directory = await temporaryDirectory();
    const { inputPath, labelPath } = await fixtureFiles(directory, 8);
    const evaluator = new FakeEvaluator((input: BenchmarkEvaluatorInput) =>
      fakeResult(
        input.trace.includes("Tool: result success") ||
          input.trace.includes("could not complete")
      )
    );

    const result = await runBenchmark({
      input_path: inputPath,
      label_path: labelPath,
      output_directory: path.join(directory, "results"),
      evaluator,
      concurrency: 4,
      retry: { max_attempts: 1, initial_delay_ms: 0, max_delay_ms: 0 },
      bootstrap: {
        seed: "offline-e2e",
        iterations: 20,
        confidence_level: 0.9
      }
    });

    expect(result.summary.status).toBe("complete");
    expect(result.records[0]).toMatchObject({
      dataset_id: "runner-fixture-8",
      evaluator_id: "offline-fake",
      requested_model: "fake-model",
      returned_model: "fake-model-v1",
      engine: "fake",
      degraded: false,
      fallback: { used: false, engine: null, reason: null }
    });
    expect(result.records[0].input_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.records[0].dataset_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.records[0].evaluator_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.records[0].prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.records[0].toolset_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.records[0].tokens).toEqual({
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      complete: true
    });
    expect(result.summary.classification).not.toBeNull();
    expect(result.summary.evidence).not.toBeNull();
    expect(result.summary.pair_stability).not.toBeNull();
    expect(result.summary.efficiency.latency_ms?.count).toBe(8);
    expect(result.summary.confidence_intervals).toMatchObject({
      seed: "offline-e2e",
      iterations: 20,
      confidence_level: 0.9
    });
    expect(result.summary.confidence_intervals?.group_count).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(result.summary_path, "utf8"))).toEqual(
      result.summary
    );
    expect((await readFile(result.predictions_path, "utf8")).trim().split("\n"))
      .toHaveLength(8);
  });
});
