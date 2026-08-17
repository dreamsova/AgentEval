import { z } from "zod";

import {
  FailureLabelSchema,
  IdentifierSchema,
  RequiredCheckSchema
} from "../schema";
import { computeCanonicalSha256, computeTraceSha256 } from "../validation";

export const ANNOTATION_SCHEMA_VERSION = "1.0.0" as const;

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const TimestampSchema = z.string().datetime({ offset: true });
export const CodebookVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/);
export const AnnotatorIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^annotator-[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
export const AdjudicatorIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^adjudicator-[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

export const TraceLineSchema = z
  .object({
    line_number: z.number().int().positive(),
    text: z.string()
  })
  .strict();

export const PacketItemSchema = z
  .object({
    item_id: IdentifierSchema,
    trace_sha256: Sha256Schema,
    lines: z.array(TraceLineSchema).min(1)
  })
  .strict()
  .superRefine((item, context) => {
    for (const [index, line] of item.lines.entries()) {
      if (line.line_number !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index, "line_number"],
          message: "Packet line numbers must be contiguous and 1-based"
        });
      }
    }
    const trace = item.lines.map((line) => line.text).join("\n");
    if (computeTraceSha256(trace) !== item.trace_sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trace_sha256"],
        message: "Packet trace hash does not match its numbered lines"
      });
    }
  });

const AnnotationPacketShape = {
  annotation_schema_version: z.literal(ANNOTATION_SCHEMA_VERSION),
  packet_id: IdentifierSchema,
  dataset_id: IdentifierSchema,
  dataset_sha256: Sha256Schema,
  codebook_version: CodebookVersionSchema,
  annotator_id: AnnotatorIdSchema,
  created_at: TimestampSchema,
  items: z.array(PacketItemSchema).min(1),
  packet_sha256: Sha256Schema
} as const;

export const AnnotationPacketSchema = z
  .object(AnnotationPacketShape)
  .strict()
  .superRefine((packet, context) => {
    const itemIds = new Set<string>();
    for (const [index, item] of packet.items.entries()) {
      if (itemIds.has(item.item_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "item_id"],
          message: "Packet item IDs must be unique"
        });
      }
      itemIds.add(item.item_id);
    }
    if (computePacketSha256(packet) !== packet.packet_sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packet_sha256"],
        message: "Packet SHA-256 does not match the packet contents"
      });
    }
  });

export type AnnotationPacket = z.infer<typeof AnnotationPacketSchema>;

export function computePacketSha256(
  packet: Omit<AnnotationPacket, "packet_sha256"> | AnnotationPacket
): string {
  const { packet_sha256: _packetSha256, ...contents } = packet as AnnotationPacket;
  return computeCanonicalSha256(contents);
}

export const AnnotationEvidenceSchema = z
  .object({
    line_start: z.number().int().positive(),
    line_end: z.number().int().positive(),
    quote: z.string().min(1),
    kind: z.enum(["supports_reliability", "supports_failure", "context"]),
    failure: FailureLabelSchema.nullable(),
    rationale: z.string().min(1).max(1000)
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.line_end < evidence.line_start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["line_end"],
        message: "Evidence line_end cannot precede line_start"
      });
    }
    if (evidence.kind === "supports_failure" && evidence.failure === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "Failure evidence must name its supported failure"
      });
    }
    if (evidence.kind !== "supports_failure" && evidence.failure !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failure"],
        message: "Only failure evidence may name a failure"
      });
    }
  });

export const DecisionStatusSchema = z.enum(["final", "abstain", "ambiguous"]);

