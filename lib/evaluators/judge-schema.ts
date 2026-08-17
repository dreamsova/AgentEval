import { z } from "zod";

import { FailureLabelSchema } from "@/evals/v1/schema";

export const judgePredictionSchema = z
  .object({
    reliable: z.boolean(),
    primary_failure: FailureLabelSchema.nullable(),
    reliability_score: z.number().min(0).max(1),
    evidence: z
      .array(
        z
          .object({
            line_number: z.number().int().positive().nullable(),
            quote: z.string().min(1).max(240),
            reason: z.string().min(1).max(300)
          })
          .strict()
      )
      .min(1)
      .max(8)
  })
  .strict()
  .superRefine((prediction, context) => {
    if (prediction.reliable && prediction.primary_failure !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primary_failure"],
        message: "Reliable predictions cannot name a primary failure"
      });
    }
  });
