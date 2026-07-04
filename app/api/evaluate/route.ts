import { NextResponse } from "next/server";
import { z } from "zod";

import { evaluateTrace } from "@/lib/evaluate-trace";

const requestSchema = z.object({
  trace: z.string().min(20, "Please provide a longer trace to evaluate.")
});

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { trace } = requestSchema.parse(payload);

    const report = await evaluateTrace(trace);
    return NextResponse.json(report);
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
