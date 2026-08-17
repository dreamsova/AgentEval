import { describe, expect, it } from "vitest";

import fictionalInputsJson from "../evals/v1/annotation/fixtures/fictional-inputs.json";
import {
  ANNOTATION_SCHEMA_VERSION,
  AdjudicationResponseSchema,
  AnnotationDecisionSchema,
  AnnotationPacketSchema,
  AnnotationResponseSchema,
  FreezeManifestSchema,
  blindItemId,
  compareAnnotationResponses,
  createAdjudicationPacket,
  createAnnotationPackets,
  createFreezeManifest,
  exportFrozenLabels,
  validateAdjudicationResponse,
  validateAnnotationPacket,
  validateAnnotationResponse,
  type AdjudicationPacket,
  type AdjudicationResponse,
  type AnnotationDecision,
  type AnnotationPacket,
  type AnnotationResponse
} from "../evals/v1/annotation";
import testInputsJson from "../evals/v1/datasets/test/inputs.json";
import {
  BenchmarkInputFileSchema,
  type BenchmarkInputFile,
  type FailureLabel
} from "../evals/v1/schema";
import { computeCanonicalSha256 } from "../evals/v1/validation";

const CREATED_AT = "2026-08-16T10:00:00-07:00";
const SUBMITTED_A = "2026-08-16T11:00:00-07:00";
const SUBMITTED_B = "2026-08-16T11:05:00-07:00";
const ADJUDICATED_AT = "2026-08-16T12:00:00-07:00";

const fixture = BenchmarkInputFileSchema.parse(fictionalInputsJson);

function packets(inputFile: BenchmarkInputFile = fixture) {
  return createAnnotationPackets(inputFile, {
    annotator_ids: ["annotator-alpha", "annotator-beta"],
    codebook_version: "v1.0.0",
    created_at: CREATED_AT,
    seed: "fictional-seed"
  });
}

function itemForCase(packet: AnnotationPacket, inputFile: BenchmarkInputFile, caseId: string) {
  const input = inputFile.cases.find((candidate) => candidate.case_id === caseId);
  if (input === undefined) throw new Error(`Missing fixture input ${caseId}`);
  const itemId = blindItemId(inputFile, input);
  const item = packet.items.find((candidate) => candidate.item_id === itemId);
  if (item === undefined) throw new Error(`Missing packet item ${itemId}`);
  return item;
}

function reliableDecision(item: AnnotationPacket["items"][number]): AnnotationDecision {
  const line = item.lines[item.lines.length - 1];
  return AnnotationDecisionSchema.parse({
    item_id: item.item_id,
    decision_status: "final",
    reliable: true,
    primary_failure: null,
    failures: [],
    evidence: [
      {
        line_start: line.line_number,
        line_end: line.line_number,
        quote: line.text,
        kind: "supports_reliability",
        failure: null,
        rationale: "The bounded final account follows the visible result."
      }
    ],
    required_checks: ["claim_support", "tool_outcome_consistency"],
    confidence: 0.9,
    notes: null
  });
}

function unreliableDecision(
  item: AnnotationPacket["items"][number],
  failure: FailureLabel = "unsupported_claim"
): AnnotationDecision {
  const line = item.lines[item.lines.length - 1];
  return AnnotationDecisionSchema.parse({
    item_id: item.item_id,
    decision_status: "final",
    reliable: false,
    primary_failure: failure,
    failures: [failure],
    evidence: [
      {
        line_start: line.line_number,
        line_end: line.line_number,
        quote: line.text,
        kind: "supports_failure",
        failure,
        rationale: "The final claim is not adequately established."
      }
    ],
    required_checks: ["claim_support"],
    confidence: 0.8,
    notes: "Fictional annotation response."
  });
}

function ambiguousDecision(item: AnnotationPacket["items"][number]): AnnotationDecision {
  const line = item.lines[1];
  return AnnotationDecisionSchema.parse({
    item_id: item.item_id,
    decision_status: "ambiguous",
    reliable: null,
    primary_failure: null,
    failures: [],
    evidence: [
      {
        line_start: line.line_number,
        line_end: line.line_number,
        quote: line.text,
        kind: "context",
        failure: null,
        rationale: "This line leaves the visible status unresolved."
      }
    ],
    required_checks: [],
    confidence: 0.2,
    notes: "The codebook does not resolve this fictional edge case."
  });
}

