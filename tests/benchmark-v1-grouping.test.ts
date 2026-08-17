import { describe, expect, it } from "vitest";

import { BenchmarkInputSchema, type BenchmarkInput } from "../evals/v1/schema";
import {
  assignInputSplit,
  assignSplit,
  computeTraceSha256,
  validateGrouping
} from "../evals/v1/validation";

function input(
  caseId: string,
  groupId: string,
  trace: string,
  overrides: Partial<BenchmarkInput> = {}
): BenchmarkInput {
  return BenchmarkInputSchema.parse({
    schema_version: "1.0.0",
    case_id: caseId,
    split: "dev",
    group_id: groupId,
    task_type: "status_verification",
    domain: "software_operations",
    style_tags: ["confident"],
    trace,
    trace_sha256: computeTraceSha256(trace),
    source_metadata: {
      origin: "synthetic",
      source_id: `fixture:${caseId}`,
      legacy: false,
      development_only: true,
      unseen: false
    },
    ...overrides
  });
}

describe("Benchmark v1 grouping", () => {
  it("assigns a stable split from the group rather than the case", () => {
    const left = input("pair-left", "shared-group", "User: A\nAgent: A", {
      counterfactual_pair_id: "pair-one"
    });
    const right = input("pair-right", "shared-group", "User: A\nAgent: B", {
      counterfactual_pair_id: "pair-one"
    });

    const assignedLeft = assignInputSplit(left, "agenteval-v1");
    const assignedRight = assignInputSplit(right, "agenteval-v1");

    expect(assignedLeft.split).toBe(assignedRight.split);
    expect(assignedLeft.split).toBe("test");
    expect(assignSplit("group:shared-group", "agenteval-v1")).toBe("test");
  });

  it("accepts a two-member counterfactual pair in one split", () => {
    const members = [
      input("pair-left", "shared-group", "User: A\nAgent: A", {
        counterfactual_pair_id: "pair-one"
      }),
      input("pair-right", "shared-group", "User: A\nAgent: B", {
        counterfactual_pair_id: "pair-one"
      })
    ];

    expect(validateGrouping(members)).toEqual([]);
  });

  it("rejects incomplete pairs and groups that cross splits", () => {
    const left = input("pair-left", "shared-group", "User: A\nAgent: A", {
      counterfactual_pair_id: "pair-one"
    });
    const right = input("pair-right", "shared-group", "User: A\nAgent: B", {
      counterfactual_pair_id: "pair-one",
      split: "test"
    });

    expect(validateGrouping([left, right]).map((issue) => issue.code)).toEqual([
      "group_crosses_split",
      "pair_crosses_split"
    ]);
    expect(validateGrouping([left]).map((issue) => issue.code)).toEqual([
      "pair_size"
    ]);
  });

  it("requires counterfactual pairs to share one split unit", () => {
    const left = input("pair-left", "left-group", "User: A\nAgent: A", {
      counterfactual_pair_id: "pair-one"
    });
    const right = input("pair-right", "right-group", "User: A\nAgent: B", {
      counterfactual_pair_id: "pair-one"
    });

    expect(validateGrouping([left, right]).map((issue) => issue.code)).toEqual([
      "pair_group_mismatch"
    ]);
  });

  it("validates style-pair size, group, and split isolation", () => {
    const left = input("style-left", "style-group", "User: A\nAgent: A", {
      style_pair_id: "style-one"
    });
    const right = input("style-right", "other-group", "User: A\nAgent: B", {
      style_pair_id: "style-one",
      split: "test"
    });

    expect(validateGrouping([left]).map((issue) => issue.code)).toEqual([
      "style_pair_size"
    ]);
    expect(validateGrouping([left, right]).map((issue) => issue.code)).toEqual([
      "style_pair_crosses_split",
      "style_pair_group_mismatch"
    ]);
  });
});
