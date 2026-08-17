import { describe, expect, it } from "vitest";

import { prepareEvaluationTrace } from "../lib/evaluation-input";

describe("prepared evaluation input", () => {
  it("produces deterministic hashes independent of JSON object key order", () => {
    const left = prepareEvaluationTrace({
      events: [
        {
          type: "tool_call",
          event_id: "call-event",
          call_id: "call-1",
          name: "write",
          arguments: { path: "a.txt", content: "hello" }
        }
      ]
    });
    const right = prepareEvaluationTrace({
      events: [
        {
          arguments: { content: "hello", path: "a.txt" },
          name: "write",
          call_id: "call-1",
          event_id: "call-event",
          type: "tool_call"
        }
      ]
    });

    expect(left.input_hash).toBe(right.input_hash);
    expect(left.input_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("hashes the redacted canonical input and never exposes raw secrets", () => {
    const first = prepareEvaluationTrace({
      events: [
        {
          type: "message",
          role: "user",
          content: "Bearer first-private-token-value"
        }
      ]
    });
    const second = prepareEvaluationTrace({
      events: [
        {
          type: "message",
          role: "user",
          content: "Bearer second-private-token-value"
        }
      ]
    });

    expect(first.safe_text).not.toContain("first-private-token-value");
    expect(first.normalized_trace.redaction.applied).toBe(true);
    expect(first.input_hash).toBe(second.input_hash);
  });
});
