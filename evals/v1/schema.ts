import { z } from "zod";

import { computeTraceSha256 } from "./validation";

export const BENCHMARK_SCHEMA_VERSION = "1.0.0" as const;

export const SplitSchema = z.enum(["dev", "regression", "test"]);

export const FailureLabelSchema = z.enum([
  "false_completion",
  "unsupported_claim",
  "partial_completion_overclaim",
  "tool_result_contradiction",
  "artifact_provenance_mismatch",
  "masking_pattern"
]);

export const TaskTypeSchema = z.enum([
  "artifact_creation",
  "artifact_mutation",
  "external_action",
  "fact_retrieval",
  "status_verification",
  "source_verification",
  "structured_response"
]);

export const DomainSchema = z.enum([
  "analytics",
  "business_operations",
  "content_operations",
  "general",
  "publishing",
  "software_operations"
]);

export const StyleTagSchema = z.enum([
  "artifact_first",
  "blocker_disclosure",
  "citation_requested",
  "confident",
  "conversational",
  "evasive_follow_up",
  "follow_up_challenge",
  "polished",
  "precise_language",
  "tool_failure",
  "tool_grounded",
  "tool_omitted",
  "uncertainty_suppressed"
]);

export const RequiredCheckSchema = z.enum([
  "artifact_provenance",
  "claim_support",
  "completion_evidence",
  "masking_language",
  "scope_coverage",
  "tool_outcome_consistency"
]);

export const ReviewStatusSchema = z.enum([
  "needs_human_review",
  "single_reviewed",
  "double_reviewed",
  "conflict_resolved",
  "frozen"
]);

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const SourceMetadataSchema = z
  .object({
    origin: z.enum([
      "legacy_benchmark",
      "synthetic",
      "human_authored",
      "production_sample"
    ]),
    source_id: z.string().min(1).max(256),
    legacy: z.boolean(),
    development_only: z.boolean(),
    unseen: z.boolean(),
    notes: z.string().min(1).max(1000).optional()
  })
  .strict()
  .superRefine((source, context) => {
    if (source.legacy && (!source.development_only || source.unseen)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Legacy cases must be development-only and cannot be marked unseen"
      });
    }
    if (source.development_only && source.unseen) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Development-only cases cannot be marked unseen"
      });
    }
  });

const BenchmarkInputBaseSchema = z
  .object({
    schema_version: z.literal(BENCHMARK_SCHEMA_VERSION),
    case_id: IdentifierSchema,
    split: SplitSchema,
    group_id: IdentifierSchema,
    counterfactual_pair_id: IdentifierSchema.optional(),
    style_pair_id: IdentifierSchema.optional(),
    task_type: TaskTypeSchema,
    domain: DomainSchema,
    style_tags: z.array(StyleTagSchema).min(1),
    trace: z.string().min(1),
    trace_sha256: Sha256Schema,
    source_metadata: SourceMetadataSchema
  })
  .strict();

export const BenchmarkInputSchema = BenchmarkInputBaseSchema.superRefine(
  (input, context) => {
    if (new Set(input.style_tags).size !== input.style_tags.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["style_tags"],
        message: "Style tags must be unique"
      });
    }

    if (computeTraceSha256(input.trace) !== input.trace_sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trace_sha256"],
        message: "Trace SHA-256 does not match the normalized trace"
      });
    }
  }
);

export const GoldEvidenceSchema = z
  .object({
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive().optional(),
    quote: z.string().min(1),
    kind: z.enum(["supports_reliability", "supports_failure"]),
    failure: FailureLabelSchema.nullable(),
    rationale: z.string().min(1).max(1000)
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.line_end !== undefined && evidence.line_end < evidence.line_start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["line_end"],
        message: "Evidence line_end cannot precede line_start"
      });
    }
    if (evidence.kind === "supports_reliability" && evidence.failure !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "Reliability evidence cannot name a failure label"
      });
    }
    if (evidence.kind === "supports_failure" && evidence.failure === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "Failure evidence must name the supported failure label"
      });
    }
  });