export const AnnotationDecisionSchema = z
  .object({
    item_id: IdentifierSchema,
    decision_status: DecisionStatusSchema,
    reliable: z.boolean().nullable(),
    primary_failure: FailureLabelSchema.nullable(),
    failures: z.array(FailureLabelSchema),
    evidence: z.array(AnnotationEvidenceSchema),
    required_checks: z.array(RequiredCheckSchema),
    confidence: z.number().min(0).max(1),
    notes: z.string().min(1).max(2000).nullable()
  })
  .strict()
  .superRefine((decision, context) => {
    if (new Set(decision.failures).size !== decision.failures.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failures"],
        message: "Failure labels must be unique"
      });
    }
    if (new Set(decision.required_checks).size !== decision.required_checks.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["required_checks"],
        message: "Required checks must be unique"
      });
    }

    if (decision.decision_status !== "final") {
      if (
        decision.reliable !== null ||
        decision.primary_failure !== null ||
        decision.failures.length !== 0 ||
        decision.required_checks.length !== 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Abstain and ambiguous decisions cannot contain reliability or failure labels"
        });
      }
      if (decision.notes === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["notes"],
          message: "Abstain and ambiguous decisions require explanatory notes"
        });
      }
      if (
        decision.evidence.some(
          (evidence) => evidence.kind !== "context" || evidence.failure !== null
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message: "Non-final decisions may contain only contextual evidence"
        });
      }
      return;
    }

    if (decision.reliable === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliable"],
        message: "Final decisions require a binary reliability label"
      });
    }
    if (decision.evidence.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: "Final decisions require evidence"
      });
    }
    if (decision.required_checks.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["required_checks"],
        message: "Final decisions require at least one required check"
      });
    }

    if (decision.reliable === true) {
      if (decision.primary_failure !== null || decision.failures.length !== 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Reliable decisions cannot contain failure labels"
        });
      }
      if (decision.evidence.some((item) => item.kind !== "supports_reliability")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message: "Reliable decisions require only reliability evidence"
        });
      }
      return;
    }

    if (decision.reliable === false) {
      if (decision.primary_failure === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["primary_failure"],
          message: "Unreliable decisions require a primary failure"
        });
      } else if (!decision.failures.includes(decision.primary_failure)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["failures"],
          message: "The primary failure must appear in failures"
        });
      }
      for (const failure of decision.failures) {
        if (
          !decision.evidence.some(
            (evidence) =>
              evidence.kind === "supports_failure" && evidence.failure === failure
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evidence"],
            message: `Failure ${failure} requires supporting evidence`
          });
        }
      }
      for (const [index, evidence] of decision.evidence.entries()) {
        if (
          evidence.failure !== null &&
          !decision.failures.includes(evidence.failure)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evidence", index, "failure"],
            message: "Evidence failure must appear in the decision failure labels"
          });
        }
      }
      if (decision.evidence.some((item) => item.kind !== "supports_failure")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message: "Unreliable decisions require only failure evidence"
        });
      }
    }
  });

export type AnnotationEvidence = z.infer<typeof AnnotationEvidenceSchema>;
export type AnnotationDecision = z.infer<typeof AnnotationDecisionSchema>;

export const AnnotationResponseSchema = z
  .object({
    annotation_schema_version: z.literal(ANNOTATION_SCHEMA_VERSION),
    response_id: IdentifierSchema,
    packet_id: IdentifierSchema,
    packet_sha256: Sha256Schema,
    dataset_id: IdentifierSchema,
    dataset_sha256: Sha256Schema,
    codebook_version: CodebookVersionSchema,
    annotator_id: AnnotatorIdSchema,
    submitted_at: TimestampSchema,
    decisions: z.array(AnnotationDecisionSchema)
  })
  .strict()
  .superRefine((response, context) => {
    const itemIds = new Set<string>();
    for (const [index, decision] of response.decisions.entries()) {
      if (itemIds.has(decision.item_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "item_id"],
          message: "Response item IDs must be unique"
        });
      }
      itemIds.add(decision.item_id);
    }
  });

export type AnnotationResponse = z.infer<typeof AnnotationResponseSchema>;

export const DisagreementReasonSchema = z.enum([
  "non_final",
  "binary_reliability",
  "primary_failure",
  "failure_set",
  "evidence",
  "required_checks"
]);

export const AdjudicationPacketItemSchema = z
  .object({
    item_id: IdentifierSchema,
    trace_sha256: Sha256Schema,
    lines: z.array(TraceLineSchema).min(1),
    disagreement_reasons: z.array(DisagreementReasonSchema).min(1),
    annotation_a: AnnotationDecisionSchema,
    annotation_b: AnnotationDecisionSchema
  })
  .strict()
  .superRefine((item, context) => {
    for (const [index, line] of item.lines.entries()) {
      if (line.line_number !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index, "line_number"],
          message: "Adjudication line numbers must be contiguous and 1-based"
        });
      }
    }
    const trace = item.lines.map((line) => line.text).join("\n");
    if (computeTraceSha256(trace) !== item.trace_sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trace_sha256"],
        message: "Adjudication trace hash does not match its numbered lines"
      });
    }
    if (
      item.annotation_a.item_id !== item.item_id ||
      item.annotation_b.item_id !== item.item_id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source annotation item IDs must match the adjudication item"
      });
    }
  });

const AdjudicationPacketShape = {
  annotation_schema_version: z.literal(ANNOTATION_SCHEMA_VERSION),
  packet_id: IdentifierSchema,
  comparison_sha256: Sha256Schema,
  dataset_id: IdentifierSchema,
  dataset_sha256: Sha256Schema,
  codebook_version: CodebookVersionSchema,
  annotator_ids: z.tuple([AnnotatorIdSchema, AnnotatorIdSchema]),
  adjudicator_id: AdjudicatorIdSchema,
  created_at: TimestampSchema,
  items: z.array(AdjudicationPacketItemSchema),
  packet_sha256: Sha256Schema
} as const;

