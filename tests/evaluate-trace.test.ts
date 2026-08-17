import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluateTrace } from "../lib/evaluate-trace";

const trace = "User: Finish the requested task.\nAgent: Done. The task is complete.";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("evaluateTrace fallback policy", () => {
  it("allows only a prominently degraded heuristic fallback in demo mode", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const report = await evaluateTrace(trace, "founder-demo");

    expect(report).toMatchObject({
      engine: "heuristic",
      degraded: true,
      degradation_reason: "agent_unavailable"
    });
    expect(report.summary).toMatch(/^DEGRADED HEURISTIC FALLBACK/);
    expect(report.run_metadata).toMatchObject({
      fallback_policy: "demo-continuity",
      fallback_reason: "missing_api_key",
      degraded: true,
      calls: { model: 0, tool: 0 }
    });
  });

  it("does not silently substitute heuristics in research or ops modes", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(evaluateTrace(trace, "research-eval")).rejects.toThrow(
      /heuristic fallback is disabled/i
    );
    await expect(evaluateTrace(trace, "ops-reliability")).rejects.toThrow(
      /heuristic fallback is disabled/i
    );
  });

  it("records agent parse failure telemetry before a degraded demo fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const parse = vi.fn().mockResolvedValue({
      model: "returned-model",
      usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
      output: [],
      output_parsed: { invalid: true }
    });
    const client = { responses: { parse } } as unknown as OpenAI;

    const report = await evaluateTrace(trace, "founder-demo", {
      client,
      requestedModel: "requested-model"
    });

    expect(report.engine).toBe("heuristic");
    expect(report.degraded).toBe(true);
    expect(report.degradation_reason).toBe("agent_failure");
    expect(report.run_metadata).toMatchObject({
      requested_model: "requested-model",
      returned_model: "returned-model",
      fallback_policy: "demo-continuity",
      fallback_reason: "agent_error:ZodError",
      calls: { model: 1, tool: 0 },
      token_usage: {
        input_tokens: 7,
        output_tokens: 2,
        total_tokens: 9,
        complete: true
      }
    });
    expect(report.run_metadata.model_calls[0]?.status).toBe("failed");
  });

  it("surfaces the same parse failure in strict research mode", async () => {
    const parse = vi.fn().mockResolvedValue({
      output: [],
      output_parsed: { invalid: true }
    });
    const client = { responses: { parse } } as unknown as OpenAI;

    await expect(
      evaluateTrace(trace, "research-eval", { client })
    ).rejects.toThrow();
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
