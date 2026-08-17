import {
  BENCHMARK_SCHEMA_VERSION,
  BenchmarkInputFileSchema,
  BenchmarkLabelFileSchema,
  type BenchmarkInput,
  type BenchmarkInputFile,
  type BenchmarkLabelFile,
  type FailureLabel
} from "../schema";
import {
  canonicalJson,
  computeCanonicalSha256,
  normalizeTrace,
  sha256
} from "../validation";
import {
  ANNOTATION_SCHEMA_VERSION,
  AdjudicationPacketSchema,
  AdjudicationResponseSchema,
  AnnotationDecisionSchema,
  AnnotationPacketSchema,
  AnnotationResponseSchema,
  FreezeManifestSchema,
  type AdjudicationPacket,
  type AdjudicationResponse,
  type AnnotationDecision,
  type AnnotationPacket,
  type AnnotationResponse,
  type FreezeManifest,
  computeAdjudicationPacketSha256,
  computePacketSha256
} from "./schemas";

export class AnnotationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnotationValidationError";
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AnnotationValidationError(message);
}

export function computeDatasetSha256(inputFile: BenchmarkInputFile): string {
  return computeCanonicalSha256(BenchmarkInputFileSchema.parse(inputFile));
}

export function blindItemId(
  inputFile: BenchmarkInputFile,
  input: Pick<BenchmarkInput, "case_id" | "trace_sha256">
): string {
  const datasetHash = computeDatasetSha256(inputFile);
  return `item-${sha256(
    `${ANNOTATION_SCHEMA_VERSION}\0${datasetHash}\0${input.case_id}\0${input.trace_sha256}`
  ).slice(0, 24)}`;
}

function traceLines(trace: string): Array<{ line_number: number; text: string }> {
  return normalizeTrace(trace)
    .split("\n")
    .map((text, index) => ({ line_number: index + 1, text }));
}

function traceRedactions(input: BenchmarkInput, itemId: string) {
  const candidates: Array<[string, string]> = [
    [input.case_id, itemId],
    [input.group_id, `ref-${sha256(`${itemId}\0group`).slice(0, 20)}`],
    ...(input.counterfactual_pair_id === undefined
      ? []
      : ([
          [
            input.counterfactual_pair_id,
            `ref-${sha256(`${itemId}\0counterfactual`).slice(0, 20)}`
          ]
        ] as Array<[string, string]>)),
    ...(input.style_pair_id === undefined
      ? []
      : ([
          [
            input.style_pair_id,
            `ref-${sha256(`${itemId}\0style`).slice(0, 20)}`
          ]
        ] as Array<[string, string]>)),
    [
      input.source_metadata.source_id,
      `ref-${sha256(`${itemId}\0source`).slice(0, 20)}`
    ]
  ];
  const bySource = new Map<string, string>();
  for (const [source, replacement] of candidates) {
    if (!bySource.has(source)) bySource.set(source, replacement);
  }
  return [...bySource.entries()]
    .map(([source, replacement]) => ({ source, replacement }))
    .sort(
      (left, right) =>
        right.source.length - left.source.length || left.source.localeCompare(right.source)
    );
}