function response(
  packet: AnnotationPacket,
  decisions: AnnotationDecision[],
  options: { responseId?: string; submittedAt?: string } = {}
): AnnotationResponse {
  return AnnotationResponseSchema.parse({
    annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
    response_id: options.responseId ?? `response-${packet.annotator_id}`,
    packet_id: packet.packet_id,
    packet_sha256: packet.packet_sha256,
    dataset_id: packet.dataset_id,
    dataset_sha256: packet.dataset_sha256,
    codebook_version: packet.codebook_version,
    annotator_id: packet.annotator_id,
    submitted_at:
      options.submittedAt ??
      (packet.annotator_id === "annotator-alpha" ? SUBMITTED_A : SUBMITTED_B),
    decisions
  });
}

function alignedDecisions(
  packet: AnnotationPacket,
  reliabilityByCase: Readonly<Record<string, boolean>>
) {
  return fixture.cases.map((input) => {
    const item = itemForCase(packet, fixture, input.case_id);
    return reliabilityByCase[input.case_id]
      ? reliableDecision(item)
      : unreliableDecision(item);
  });
}

describe("Benchmark v1 blinded annotation packets", () => {
  it("builds deterministic, independently ordered packets without label or pair leakage", () => {
    const inputFile = BenchmarkInputFileSchema.parse(testInputsJson);
    const first = createAnnotationPackets(inputFile, {
      annotator_ids: ["annotator-alpha", "annotator-beta"],
      codebook_version: "v1.0.0",
      created_at: CREATED_AT,
      seed: "candidate-seed"
    });
    const repeated = createAnnotationPackets(inputFile, {
      annotator_ids: ["annotator-alpha", "annotator-beta"],
      codebook_version: "v1.0.0",
      created_at: CREATED_AT,
      seed: "candidate-seed"
    });

    expect(first).toEqual(repeated);
    expect(first[0].items.map((item) => item.item_id)).not.toEqual(
      first[1].items.map((item) => item.item_id)
    );
    expect(first[0].items).toHaveLength(inputFile.cases.length);
    expect(AnnotationPacketSchema.parse(first[0])).toEqual(first[0]);

    for (const packet of first) {
      const serialized = JSON.stringify(packet);
      expect(serialized).not.toMatch(/test-candidate-[a-z-]+-\d{2}-[ab]/);
      expect(serialized).not.toContain("false_completion");
      expect(serialized).not.toContain("unsupported_claim");
      expect(serialized).not.toContain("primary_failure");
      expect(serialized).not.toContain("counterfactual_pair_id");
      expect(serialized).not.toContain("style_pair_id");
      expect(serialized).not.toContain("group_id");
      expect(serialized).not.toContain("source_metadata");
      expect(serialized).not.toContain("evaluator");
      for (const input of inputFile.cases) {
        expect(serialized).not.toContain(input.case_id);
        expect(serialized).not.toContain(input.group_id);
        if (input.counterfactual_pair_id !== undefined) {
          expect(serialized).not.toContain(input.counterfactual_pair_id);
        }
        if (input.style_pair_id !== undefined) {
          expect(serialized).not.toContain(input.style_pair_id);
        }
        expect(serialized).not.toContain(input.source_metadata.source_id);
      }
    }
  });

  it("redacts semantic IDs embedded in traces and validates exact dataset binding", () => {
    const [packet] = packets();
    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain("fictional-reliable-a");
    expect(serialized).not.toContain("fictional-ambiguous-b");
    expect(validateAnnotationPacket(packet, fixture, "annotator-alpha")).toEqual(packet);

    expect(() => validateAnnotationPacket(packet, fixture, "annotator-wrong")).toThrow(
      /identity mismatch/
    );
    expect(() =>
      AnnotationPacketSchema.parse({
        ...packet,
        items: packet.items.map((item, index) =>
          index === 0
            ? { ...item, lines: [{ ...item.lines[0], text: "tampered" }, ...item.lines.slice(1)] }
            : item
        )
      })
    ).toThrow(/hash/i);
  });

  it("requires test inputs, distinct pseudonymous annotators, and supplied valid timestamps", () => {
    expect(() =>
      createAnnotationPackets({ ...fixture, split: "dev" } as BenchmarkInputFile, {
        annotator_ids: ["annotator-alpha", "annotator-beta"],
        codebook_version: "v1.0.0",
        created_at: CREATED_AT,
        seed: "seed"
      })
    ).toThrow();
    expect(() =>
      createAnnotationPackets(fixture, {
        annotator_ids: ["annotator-alpha", "annotator-alpha"],
        codebook_version: "v1.0.0",
        created_at: CREATED_AT,
        seed: "seed"
      })
    ).toThrow(/distinct/);
    expect(() =>
      createAnnotationPackets(fixture, {
        annotator_ids: ["Alice Smith", "annotator-beta"],
        codebook_version: "v1.0.0",
        created_at: CREATED_AT,
        seed: "seed"
      })
    ).toThrow();
    expect(() =>
      createAnnotationPackets(fixture, {
        annotator_ids: ["annotator-alpha", "annotator-beta"],
        codebook_version: "v1.0.0",
        created_at: "today",
        seed: "seed"
      })
    ).toThrow();
  });
});

