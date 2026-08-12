import { evaluationModeIds } from "@/lib/evaluation-modes";
import { NextResponse } from "next/server";
import { z } from "zod";

import { evaluateTrace } from "@/lib/evaluate-trace";
import { checkRateLimit } from "@/lib/rate-limit";
import type { EvaluationStreamEvent } from "@/lib/types";

export const maxDuration = 30;

const requestSchema = z.object({
  trace: z
    .string()
    .min(20, "Please provide a longer trace to evaluate.")
    .max(25_000, "Trace is too long. Keep it under 25,000 characters."),
  mode: z.enum(evaluationModeIds)
});

function encodeEvent(event: EvaluationStreamEvent) {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(request: Request) {
  try {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientId = forwardedFor?.split(",")[0]?.trim() || "anonymous";
    const rateLimit = checkRateLimit(clientId);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many evaluations. Please try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimit.retryAfterSeconds.toString()
          }
        }
      );
    }

    const payload = await request.json();
    const { trace, mode } = requestSchema.parse(payload);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encodeEvent({
            type: "agent_started",
            objective:
              "Evaluate whether observable agent behavior supports the claims made in the trace."
          })
        );

        void evaluateTrace(trace, mode, {
          onStep(step) {
            controller.enqueue(encodeEvent({ type: "agent_step", step }));
          }
        })
          .then((report) => {
            controller.enqueue(encodeEvent({ type: "complete", report }));
          })
          .catch((error) => {
            console.error("AgentEval streaming evaluation failed.", error);
            controller.enqueue(
              encodeEvent({
                type: "error",
                error: "AgentEval could not process that trace."
              })
            );
          })
          .finally(() => controller.close());
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "AgentEval could not process that trace." },
      { status: 500 }
    );
  }
}
