import type {
  BenchmarkEvaluator,
  BenchmarkEvaluatorInput,
  EvaluatorContext,
  EvaluatorDescriptor,
  EvaluatorResult,
  JudgeProvider,
  JudgeRequest,
  JudgeResponse
} from "@/lib/evaluators/types";

export type FakeEvaluatorHandler = (
  input: BenchmarkEvaluatorInput,
  context: EvaluatorContext
) => Promise<EvaluatorResult> | EvaluatorResult;

export class FakeEvaluator implements BenchmarkEvaluator {
  readonly descriptor: EvaluatorDescriptor;
  calls = 0;
  active = 0;
  maxActive = 0;
  readonly seenInputs: BenchmarkEvaluatorInput[] = [];

  constructor(
    private readonly handler: FakeEvaluatorHandler,
    descriptor: Partial<EvaluatorDescriptor> = {}
  ) {
    this.descriptor = {
      id: "offline-fake",
      version: "1.0.0",
      engine: "fake",
      prompt_version: "offline-fake-prompt-v1",
      prompt: "Offline deterministic fake evaluator.",
      toolset_version: "offline-fake-tools-v1",
      toolset: [],
      requested_model: "fake-model",
      provider: "offline-fake-provider",
      ...descriptor
    };
  }

  async evaluate(input: BenchmarkEvaluatorInput, context: EvaluatorContext) {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.seenInputs.push(input);
    try {
      return await this.handler(input, context);
    } finally {
      this.active -= 1;
    }
  }
}

export type FakeJudgeHandler = (
  request: JudgeRequest,
  call: number
) => Promise<JudgeResponse> | JudgeResponse;

export class FakeJudgeProvider implements JudgeProvider {
  readonly id = "offline-fake-provider";
  calls = 0;
  readonly requests: JudgeRequest[] = [];

  constructor(private readonly handler: FakeJudgeHandler) {}

  async judge(request: JudgeRequest): Promise<JudgeResponse> {
    this.calls += 1;
    this.requests.push(request);
    return this.handler(request, this.calls);
  }
}

export function fakeResult(
  reliable: boolean,
  options: Partial<EvaluatorResult> = {}
): EvaluatorResult {
  const score = reliable ? 0.9 : 0.1;
  return {
    engine: "fake",
    prediction: {
      reliable,
      primary_failure: reliable ? null : "false_completion",
      reliability_score: score
    },
    evidence: [
      {
        line_number: 1,
        quote: "Offline fake evidence",
        reason: "Deterministic test fixture"
      }
    ],
    requested_model: "fake-model",
    returned_model: "fake-model-v1",
    model_calls: [],
    tool_calls: [],
    tokens: {
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      complete: true
    },
    latency_ms: 1,
    errors: [],
    degraded: false,
    degradation_reason: null,
    fallback: { used: false, engine: null, reason: null },
    ...options
  };
}