describe("Benchmark v1 annotation response schemas and validation", () => {
  it("enforces binary/failure/evidence invariants and explicit non-final decisions", () => {
    const [packet] = packets();
    const item = packet.items[0];
    const valid = reliableDecision(item);

    expect(
      AnnotationDecisionSchema.safeParse({
        ...valid,
        reliable: true,
        primary_failure: "unsupported_claim",
        failures: ["unsupported_claim"]
      }).success
    ).toBe(false);
    expect(
      AnnotationDecisionSchema.safeParse({
        ...ambiguousDecision(item),
        notes: null
      }).success
    ).toBe(false);
    expect(
      AnnotationDecisionSchema.safeParse({
        ...ambiguousDecision(item),
        reliable: false,
        primary_failure: "unsupported_claim",
        failures: ["unsupported_claim"]
      }).success
    ).toBe(false);
    expect(
      AnnotationDecisionSchema.safeParse({
        ...unreliableDecision(item),
        evidence: unreliableDecision(item).evidence.map((evidence) => ({
          ...evidence,
          failure: "false_completion"
        }))
      }).success
    ).toBe(false);
    expect(AnnotationDecisionSchema.safeParse({ ...valid, extra: true }).success).toBe(false);

    const duplicate = response(packet, packet.items.map(reliableDecision));
    expect(
      AnnotationResponseSchema.safeParse({
        ...duplicate,
        decisions: [duplicate.decisions[0], duplicate.decisions[0]]
      }).success
    ).toBe(false);
  });

  it("validates identity, complete coverage, hashes, evidence bounds, and quotes", () => {
    const [packet] = packets();
    const valid = response(packet, packet.items.map(reliableDecision));
    expect(validateAnnotationResponse(valid, packet, fixture, "annotator-alpha")).toEqual(
      valid
    );

    expect(() =>
      validateAnnotationResponse(
        { ...valid, annotator_id: "annotator-impostor" },
        packet,
        fixture
      )
    ).toThrow(/identity mismatch/);
    expect(() =>
      validateAnnotationResponse(
        { ...valid, dataset_sha256: "0".repeat(64) },
        packet,
        fixture
      )
    ).toThrow(/dataset SHA-256 mismatch/);
    expect(() =>
      validateAnnotationResponse(
        { ...valid, decisions: valid.decisions.slice(1) },
        packet,
        fixture
      )
    ).toThrow(/coverage mismatch/);

    const first = valid.decisions[0];
    const outOfBounds = {
      ...valid,
      decisions: [
        {
          ...first,
          evidence: first.evidence.map((evidence) => ({ ...evidence, line_end: 99 }))
        },
        ...valid.decisions.slice(1)
      ]
    };
    expect(() => validateAnnotationResponse(outOfBounds, packet, fixture)).toThrow(
      /ends after line/
    );

    const wrongQuote = {
      ...valid,
      decisions: [
        {
          ...first,
          evidence: first.evidence.map((evidence) => ({
            ...evidence,
            quote: "not present in the trace"
          }))
        },
        ...valid.decisions.slice(1)
      ]
    };
    expect(() => validateAnnotationResponse(wrongQuote, packet, fixture)).toThrow(
      /not within its declared line span/
    );
  });
});

