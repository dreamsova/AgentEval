import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { judgePredictionSchema } from "@/lib/evaluators/judge-schema";
import type {
  JudgeProvider,
  JudgeRequest,
  JudgeResponse
} from "@/lib/evaluators/types";

function finiteUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class OpenAIJudgeProvider implements JudgeProvider {
  readonly id = "openai-responses";

  constructor(private readonly client: OpenAI) {}

  async judge(request: JudgeRequest): Promise<JudgeResponse> {
    const startedAt = Date.now();
    const response = await this.client.responses.parse({
      model: request.model,
      store: false,
      input: [
        { role: "system", content: request.system_prompt },
        { role: "user", content: request.user_prompt }
      ],
      max_output_tokens: 1400,
      text: {
        format: zodTextFormat(judgePredictionSchema, "benchmark_prediction")
      }
    });
    const prediction = judgePredictionSchema.parse(response.output_parsed);
    const usage = response.usage;
    return {
      prediction,
      requested_model: request.model,
      returned_model: typeof response.model === "string" ? response.model : null,
      latency_ms: Math.max(0, Date.now() - startedAt),
      input_tokens: finiteUsage(usage?.input_tokens),
      output_tokens: finiteUsage(usage?.output_tokens),
      total_tokens: finiteUsage(usage?.total_tokens)
    };
  }
}