const BenchmarkLabelBaseSchema = z
  .object({
    schema_version: z.literal(BENCHMARK_SCHEMA_VERSION),
    case_id: IdentifierSchema,
    reliable: z.boolean(),
    primary_failure: FailureLabelSchema.nullable(),
    failures: z.array(FailureLabelSchema),
    gold_evidence: z.array(GoldEvidenceSchema).min(1),
    required_checks: z.array(RequiredCheckSchema).min(1),
    review_status: ReviewStatusSchema,
    annotation_notes: z.string().min(1).max(2000).optional()
  })
  .strict();

export const BenchmarkLabelSchema = BenchmarkLabelBaseSchema.superRefine(
  (label, context) => {
    if (new Set(label.failures).size !== label.failures.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failures"],
        message: "Failure labels must be unique"
      });
    }
    if (new Set(label.required_checks).size !== label.required_checks.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["required_checks"],
        message: "Required checks must be unique"
      });
    }

    if (label.reliable) {
      if (label.primary_failure !== null || label.failures.length !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reliable cases cannot carry failure labels"
        });
      }
      if (label.gold_evidence.some((evidence) => evidence.kind !== "supports_reliability")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gold_evidence"],
          message: "Reliable cases can only contain reliability evidence"
        });
      }
      return;
    }

    if (label.primary_failure === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primary_failure"],
        message: "Unreliable cases require a primary failure"
      });
    } else if (!label.failures.includes(label.primary_failure)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failures"],
        message: "The primary failure must be included in failures"
      });
    }

    for (const [index, evidence] of label.gold_evidence.entries()) {
      if (
        evidence.kind === "supports_failure" &&
        evidence.failure !== null &&
        !label.failures.includes(evidence.failure)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gold_evidence", index, "failure"],
          message: "Evidence failure must appear in the case failure labels"
        });
      }
    }

    for (const failure of label.failures) {
      if (
        !label.gold_evidence.some(
          (evidence) =>
            evidence.kind === "supports_failure" && evidence.failure === failure
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gold_evidence"],
          message: `Failure ${failure} requires supporting gold evidence`
        });
      }
    }
  }
);

export const BenchmarkInputFileSchema = z
  .object({
    schema_version: z.literal(BENCHMARK_SCHEMA_VERSION),
    dataset_id: IdentifierSchema,
    split: SplitSchema,
    cases: z.array(BenchmarkInputSchema)
  })
  .strict()
  .superRefine((file, context) => {
    const ids = new Set<string>();
    for (const [index, item] of file.cases.entries()) {
      if (item.split !== file.split) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "split"],
          message: "Case split must match its input file split"
        });
      }
      if (ids.has(item.case_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index, "case_id"],
          message: "Case IDs must be unique within an input file"
        });
      }
      ids.add(item.case_id);
    }
  });

export const BenchmarkLabelFileSchema = z
  .object({
    schema_version: z.literal(BENCHMARK_SCHEMA_VERSION),
    dataset_id: IdentifierSchema,
    labels: z.array(BenchmarkLabelSchema)
  })
  .strict()
  .superRefine((file, context) => {
    const ids = new Set<string>();
    for (const [index, label] of file.labels.entries()) {
      if (ids.has(label.case_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["labels", index, "case_id"],
          message: "Case IDs must be unique within a label file"
        });
      }
      ids.add(label.case_id);
    }
  });

export const BenchmarkCaseSchema = z
  .object({
    input: BenchmarkInputSchema,
    label: BenchmarkLabelSchema
  })
  .strict()
  .superRefine((item, context) => {
    if (item.input.case_id !== item.label.case_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Input and label case IDs must match"
      });
    }
  });

export type BenchmarkSplit = z.infer<typeof SplitSchema>;
export type FailureLabel = z.infer<typeof FailureLabelSchema>;
export type BenchmarkInput = z.infer<typeof BenchmarkInputSchema>;
export type BenchmarkLabel = z.infer<typeof BenchmarkLabelSchema>;
export type BenchmarkInputFile = z.infer<typeof BenchmarkInputFileSchema>;
export type BenchmarkLabelFile = z.infer<typeof BenchmarkLabelFileSchema>;
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;
