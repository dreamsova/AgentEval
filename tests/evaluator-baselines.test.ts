import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import devInputs from "../evals/v1/datasets/dev/inputs.json";
import { BenchmarkInputSchema } from "../evals/v1/schema";
import {
  AdaptiveAgentEvalEvaluator,
  AllContextJudgeEvaluator,
  DirectJudgeEvaluator,
  FakeJudgeProvider,
  HeuristicEvaluator,
  type JudgeResponse
} from "../lib/evaluators";

const input = BenchmarkInputSchema.parse(devInputs.cases[0]);

function judgeResponse(reliable = true): JudgeResponse {
  return {
    prediction: {
      reliable,
      primary_failure: reliable ? null : "false_completion",
      reliability_score: reliable ? 0.9 : 0.1,
      evidence: [
        {
          line_number: 4,
          quote: "Tool: result success output=./notes.md",
          reason: "The visible tool result supports the completion claim."
        }
      ]
    },
    requested_model: "fake-requested-model",
    returned_model: "fake-returned-model",
    latency_ms: 3,
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120
  };
}

describe("benchmark evaluator baselines", () => {
  it("runs the current heuristic explicitly without model calls or fallback", async () => {
    const evaluator = new HeuristicEvaluator();
    const result = await evaluator.evaluate(input, {
      run_id: "run-test",
      attempt: 1
    });

    expect(evaluator.descriptor.id).toBe("current-heuristic");
    expect(result.engine).toBe("heuristic");
    expect(result.model_calls).toEqual([]);
    expect(result.tool_calls).toEqual([]);
    expect(result.fallback.used).toBe(false);
    expect(result.degraded).toBe(false);
  });

  it("uses exactly one provider call for the direct judge", async () => {
    const provider = new FakeJudgeProvider(() => judgeResponse());
    const evaluator = new DirectJudgeEvaluator(provider, "fake-requested-model");
    const result = await evaluator.evaluate(input, {
      run_id: "run-test",
      attempt: 1
    });

    expect(provider.calls).toBe(1);
    expect(provider.requests[0].user_prompt).toContain("agent_trace_json");
    expect(provider.requests[0].user_prompt).not.toContain(
      "local_diagnostics_json"
    );
    expect(result.model_calls).toHaveLength(1);
    expect(result.tool_calls).toEqual([]);
    expect(result.returned_model).toBe("fake-returned-model");
  });

  it("executes each local diagnostic once, then makes one judge call", async () => {
    const provider = new FakeJudgeProvider(() => judgeResponse());
    const evaluator = new AllContextJudgeEvaluator(
      provider,
      "fake-requested-model"
    );
    const result = await evaluator.evaluate(input, {
      run_id: "run-test",
      attempt: 1
    });

    expect(provider.calls).toBe(1);
    expect(provider.requests[0].user_prompt).toContain(
      "local_diagnostics_json"
    );
    expect(result.model_calls).toHaveLength(1);
    expect(result.tool_calls).toHaveLength(6);
    expect(new Set(result.tool_calls.map((call) => call.name)).size).toBe(6);
    expect(result.tool_calls.every((call) => call.status === "succeeded")).toBe(
      true
    );
  });

  it("adapts the existing AgentEval loop to the common interface", async () => {
    const finalJudgment = {
      instruction_following: 90,
      consistency: 90,
      promise_action_gap_risk: 10,
      hallucination_risk: 10,
      behavior_language_alignment: 90,
      strategic_masking_risk: 10,
      main_failure_mode: "No severe failure mode detected",
      summary: "The visible tool result supports the bounded completion claim.",
      evidence: [
        {
          lineNumber: 4,
          quote: "Tool: result success output=./notes.md",
          reason: "This is observable execution evidence."
        },
        {
          lineNumber: 5,
          quote: "Agent: Completed.",
          reason: "The claim is bounded to the visible result."
        }
      ],
      recommended_tests: [
        "Retain the tool result.",
        "Check the output path."
      ]
    };
    const parse = vi.fn().mockResolvedValue({
      model: "fake-returned-model",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      output: [],
      output_parsed: finalJudgment
    });
    const client = { responses: { parse } } as unknown as OpenAI;
    const evaluator = new AdaptiveAgentEvalEvaluator(
      client,
      "fake-requested-model"
    );
    const result = await evaluator.evaluate(input, {
      run_id: "run-test",
      attempt: 1
    });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(evaluator.descriptor.id).toBe("adaptive-agenteval");
    expect(result.engine).toBe("agent");
    expect(result.prediction.reliable).toBe(true);
    expect(result.model_calls).toHaveLength(1);
    expect(result.fallback.used).toBe(false);
  });
});
