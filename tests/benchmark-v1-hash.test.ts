import { describe, expect, it } from "vitest";

import devInputsJson from "../evals/v1/datasets/dev/inputs.json";
import { BenchmarkInputFileSchema, BenchmarkInputSchema } from "../evals/v1/schema";
import {
  canonicalJson,
  computeCanonicalSha256,
  computeTraceSha256,
  validateTraceHashes
} from "../evals/v1/validation";

describe("Benchmark v1 hashing", () => {
  it("uses SHA-256 and normalizes line endings only", () => {
    expect(computeTraceSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(computeTraceSha256("a\r\nb\rc")).toBe(computeTraceSha256("a\nb\nc"));
    expect(computeTraceSha256("abc ")).not.toBe(computeTraceSha256("abc"));
  });

  it("canonicalizes object keys before hashing", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}'
    );
    expect(computeCanonicalSha256({ a: 1, b: 2 })).toBe(
      computeCanonicalSha256({ b: 2, a: 1 })
    );
  });

  it("validates committed hashes and rejects a mutated trace", () => {
    const parsed = BenchmarkInputFileSchema.parse(devInputsJson);
    expect(validateTraceHashes(parsed.cases)).toEqual([]);

    const mutated = {
      ...devInputsJson.cases[0],
      trace: `${devInputsJson.cases[0].trace} changed`
    };
    expect(BenchmarkInputSchema.safeParse(mutated).success).toBe(false);
  });
});