export const AdjudicationPacketSchema = z
  .object(AdjudicationPacketShape)
  .strict()
  .superRefine((packet, context) => {
    if (packet.annotator_ids[0] === packet.annotator_ids[1]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["annotator_ids"],
        message: "Adjudication requires two distinct source annotators"
      });
    }
    const itemIds = new Set<string>();
    for (const [index, item] of packet.items.entries()) {
      if (itemIds.has(item.item_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "item_id"],
          message: "Adjudication packet item IDs must be unique"
        });
      }
      itemIds.add(item.item_id);
    }
    if (computeAdjudicationPacketSha256(packet) !== packet.packet_sha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packet_sha256"],
        message: "Adjudication packet SHA-256 does not match its contents"
      });
    }
  });

export type AdjudicationPacket = z.infer<typeof AdjudicationPacketSchema>;

export function computeAdjudicationPacketSha256(
  packet: Omit<AdjudicationPacket, "packet_sha256"> | AdjudicationPacket
): string {
  const { packet_sha256: _packetSha256, ...contents } = packet as AdjudicationPacket;
  return computeCanonicalSha256(contents);
}

export const AdjudicationDecisionSchema = z
  .object({
    item_id: IdentifierSchema,
    resolution: z.enum(["annotation_a", "annotation_b", "independent_judgment"]),
    decision: AnnotationDecisionSchema,
    rationale: z.string().min(1).max(2000)
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.decision.item_id !== resolution.item_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision", "item_id"],
        message: "Adjudication decision item ID must match its record"
      });
    }
    if (resolution.decision.decision_status !== "final") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision", "decision_status"],
        message: "Adjudication decisions must be final"
      });
    }
  });

export const AdjudicationResponseSchema = z
  .object({
    annotation_schema_version: z.literal(ANNOTATION_SCHEMA_VERSION),
    response_id: IdentifierSchema,
    packet_id: IdentifierSchema,
    packet_sha256: Sha256Schema,
    comparison_sha256: Sha256Schema,
    dataset_id: IdentifierSchema,
    dataset_sha256: Sha256Schema,
    codebook_version: CodebookVersionSchema,
    adjudicator_id: AdjudicatorIdSchema,
    submitted_at: TimestampSchema,
    decisions: z.array(AdjudicationDecisionSchema)
  })
  .strict()
  .superRefine((response, context) => {
    const itemIds = new Set<string>();
    for (const [index, decision] of response.decisions.entries()) {
      if (itemIds.has(decision.item_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "item_id"],
          message: "Adjudication response item IDs must be unique"
        });
      }
      itemIds.add(decision.item_id);
    }
  });

export type AdjudicationDecision = z.infer<typeof AdjudicationDecisionSchema>;
export type AdjudicationResponse = z.infer<typeof AdjudicationResponseSchema>;

export const FreezeManifestSchema = z
  .object({
    annotation_schema_version: z.literal(ANNOTATION_SCHEMA_VERSION),
    freeze_id: IdentifierSchema,
    dataset_id: IdentifierSchema,
    dataset_sha256: Sha256Schema,
    label_sha256: Sha256Schema,
    codebook_version: CodebookVersionSchema,
    annotator_ids: z.tuple([AnnotatorIdSchema, AnnotatorIdSchema]),
    adjudicator_id: AdjudicatorIdSchema.nullable(),
    response_sha256s: z
      .object({
        annotation_a: Sha256Schema,
        annotation_b: Sha256Schema,
        adjudication: Sha256Schema.nullable()
      })
      .strict(),
    response_timestamps: z
      .object({
        annotation_a: TimestampSchema,
        annotation_b: TimestampSchema,
        adjudication: TimestampSchema.nullable()
      })
      .strict(),
    generated_at: TimestampSchema,
    accepted_at: TimestampSchema.nullable(),
    acceptance_status: z.enum(["accepted", "rejected"]),
    acceptance_notes: z.string().min(1).max(2000),
    response_files_supplied: z.literal(true)
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.annotator_ids[0] === manifest.annotator_ids[1]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["annotator_ids"],
        message: "Freeze manifests require two distinct annotator IDs"
      });
    }
    if (manifest.acceptance_status === "accepted" && manifest.accepted_at === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accepted_at"],
        message: "Accepted freezes require an accepted_at timestamp"
      });
    }
    if (manifest.acceptance_status === "rejected" && manifest.accepted_at !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accepted_at"],
        message: "Rejected freezes cannot have an accepted_at timestamp"
      });
    }
  });

export type FreezeManifest = z.infer<typeof FreezeManifestSchema>;
