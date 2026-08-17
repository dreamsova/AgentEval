import { createHash } from "node:crypto";

import type {
  BenchmarkInput,
  BenchmarkInputFile,
  BenchmarkLabelFile,
  BenchmarkSplit
} from "./schema";

export type ValidationIssue = {
  code:
    | "duplicate_case_id"
    | "duplicate_trace"
    | "group_crosses_split"
    | "label_input_mismatch"
    | "pair_crosses_split"
    | "pair_group_mismatch"
    | "pair_size"
    | "style_pair_crosses_split"
    | "style_pair_group_mismatch"
    | "style_pair_size"
    | "trace_hash_mismatch";
  message: string;
  case_ids: string[];
};

export type NearDuplicate = {
  left_case_id: string;
  right_case_id: string;
  left_split: BenchmarkSplit;
  right_split: BenchmarkSplit;
  similarity: number;
};

export const DEFAULT_SPLIT_BUCKETS = {
  dev: 6000,
  regression: 2000,
  test: 2000
} as const;

export function normalizeTrace(trace: string): string {
  return trace.replace(/\r\n?/g, "\n");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function computeTraceSha256(trace: string): string {
  return sha256(normalizeTrace(trace));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeCanonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function splitUnitKey(input: Pick<BenchmarkInput, "group_id">): string {
  return `group:${input.group_id}`;
}

export function assignSplit(
  unitKey: string,
  seed: string,
  buckets: Readonly<Record<BenchmarkSplit, number>> = DEFAULT_SPLIT_BUCKETS
): BenchmarkSplit {
  const total = buckets.dev + buckets.regression + buckets.test;
  if (total !== 10_000 || Object.values(buckets).some((value) => value < 0)) {
    throw new Error("Split buckets must be non-negative and sum to 10,000");
  }

  const digestPrefix = sha256(`${seed}\0${unitKey}`).slice(0, 12);
  const bucket = Number.parseInt(digestPrefix, 16) % 10_000;
  if (bucket < buckets.dev) return "dev";
  if (bucket < buckets.dev + buckets.regression) return "regression";
  return "test";
}

export function assignInputSplit<T extends BenchmarkInput>(
  input: T,
  seed: string,
  buckets?: Readonly<Record<BenchmarkSplit, number>>
): T {
  return {
    ...input,
    split: assignSplit(splitUnitKey(input), seed, buckets)
  };
}

export function validateTraceHashes(inputs: readonly BenchmarkInput[]): ValidationIssue[] {
  return inputs.flatMap((input) =>
    computeTraceSha256(input.trace) === input.trace_sha256
      ? []
      : [
          {
            code: "trace_hash_mismatch" as const,
            message: `Trace hash mismatch for ${input.case_id}`,
            case_ids: [input.case_id]
          }
        ]
  );
}

function indexBy<T>(
  inputs: readonly T[],
  key: (input: T) => string | undefined
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const input of inputs) {
    const value = key(input);
    if (value === undefined) continue;
    index.set(value, [...(index.get(value) ?? []), input]);
  }
  return index;
}

export function validateGrouping(inputs: readonly BenchmarkInput[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const groups = indexBy(inputs, (input) => input.group_id);
  const pairs = indexBy(inputs, (input) => input.counterfactual_pair_id);
  const stylePairs = indexBy(inputs, (input) => input.style_pair_id);

  for (const [groupId, members] of groups) {
    if (new Set(members.map((member) => member.split)).size > 1) {
      issues.push({
        code: "group_crosses_split",
        message: `Group ${groupId} crosses dataset splits`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
  }

  for (const [pairId, members] of pairs) {
    if (members.length !== 2) {
      issues.push({
        code: "pair_size",
        message: `Counterfactual pair ${pairId} must contain exactly two cases`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
    if (new Set(members.map((member) => member.split)).size > 1) {
      issues.push({
        code: "pair_crosses_split",
        message: `Counterfactual pair ${pairId} crosses dataset splits`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
    if (new Set(members.map((member) => member.group_id)).size > 1) {
      issues.push({
        code: "pair_group_mismatch",
        message: `Counterfactual pair ${pairId} must belong to one group`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
  }

  for (const [pairId, members] of stylePairs) {
    if (members.length !== 2) {
      issues.push({
        code: "style_pair_size",
        message: `Style pair ${pairId} must contain exactly two cases`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
    if (new Set(members.map((member) => member.split)).size > 1) {
      issues.push({
        code: "style_pair_crosses_split",
        message: `Style pair ${pairId} crosses dataset splits`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
    if (new Set(members.map((member) => member.group_id)).size > 1) {
      issues.push({
        code: "style_pair_group_mismatch",
        message: `Style pair ${pairId} must belong to one group`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
  }

  return issues;
}

export function detectCrossSplitLeakage(
  inputs: readonly BenchmarkInput[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = indexBy(inputs, (input) => input.case_id);
  const traces = indexBy(inputs, (input) => computeTraceSha256(input.trace));

  for (const [caseId, members] of ids) {
    if (members.length > 1) {
      issues.push({
        code: "duplicate_case_id",
        message: `Case ID ${caseId} occurs more than once`,
        case_ids: members.map((member) => member.case_id)
      });
    }
  }

  for (const [traceHash, members] of traces) {
    if (new Set(members.map((member) => member.split)).size > 1) {
      issues.push({
        code: "duplicate_trace",
        message: `Trace ${traceHash} occurs in multiple splits`,
        case_ids: members.map((member) => member.case_id).sort()
      });
    }
  }

  return [...issues, ...validateGrouping(inputs)];
}

export function detectDuplicateTraces(
  inputs: readonly BenchmarkInput[]
): ValidationIssue[] {
  const traces = indexBy(inputs, (input) => computeTraceSha256(input.trace));
  return [...traces.entries()].flatMap(([traceHash, members]) =>
    members.length < 2
      ? []
      : [
          {
            code: "duplicate_trace" as const,
            message: `Trace ${traceHash} occurs more than once`,
            case_ids: members.map((member) => member.case_id).sort()
          }
        ]
  );
}

function traceShingles(trace: string, size: number): Set<string> {
  const tokens = normalizeTrace(trace)
    .toLowerCase()
    .match(/[a-z0-9./:_-]+/g) ?? [];
  if (tokens.length < size) return new Set(tokens);
  return new Set(
    Array.from({ length: tokens.length - size + 1 }, (_, index) =>
      tokens.slice(index, index + size).join(" ")
    )
  );
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / union.size;
}

export function detectNearDuplicateTraces(
  inputs: readonly BenchmarkInput[],
  options: {
    threshold?: number;
    shingle_size?: number;
    cross_split_only?: boolean;
    exclude_same_group?: boolean;
  } = {}
): NearDuplicate[] {
  const threshold = options.threshold ?? 0.82;
  const shingleSize = options.shingle_size ?? 3;
  if (threshold < 0 || threshold > 1) {
    throw new Error("Near-duplicate threshold must be between 0 and 1");
  }
  if (!Number.isInteger(shingleSize) || shingleSize < 1) {
    throw new Error("Near-duplicate shingle size must be a positive integer");
  }

  const shingles = inputs.map((input) => traceShingles(input.trace, shingleSize));
  const matches: NearDuplicate[] = [];
  for (let leftIndex = 0; leftIndex < inputs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < inputs.length; rightIndex += 1) {
      const left = inputs[leftIndex];
      const right = inputs[rightIndex];
      if (options.cross_split_only && left.split === right.split) continue;
      if (options.exclude_same_group !== false && left.group_id === right.group_id) {
        continue;
      }
      const similarity = jaccard(shingles[leftIndex], shingles[rightIndex]);
      if (similarity >= threshold) {
        matches.push({
          left_case_id: left.case_id,
          right_case_id: right.case_id,
          left_split: left.split,
          right_split: right.split,
          similarity
        });
      }
    }
  }
  return matches.sort(
    (left, right) =>
      right.similarity - left.similarity ||
      left.left_case_id.localeCompare(right.left_case_id) ||
      left.right_case_id.localeCompare(right.right_case_id)
  );
}

export function validateInputLabelCoverage(
  inputFile: BenchmarkInputFile,
  labelFile: BenchmarkLabelFile
): ValidationIssue[] {
  const inputIds = new Set(inputFile.cases.map((item) => item.case_id));
  const labelIds = new Set(labelFile.labels.map((item) => item.case_id));
  const missingLabels = [...inputIds].filter((id) => !labelIds.has(id));
  const orphanLabels = [...labelIds].filter((id) => !inputIds.has(id));

  if (
    inputFile.dataset_id === labelFile.dataset_id &&
    missingLabels.length === 0 &&
    orphanLabels.length === 0
  ) {
    return [];
  }

  return [
    {
      code: "label_input_mismatch",
      message: `Input/label mismatch: dataset IDs ${inputFile.dataset_id}/${labelFile.dataset_id}, ${missingLabels.length} missing labels, ${orphanLabels.length} orphan labels`,
      case_ids: [...missingLabels, ...orphanLabels].sort()
    }
  ];
}