function replaceLiteralValues(
  value: string,
  replacements: ReadonlyArray<{ source: string; replacement: string }>
): string {
  const escaped = replacements.map(({ source }) =>
    source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  if (escaped.length === 0) return value;
  const bySource = new Map(replacements.map((item) => [item.source, item.replacement]));
  return value.replace(new RegExp(escaped.join("|"), "g"), (matched) => {
    const replacement = bySource.get(matched);
    invariant(replacement !== undefined, `Missing redaction for ${matched}`);
    return replacement;
  });
}

function displayTrace(input: BenchmarkInput, itemId: string): string {
  return replaceLiteralValues(normalizeTrace(input.trace), traceRedactions(input, itemId));
}

function restoreEvidenceQuote(
  quote: string,
  input: BenchmarkInput,
  itemId: string
): string {
  return replaceLiteralValues(
    quote,
    traceRedactions(input, itemId).map(({ source, replacement }) => ({
      source: replacement,
      replacement: source
    }))
  );
}

function packetItem(inputFile: BenchmarkInputFile, input: BenchmarkInput) {
  const itemId = blindItemId(inputFile, input);
  const blindedTrace = displayTrace(input, itemId);
  return {
    item_id: itemId,
    trace_sha256: sha256(blindedTrace),
    lines: traceLines(blindedTrace)
  };
}

function shuffledPacketItems(
  inputFile: BenchmarkInputFile,
  annotatorId: string,
  seed: string
) {
  return inputFile.cases
    .map((input) => packetItem(inputFile, input))
    .sort((left, right) => {
      const leftKey = sha256(`${seed}\0${annotatorId}\0${left.item_id}`);
      const rightKey = sha256(`${seed}\0${annotatorId}\0${right.item_id}`);
      return leftKey.localeCompare(rightKey) || left.item_id.localeCompare(right.item_id);
    });
}

function createAnnotationPacket(
  inputFile: BenchmarkInputFile,
  options: {
    annotator_id: string;
    codebook_version: string;
    created_at: string;
    seed: string;
  }
): AnnotationPacket {
  const datasetHash = computeDatasetSha256(inputFile);
  const packetId = `packet-${sha256(
    `${ANNOTATION_SCHEMA_VERSION}\0${datasetHash}\0${options.codebook_version}\0${options.annotator_id}\0${options.created_at}\0${options.seed}`
  ).slice(0, 24)}`;
  const withoutHash = {
    annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
    packet_id: packetId,
    dataset_id: inputFile.dataset_id,
    dataset_sha256: datasetHash,
    codebook_version: options.codebook_version,
    annotator_id: options.annotator_id,
    created_at: options.created_at,
    items: shuffledPacketItems(inputFile, options.annotator_id, options.seed)
  };
  return AnnotationPacketSchema.parse({
    ...withoutHash,
    packet_sha256: computePacketSha256(withoutHash as Omit<AnnotationPacket, "packet_sha256">)
  });
}

/**
 * Builds two independently ordered packets containing only opaque IDs, trace
 * hashes, and numbered trace text. Candidate labels, grouping/pair fields,
 * evaluator outputs, source metadata, and semantic case IDs are never copied.
 */
export function createAnnotationPackets(
  rawInputFile: BenchmarkInputFile,
  options: {
    annotator_ids: readonly [string, string];
    codebook_version: string;
    created_at: string;
    seed: string;
  }
): readonly [AnnotationPacket, AnnotationPacket] {
  const inputFile = BenchmarkInputFileSchema.parse(rawInputFile);
  invariant(inputFile.split === "test", "Annotation packets may only be built for test inputs");
  invariant(inputFile.cases.length > 0, "Annotation packets require at least one case");
  invariant(
    options.annotator_ids[0] !== options.annotator_ids[1],
    "Independent annotation requires two distinct annotator IDs"
  );
  return [
    createAnnotationPacket(inputFile, {
      annotator_id: options.annotator_ids[0],
      codebook_version: options.codebook_version,
      created_at: options.created_at,
      seed: options.seed
    }),
    createAnnotationPacket(inputFile, {
      annotator_id: options.annotator_ids[1],
      codebook_version: options.codebook_version,
      created_at: options.created_at,
      seed: options.seed
    })
  ] as const;
}

function exactCoverage(
  actualIds: readonly string[],
  expectedIds: readonly string[],
  subject: string
): void {
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  const missing = [...expected].filter((id) => !actual.has(id)).sort();
  const unexpected = [...actual].filter((id) => !expected.has(id)).sort();
  invariant(
    missing.length === 0 && unexpected.length === 0 && actualIds.length === expectedIds.length,
    `${subject} coverage mismatch: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`
  );
}

function itemIndex(inputFile: BenchmarkInputFile): Map<string, BenchmarkInput> {
  return new Map(
    inputFile.cases.map((input) => [blindItemId(inputFile, input), input] as const)
  );
}

export function validateAnnotationPacket(
  rawPacket: AnnotationPacket,
  rawInputFile: BenchmarkInputFile,
  expectedAnnotatorId?: string
): AnnotationPacket {
  const packet = AnnotationPacketSchema.parse(rawPacket);
  const inputFile = BenchmarkInputFileSchema.parse(rawInputFile);
  const datasetHash = computeDatasetSha256(inputFile);

  invariant(packet.dataset_id === inputFile.dataset_id, "Packet dataset ID mismatch");
  invariant(packet.dataset_sha256 === datasetHash, "Packet dataset SHA-256 mismatch");
  if (expectedAnnotatorId !== undefined) {
    invariant(packet.annotator_id === expectedAnnotatorId, "Packet annotator identity mismatch");
  }

  const expectedItems = new Map(
    inputFile.cases.map((input) => {
      const item = packetItem(inputFile, input);
      return [item.item_id, item] as const;
    })
  );
  exactCoverage(
    packet.items.map((item) => item.item_id),
    [...expectedItems.keys()],
    "Packet"
  );
  for (const item of packet.items) {
    invariant(
      canonicalJson(item) === canonicalJson(expectedItems.get(item.item_id)),
      `Packet item ${item.item_id} does not match the hashed dataset trace`
    );
  }
  return packet;
}

function validateEvidence(decision: AnnotationDecision, packet: AnnotationPacket): void {
  const item = packet.items.find((candidate) => candidate.item_id === decision.item_id);
  invariant(item !== undefined, `Unknown response item ${decision.item_id}`);
  for (const [index, evidence] of decision.evidence.entries()) {
    invariant(
      evidence.line_end <= item.lines.length,
      `Evidence ${index} for ${decision.item_id} ends after line ${item.lines.length}`
    );
    const span = item.lines
      .slice(evidence.line_start - 1, evidence.line_end)
      .map((line) => line.text)
      .join("\n");
    invariant(
      span.includes(evidence.quote),
      `Evidence ${index} quote for ${decision.item_id} is not within its declared line span`
    );
  }
}

export function validateAnnotationResponse(
  rawResponse: AnnotationResponse,
  rawPacket: AnnotationPacket,
  rawInputFile: BenchmarkInputFile,
  expectedAnnotatorId?: string
): AnnotationResponse {
  const packet = validateAnnotationPacket(rawPacket, rawInputFile, expectedAnnotatorId);
  const response = AnnotationResponseSchema.parse(rawResponse);

  invariant(response.packet_id === packet.packet_id, "Response packet ID mismatch");
  invariant(response.packet_sha256 === packet.packet_sha256, "Response packet SHA-256 mismatch");
  invariant(response.dataset_id === packet.dataset_id, "Response dataset ID mismatch");
  invariant(response.dataset_sha256 === packet.dataset_sha256, "Response dataset SHA-256 mismatch");
  invariant(response.codebook_version === packet.codebook_version, "Response codebook version mismatch");
  invariant(response.annotator_id === packet.annotator_id, "Response annotator identity mismatch");
  if (expectedAnnotatorId !== undefined) {
    invariant(response.annotator_id === expectedAnnotatorId, "Response annotator identity mismatch");
  }
  exactCoverage(
    response.decisions.map((decision) => decision.item_id),
    packet.items.map((item) => item.item_id),
    "Response"
  );
  for (const decision of response.decisions) validateEvidence(decision, packet);
  return response;
}

function normalizedDecision(decision: AnnotationDecision): unknown {
  return {
    decision_status: decision.decision_status,
    reliable: decision.reliable,
    primary_failure: decision.primary_failure,
    failures: [...decision.failures].sort(),
    evidence: decision.evidence
      .map((evidence) => ({ ...evidence }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    required_checks: [...decision.required_checks].sort()
  };
}

function normalizedEvidence(decision: AnnotationDecision): string {
  return canonicalJson(
    decision.evidence
      .map((evidence) => ({ ...evidence }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  );
}

function setEquals(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((item, index) => item === [...right].sort()[index])
  );
}

export type DisagreementReason =
  | "non_final"
  | "binary_reliability"
  | "primary_failure"
  | "failure_set"
  | "evidence"
  | "required_checks";

export type Disagreement = {
  item_id: string;
  disagreement_reasons: DisagreementReason[];
  annotation_a: AnnotationDecision;
  annotation_b: AnnotationDecision;
};

export type AgreementComparison = {
  annotation_schema_version: typeof ANNOTATION_SCHEMA_VERSION;
  dataset_id: string;
  dataset_sha256: string;
  codebook_version: string;
  annotator_ids: readonly [string, string];
  response_sha256s: readonly [string, string];
  item_count: number;
  binary: {
    comparable_count: number;
    agreement_count: number;
    raw_agreement: number | null;
    cohen_kappa: number | null;
    kappa_status: "computed" | "no_comparable_items" | "degenerate_no_variance";
  };
  multilabel: {
    comparable_count: number;
    exact_set_agreement_count: number;
    exact_set_agreement: number | null;
    mean_jaccard: number | null;
    empty_sets_score_as_one: true;
  };
  agreement_item_ids: string[];
  disagreements: Disagreement[];
  comparison_sha256: string;
};

function comparisonSha256(
  comparison: Omit<AgreementComparison, "comparison_sha256"> | AgreementComparison
): string {
  const { comparison_sha256: _comparisonSha256, ...contents } =
    comparison as AgreementComparison;
  return computeCanonicalSha256(contents);
}

function cohenKappa(left: readonly boolean[], right: readonly boolean[]) {
  if (left.length === 0) {
    return {
      agreement_count: 0,
      raw_agreement: null,
      cohen_kappa: null,
      kappa_status: "no_comparable_items" as const
    };
  }
  const agreementCount = left.filter((label, index) => label === right[index]).length;
  const observed = agreementCount / left.length;
  const leftPositive = left.filter(Boolean).length / left.length;
  const rightPositive = right.filter(Boolean).length / right.length;
  const expected =
    leftPositive * rightPositive + (1 - leftPositive) * (1 - rightPositive);
  if (Math.abs(1 - expected) < Number.EPSILON * 16) {
    return {
      agreement_count: agreementCount,
      raw_agreement: observed,
      cohen_kappa: null,
      kappa_status: "degenerate_no_variance" as const
    };
  }
  return {
    agreement_count: agreementCount,
    raw_agreement: observed,
    cohen_kappa: (observed - expected) / (1 - expected),
    kappa_status: "computed" as const
  };
}

function jaccard(left: readonly FailureLabel[], right: readonly FailureLabel[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  return [...leftSet].filter((label) => rightSet.has(label)).length / union.size;
}

export function compareAnnotationResponses(args: {
  input_file: BenchmarkInputFile;
  packet_a: AnnotationPacket;
  response_a: AnnotationResponse;
  packet_b: AnnotationPacket;
  response_b: AnnotationResponse;
}): AgreementComparison {
  const inputFile = BenchmarkInputFileSchema.parse(args.input_file);
  const packetA = validateAnnotationPacket(args.packet_a, inputFile);
  const packetB = validateAnnotationPacket(args.packet_b, inputFile);
  const responseA = validateAnnotationResponse(args.response_a, packetA, inputFile);
  const responseB = validateAnnotationResponse(args.response_b, packetB, inputFile);
  invariant(
    responseA.annotator_id !== responseB.annotator_id,
    "Agreement requires two distinct annotator identities"
  );
  invariant(packetA.dataset_sha256 === packetB.dataset_sha256, "Packet dataset hashes differ");
  invariant(packetA.codebook_version === packetB.codebook_version, "Packet codebook versions differ");

  const decisionsA = new Map(responseA.decisions.map((item) => [item.item_id, item]));
  const decisionsB = new Map(responseB.decisions.map((item) => [item.item_id, item]));
  const ids = [...itemIndex(inputFile).keys()].sort();
  const disagreements: Disagreement[] = [];
  const agreementItemIds: string[] = [];
  const comparableA: boolean[] = [];
  const comparableB: boolean[] = [];
  const multilabelScores: number[] = [];
  let exactSetAgreementCount = 0;

  for (const id of ids) {
    const left = decisionsA.get(id);
    const right = decisionsB.get(id);
    invariant(left !== undefined && right !== undefined, `Missing compared item ${id}`);
    const reasons: DisagreementReason[] = [];
    if (left.decision_status !== "final" || right.decision_status !== "final") {
      reasons.push("non_final");
    } else {
      invariant(left.reliable !== null && right.reliable !== null, "Final labels cannot be null");
      comparableA.push(left.reliable);
      comparableB.push(right.reliable);
      if (left.reliable !== right.reliable) reasons.push("binary_reliability");
      if (left.primary_failure !== right.primary_failure) reasons.push("primary_failure");
      if (!setEquals(left.failures, right.failures)) reasons.push("failure_set");
      if (normalizedEvidence(left) !== normalizedEvidence(right)) reasons.push("evidence");
      if (!setEquals(left.required_checks, right.required_checks)) {
        reasons.push("required_checks");
      }
      const score = jaccard(left.failures, right.failures);
      multilabelScores.push(score);
      if (setEquals(left.failures, right.failures)) exactSetAgreementCount += 1;
    }
    if (reasons.length === 0) {
      agreementItemIds.push(id);
    } else {
      disagreements.push({
        item_id: id,
        disagreement_reasons: reasons,
        annotation_a: left,
        annotation_b: right
      });
    }
  }

  const binary = cohenKappa(comparableA, comparableB);
  const withoutHash = {
    annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
    dataset_id: inputFile.dataset_id,
    dataset_sha256: computeDatasetSha256(inputFile),
    codebook_version: packetA.codebook_version,
    annotator_ids: [responseA.annotator_id, responseB.annotator_id] as const,
    response_sha256s: [
      computeCanonicalSha256(responseA),
      computeCanonicalSha256(responseB)
    ] as const,
    item_count: ids.length,
    binary: {
      comparable_count: comparableA.length,
      ...binary
    },
    multilabel: {
      comparable_count: multilabelScores.length,
      exact_set_agreement_count: exactSetAgreementCount,
      exact_set_agreement:
        multilabelScores.length === 0
          ? null
          : exactSetAgreementCount / multilabelScores.length,
      mean_jaccard:
        multilabelScores.length === 0
          ? null
          : multilabelScores.reduce((sum, value) => sum + value, 0) /
            multilabelScores.length,
      empty_sets_score_as_one: true as const
    },
    agreement_item_ids: agreementItemIds,
    disagreements
  };
  return {
    ...withoutHash,
    comparison_sha256: comparisonSha256(
      withoutHash as Omit<AgreementComparison, "comparison_sha256">
    )
  };
}

export function createAdjudicationPacket(
  rawInputFile: BenchmarkInputFile,
  comparison: AgreementComparison,
  options: { adjudicator_id: string; created_at: string }
): AdjudicationPacket {
  const inputFile = BenchmarkInputFileSchema.parse(rawInputFile);
  invariant(
    comparisonSha256(comparison) === comparison.comparison_sha256,
    "Comparison SHA-256 mismatch"
  );
  invariant(
    comparison.dataset_sha256 === computeDatasetSha256(inputFile),
    "Comparison dataset SHA-256 mismatch"
  );
  const inputs = itemIndex(inputFile);
  const packetId = `adjudication-${sha256(
    `${comparison.comparison_sha256}\0${options.adjudicator_id}\0${options.created_at}`
  ).slice(0, 24)}`;
  const withoutHash = {
    annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
    packet_id: packetId,
    comparison_sha256: comparison.comparison_sha256,
    dataset_id: comparison.dataset_id,
    dataset_sha256: comparison.dataset_sha256,
    codebook_version: comparison.codebook_version,
    annotator_ids: comparison.annotator_ids,
    adjudicator_id: options.adjudicator_id,
    created_at: options.created_at,
    items: comparison.disagreements.map((disagreement) => {
      const input = inputs.get(disagreement.item_id);
      invariant(input !== undefined, `Unknown comparison item ${disagreement.item_id}`);
      return {
        item_id: disagreement.item_id,
        trace_sha256: packetItem(inputFile, input).trace_sha256,
        lines: packetItem(inputFile, input).lines,
        disagreement_reasons: disagreement.disagreement_reasons,
        annotation_a: disagreement.annotation_a,
        annotation_b: disagreement.annotation_b
      };
    })
  };
  return AdjudicationPacketSchema.parse({
    ...withoutHash,
    packet_sha256: computeAdjudicationPacketSha256(
      withoutHash as Omit<AdjudicationPacket, "packet_sha256">
    )
  });
}

function validateAdjudicationPacketAgainstInput(
  rawPacket: AdjudicationPacket,
  rawInputFile: BenchmarkInputFile
): AdjudicationPacket {
  const packet = AdjudicationPacketSchema.parse(rawPacket);
  const inputFile = BenchmarkInputFileSchema.parse(rawInputFile);
  invariant(packet.dataset_id === inputFile.dataset_id, "Adjudication dataset ID mismatch");
  invariant(
    packet.dataset_sha256 === computeDatasetSha256(inputFile),
    "Adjudication dataset SHA-256 mismatch"
  );
  const inputs = itemIndex(inputFile);
  for (const item of packet.items) {
    const input = inputs.get(item.item_id);
    invariant(input !== undefined, `Unknown adjudication item ${item.item_id}`);
    const expectedItem = packetItem(inputFile, input);
    invariant(item.trace_sha256 === expectedItem.trace_sha256, `Trace hash mismatch for ${item.item_id}`);
    invariant(
      canonicalJson(item.lines) === canonicalJson(expectedItem.lines),
      `Trace lines mismatch for ${item.item_id}`
    );
    invariant(item.annotation_a.item_id === item.item_id, "Annotation A item ID mismatch");
    invariant(item.annotation_b.item_id === item.item_id, "Annotation B item ID mismatch");
  }
  return packet;
}

export function validateAdjudicationResponse(
  rawResponse: AdjudicationResponse,
  rawPacket: AdjudicationPacket,
  rawInputFile: BenchmarkInputFile,
  expectedAdjudicatorId?: string
): AdjudicationResponse {
  const packet = validateAdjudicationPacketAgainstInput(rawPacket, rawInputFile);
  const response = AdjudicationResponseSchema.parse(rawResponse);
  invariant(response.packet_id === packet.packet_id, "Adjudication response packet ID mismatch");
  invariant(
    response.packet_sha256 === packet.packet_sha256,
    "Adjudication response packet SHA-256 mismatch"
  );
  invariant(
    response.comparison_sha256 === packet.comparison_sha256,
    "Adjudication response comparison SHA-256 mismatch"
  );
  invariant(response.dataset_id === packet.dataset_id, "Adjudication response dataset ID mismatch");
  invariant(
    response.dataset_sha256 === packet.dataset_sha256,
    "Adjudication response dataset SHA-256 mismatch"
  );
  invariant(
    response.codebook_version === packet.codebook_version,
    "Adjudication response codebook version mismatch"
  );
  invariant(
    response.adjudicator_id === packet.adjudicator_id,
    "Adjudicator identity mismatch"
  );
  if (expectedAdjudicatorId !== undefined) {
    invariant(response.adjudicator_id === expectedAdjudicatorId, "Adjudicator identity mismatch");
  }
  exactCoverage(
    response.decisions.map((decision) => decision.item_id),
    packet.items.map((item) => item.item_id),
    "Adjudication response"
  );
  const packetItems = new Map(packet.items.map((item) => [item.item_id, item]));
  const packetAsAnnotationPacket = {
    ...packet,
    annotator_id: packet.annotator_ids[0],
    items: packet.items.map(({ item_id, trace_sha256, lines }) => ({
      item_id,
      trace_sha256,
      lines
    }))
  } as unknown as AnnotationPacket;
  for (const resolution of response.decisions) {
    const item = packetItems.get(resolution.item_id);
    invariant(item !== undefined, `Unknown adjudication item ${resolution.item_id}`);
    validateEvidence(resolution.decision, packetAsAnnotationPacket);
    if (resolution.resolution === "annotation_a") {
      invariant(
        canonicalJson(resolution.decision) === canonicalJson(item.annotation_a),
        `Resolution ${resolution.item_id} does not exactly match annotation A`
      );
    }
    if (resolution.resolution === "annotation_b") {
      invariant(
        canonicalJson(resolution.decision) === canonicalJson(item.annotation_b),
        `Resolution ${resolution.item_id} does not exactly match annotation B`
      );
    }
  }
  return response;
}

export type FrozenRecordProvenance = {
  case_id: string;
  item_id: string;
  resolution: "independent_agreement" | "adjudicated";
  decision_sha256: string;
  source_response_sha256s: string[];
  annotator_ids: readonly [string, string];
  adjudicator_id: string | null;
};

export type FrozenLabelExport = {
  annotation_schema_version: typeof ANNOTATION_SCHEMA_VERSION;
  dataset_id: string;
  dataset_sha256: string;
  codebook_version: string;
  label_sha256: string;
  label_file: BenchmarkLabelFile;
  provenance: FrozenRecordProvenance[];
  original_responses: {
    annotation_a: AnnotationResponse;
    annotation_b: AnnotationResponse;
    adjudication: AdjudicationResponse | null;
  };
};

function finalDecision(decision: AnnotationDecision): asserts decision is AnnotationDecision & {
  decision_status: "final";
  reliable: boolean;
} {
  invariant(decision.decision_status === "final", "Only final decisions can be frozen");
  invariant(decision.reliable !== null, "Final decision reliability cannot be null");
  AnnotationDecisionSchema.parse(decision);
}

function expectedAdjudicationItems(
  comparison: AgreementComparison,
  packet: AdjudicationPacket
): void {
  invariant(
    packet.comparison_sha256 === comparison.comparison_sha256,
    "Adjudication packet does not belong to this comparison"
  );
  exactCoverage(
    packet.items.map((item) => item.item_id),
    comparison.disagreements.map((item) => item.item_id),
    "Adjudication packet"
  );
  const disagreements = new Map(comparison.disagreements.map((item) => [item.item_id, item]));
  for (const item of packet.items) {
    const expected = disagreements.get(item.item_id);
    invariant(expected !== undefined, `Unexpected adjudication item ${item.item_id}`);
    invariant(
      canonicalJson(item.disagreement_reasons) ===
        canonicalJson(expected.disagreement_reasons) &&
        canonicalJson(item.annotation_a) === canonicalJson(expected.annotation_a) &&
        canonicalJson(item.annotation_b) === canonicalJson(expected.annotation_b),
      `Adjudication item ${item.item_id} does not match the comparison`
    );
  }
}

export function exportFrozenLabels(args: {
  input_file: BenchmarkInputFile;
  packet_a: AnnotationPacket;
  response_a: AnnotationResponse;
  packet_b: AnnotationPacket;
  response_b: AnnotationResponse;
  adjudication_packet?: AdjudicationPacket;
  adjudication_response?: AdjudicationResponse;
}): FrozenLabelExport {
  const inputFile = BenchmarkInputFileSchema.parse(args.input_file);
  const responseA = validateAnnotationResponse(args.response_a, args.packet_a, inputFile);
  const responseB = validateAnnotationResponse(args.response_b, args.packet_b, inputFile);
  const comparison = compareAnnotationResponses({
    input_file: inputFile,
    packet_a: args.packet_a,
    response_a: responseA,
    packet_b: args.packet_b,
    response_b: responseB
  });
  const responseHashA = computeCanonicalSha256(responseA);
  const responseHashB = computeCanonicalSha256(responseB);
  let adjudicationResponse: AdjudicationResponse | null = null;
  if (comparison.disagreements.length > 0) {
    invariant(
      args.adjudication_packet !== undefined && args.adjudication_response !== undefined,
      `Cannot freeze ${comparison.disagreements.length} unresolved disagreement(s)`
    );
    const packet = validateAdjudicationPacketAgainstInput(
      args.adjudication_packet,
      inputFile
    );
    expectedAdjudicationItems(comparison, packet);
    adjudicationResponse = validateAdjudicationResponse(
      args.adjudication_response,
      packet,
      inputFile
    );
  } else {
    invariant(
      args.adjudication_packet === undefined && args.adjudication_response === undefined,
      "Adjudication artifacts are not allowed when the independent responses fully agree"
    );
  }

  const decisionsA = new Map(responseA.decisions.map((item) => [item.item_id, item]));
  const adjudicated = new Map(
    (adjudicationResponse?.decisions ?? []).map((item) => [item.item_id, item.decision])
  );
  const disagreements = new Set(comparison.disagreements.map((item) => item.item_id));
  const provenance: FrozenRecordProvenance[] = [];
  const labels = inputFile.cases.map((input) => {
    const itemId = blindItemId(inputFile, input);
    const wasAdjudicated = disagreements.has(itemId);
    const decision = wasAdjudicated ? adjudicated.get(itemId) : decisionsA.get(itemId);
    invariant(decision !== undefined, `No final resolution for ${itemId}`);
    finalDecision(decision);
    const adjudicationHash =
      adjudicationResponse === null ? null : computeCanonicalSha256(adjudicationResponse);
    provenance.push({
      case_id: input.case_id,
      item_id: itemId,
      resolution: wasAdjudicated ? "adjudicated" : "independent_agreement",
      decision_sha256: computeCanonicalSha256(normalizedDecision(decision)),
      source_response_sha256s: [
        responseHashA,
        responseHashB,
        ...(wasAdjudicated && adjudicationHash !== null ? [adjudicationHash] : [])
      ],
      annotator_ids: [responseA.annotator_id, responseB.annotator_id],
      adjudicator_id: wasAdjudicated ? (adjudicationResponse?.adjudicator_id ?? null) : null
    });
    return {
      schema_version: BENCHMARK_SCHEMA_VERSION,
      case_id: input.case_id,
      reliable: decision.reliable,
      primary_failure: decision.primary_failure,
      failures: [...decision.failures].sort(),
      gold_evidence: decision.evidence.map((evidence) => ({
        line_start: evidence.line_start,
        line_end: evidence.line_end,
        quote: restoreEvidenceQuote(evidence.quote, input, itemId),
        kind: evidence.kind as "supports_reliability" | "supports_failure",
        failure: evidence.failure,
        rationale: evidence.rationale
      })),
      required_checks: [...decision.required_checks].sort(),
      review_status: "frozen" as const,
      annotation_notes: wasAdjudicated
        ? "Frozen after recorded adjudication; original responses and provenance are retained in the audit export."
        : "Frozen after matching independent final responses; original responses and provenance are retained in the audit export."
    };
  });
  const labelFile = BenchmarkLabelFileSchema.parse({
    schema_version: BENCHMARK_SCHEMA_VERSION,
    dataset_id: inputFile.dataset_id,
    labels
  });
  return {
    annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
    dataset_id: inputFile.dataset_id,
    dataset_sha256: computeDatasetSha256(inputFile),
    codebook_version: args.packet_a.codebook_version,
    label_sha256: computeCanonicalSha256(labelFile),
    label_file: labelFile,
    provenance,
    original_responses: {
      annotation_a: responseA,
      annotation_b: responseB,
      adjudication: adjudicationResponse
    }
  };
}

export function createFreezeManifest(
  frozen: FrozenLabelExport,
  options: {
    freeze_id: string;
    generated_at: string;
    accepted_at: string | null;
    acceptance_status: "accepted" | "rejected";
    acceptance_notes: string;
  }
): FreezeManifest {
  const responseA = AnnotationResponseSchema.parse(frozen.original_responses.annotation_a);
  const responseB = AnnotationResponseSchema.parse(frozen.original_responses.annotation_b);
  const adjudication =
    frozen.original_responses.adjudication === null
      ? null
      : AdjudicationResponseSchema.parse(frozen.original_responses.adjudication);
  invariant(
    computeCanonicalSha256(BenchmarkLabelFileSchema.parse(frozen.label_file)) ===
      frozen.label_sha256,
    "Frozen label SHA-256 mismatch"
  );
  invariant(
    responseA.dataset_sha256 === frozen.dataset_sha256 &&
      responseB.dataset_sha256 === frozen.dataset_sha256,
    "Frozen response dataset SHA-256 mismatch"
  );
  invariant(
    responseA.codebook_version === frozen.codebook_version &&
      responseB.codebook_version === frozen.codebook_version,
    "Frozen response codebook version mismatch"
  );
  return FreezeManifestSchema.parse({
    annotation_schema_version: ANNOTATION_SCHEMA_VERSION,
    freeze_id: options.freeze_id,
    dataset_id: frozen.dataset_id,
    dataset_sha256: frozen.dataset_sha256,
    label_sha256: frozen.label_sha256,
    codebook_version: frozen.codebook_version,
    annotator_ids: [responseA.annotator_id, responseB.annotator_id],
    adjudicator_id: adjudication?.adjudicator_id ?? null,
    response_sha256s: {
      annotation_a: computeCanonicalSha256(responseA),
      annotation_b: computeCanonicalSha256(responseB),
      adjudication: adjudication === null ? null : computeCanonicalSha256(adjudication)
    },
    response_timestamps: {
      annotation_a: responseA.submitted_at,
      annotation_b: responseB.submitted_at,
      adjudication: adjudication?.submitted_at ?? null
    },
    generated_at: options.generated_at,
    accepted_at: options.accepted_at,
    acceptance_status: options.acceptance_status,
    acceptance_notes: options.acceptance_notes,
    response_files_supplied: true
  });
}