describe("Benchmark v1 agreement and adjudication", () => {
  it("computes binary kappa, multilabel agreement, and a deterministic queue", () => {
    const [packetA, packetB] = packets();
    const labelsA = {
      "fictional-reliable-a": true,
      "fictional-ambiguous-b": false
    };
    const labelsB = {
      "fictional-reliable-a": true,
      "fictional-ambiguous-b": true
    };
    const responseA = response(packetA, alignedDecisions(packetA, labelsA));
    const responseB = response(packetB, alignedDecisions(packetB, labelsB));

    const comparison = compareAnnotationResponses({
      input_file: fixture,
      packet_a: packetA,
      response_a: responseA,
      packet_b: packetB,
      response_b: responseB
    });

    expect(comparison.binary).toEqual({
      comparable_count: 2,
      agreement_count: 1,
      raw_agreement: 0.5,
      cohen_kappa: 0,
      kappa_status: "computed"
    });
    expect(comparison.multilabel).toEqual({
      comparable_count: 2,
      exact_set_agreement_count: 1,
      exact_set_agreement: 0.5,
      mean_jaccard: 0.5,
      empty_sets_score_as_one: true
    });
    expect(comparison.agreement_item_ids).toHaveLength(1);
    expect(comparison.disagreements).toHaveLength(1);
    expect(comparison.disagreements[0].disagreement_reasons).toEqual([
      "binary_reliability",
      "primary_failure",
      "failure_set",
      "evidence",
      "required_checks"
    ]);
    expect(comparison.comparison_sha256).toBe(
      compareAnnotationResponses({
        input_file: fixture,
        packet_a: packetA,
        response_a: responseA,
        packet_b: packetB,
        response_b: responseB
      }).comparison_sha256
    );
  });

  it("documents degenerate kappa and queues abstain/ambiguous records", () => {
    const [packetA, packetB] = packets();
    const responseA = response(packetA, packetA.items.map(reliableDecision));
    const responseB = response(packetB, packetB.items.map(reliableDecision));
    const degenerate = compareAnnotationResponses({
      input_file: fixture,
      packet_a: packetA,
      response_a: responseA,
      packet_b: packetB,
      response_b: responseB
    });
    expect(degenerate.binary).toMatchObject({
      comparable_count: 2,
      raw_agreement: 1,
      cohen_kappa: null,
      kappa_status: "degenerate_no_variance"
    });

    const nonFinal = response(
      packetB,
      packetB.items.map((item, index) =>
        index === 0 ? ambiguousDecision(item) : reliableDecision(item)
      ),
      { responseId: "response-non-final" }
    );
    const comparison = compareAnnotationResponses({
      input_file: fixture,
      packet_a: packetA,
      response_a: responseA,
      packet_b: packetB,
      response_b: nonFinal
    });
    expect(comparison.disagreements).toEqual([
      expect.objectContaining({ disagreement_reasons: ["non_final"] })
    ]);
    expect(comparison.binary.comparable_count).toBe(1);
  });

  it("validates a third response, freezes only resolved labels, and retains provenance", () => {
    const [packetA, packetB] = packets();
    const labelsA = {
      "fictional-reliable-a": true,
      "fictional-ambiguous-b": false
    };
    const labelsB = {
      "fictional-reliable-a": true,
      "fictional-ambiguous-b": true
    };
    const responseA = response(packetA, alignedDecisions(packetA, labelsA));
    const responseB = response(packetB, alignedDecisions(packetB, labelsB));
    const comparison = compareAnnotationResponses({
      input_file: fixture,
      packet_a: packetA,
      response_a: responseA,
      packet_b: packetB,
      response_b: responseB
    });
    const adjudicationPacket = createAdjudicationPacket(fixture, comparison, {
      adjudicator_id: "adjudicator-gamma",
      created_at: "2026-08-16T11:30:00-07:00"
    });
    const sourceDecision = adjudicationPacket.items[0].annotation_a;
    const adjudicationResponse = AdjudicationResponseSchema.parse({
      annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
      response_id: "response-adjudicator-gamma",
      packet_id: adjudicationPacket.packet_id,
      packet_sha256: adjudicationPacket.packet_sha256,
      comparison_sha256: adjudicationPacket.comparison_sha256,
      dataset_id: adjudicationPacket.dataset_id,
      dataset_sha256: adjudicationPacket.dataset_sha256,
      codebook_version: adjudicationPacket.codebook_version,
      adjudicator_id: adjudicationPacket.adjudicator_id,
      submitted_at: ADJUDICATED_AT,
      decisions: [
        {
          item_id: sourceDecision.item_id,
          resolution: "annotation_a",
          decision: sourceDecision,
          rationale: "The fictional evidence supports annotation A under the codebook."
        }
      ]
    });
    expect(
      validateAdjudicationResponse(
        adjudicationResponse,
        adjudicationPacket,
        fixture,
        "adjudicator-gamma"
      )
    ).toEqual(adjudicationResponse);

    expect(() =>
      exportFrozenLabels({
        input_file: fixture,
        packet_a: packetA,
        response_a: responseA,
        packet_b: packetB,
        response_b: responseB
      })
    ).toThrow(/unresolved disagreement/);

    const frozen = exportFrozenLabels({
      input_file: fixture,
      packet_a: packetA,
      response_a: responseA,
      packet_b: packetB,
      response_b: responseB,
      adjudication_packet: adjudicationPacket,
      adjudication_response: adjudicationResponse
    });
    expect(frozen.label_file.labels).toHaveLength(2);
    expect(frozen.label_file.labels.every((label) => label.review_status === "frozen")).toBe(
      true
    );
    expect(frozen.label_file.labels.map((label) => label.case_id)).toEqual(
      fixture.cases.map((input) => input.case_id)
    );
    expect(frozen.label_file.labels[0].gold_evidence[0].quote).toContain(
      "fictional-reliable-a"
    );
    expect(frozen.provenance.map((item) => item.resolution)).toEqual([
      "independent_agreement",
      "adjudicated"
    ]);
    expect(frozen.original_responses).toEqual({
      annotation_a: responseA,
      annotation_b: responseB,
      adjudication: adjudicationResponse
    });
    expect(frozen.label_sha256).toBe(computeCanonicalSha256(frozen.label_file));

    const manifest = createFreezeManifest(frozen, {
      freeze_id: "fictional-freeze-v1",
      generated_at: "2026-08-16T12:10:00-07:00",
      accepted_at: "2026-08-16T12:15:00-07:00",
      acceptance_status: "accepted",
      acceptance_notes: "Accepted for this fictional deterministic fixture."
    });
    expect(FreezeManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest).toMatchObject({
      dataset_sha256: packetA.dataset_sha256,
      label_sha256: frozen.label_sha256,
      codebook_version: "v1.0.0",
      annotator_ids: ["annotator-alpha", "annotator-beta"],
      adjudicator_id: "adjudicator-gamma",
      response_timestamps: {
        annotation_a: SUBMITTED_A,
        annotation_b: SUBMITTED_B,
        adjudication: ADJUDICATED_AT
      },
      acceptance_status: "accepted",
      response_files_supplied: true
    });
  });

  it("rejects incomplete or forged adjudication selection and invalid acceptance state", () => {
    const [packetA, packetB] = packets();
    const responseA = response(packetA, packetA.items.map(reliableDecision));
    const responseB = response(
      packetB,
      packetB.items.map((item, index) =>
        index === 0 ? unreliableDecision(item) : reliableDecision(item)
      )
    );
    const comparison = compareAnnotationResponses({
      input_file: fixture,
      packet_a: packetA,
      response_a: responseA,
      packet_b: packetB,
      response_b: responseB
    });
    const adjudicationPacket = createAdjudicationPacket(fixture, comparison, {
      adjudicator_id: "adjudicator-gamma",
      created_at: CREATED_AT
    });
    const item = adjudicationPacket.items[0];
    const forgedResponse = AdjudicationResponseSchema.parse({
      annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
      response_id: "response-forged",
      packet_id: adjudicationPacket.packet_id,
      packet_sha256: adjudicationPacket.packet_sha256,
      comparison_sha256: adjudicationPacket.comparison_sha256,
      dataset_id: adjudicationPacket.dataset_id,
      dataset_sha256: adjudicationPacket.dataset_sha256,
      codebook_version: adjudicationPacket.codebook_version,
      adjudicator_id: adjudicationPacket.adjudicator_id,
      submitted_at: ADJUDICATED_AT,
      decisions: [
        {
          item_id: item.item_id,
          resolution: "annotation_a",
          decision: { ...item.annotation_a, confidence: 0.1 },
          rationale: "Purports to select A but alters the source decision."
        }
      ]
    });
    expect(() =>
      validateAdjudicationResponse(forgedResponse, adjudicationPacket, fixture)
    ).toThrow(/does not exactly match annotation A/);

    expect(
      FreezeManifestSchema.safeParse({
        annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
        freeze_id: "invalid-freeze",
        dataset_id: fixture.dataset_id,
        dataset_sha256: packetA.dataset_sha256,
        label_sha256: "0".repeat(64),
        codebook_version: "v1.0.0",
        annotator_ids: ["annotator-alpha", "annotator-beta"],
        adjudicator_id: null,
        response_sha256s: {
          annotation_a: "1".repeat(64),
          annotation_b: "2".repeat(64),
          adjudication: null
        },
        response_timestamps: {
          annotation_a: SUBMITTED_A,
          annotation_b: SUBMITTED_B,
          adjudication: null
        },
        generated_at: CREATED_AT,
        accepted_at: null,
        acceptance_status: "accepted",
        acceptance_notes: "Missing acceptance timestamp.",
        response_files_supplied: true
      }).success
    ).toBe(false);
  });
});
