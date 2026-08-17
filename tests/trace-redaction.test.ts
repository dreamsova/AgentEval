import { describe, expect, it } from "vitest";

import {
  adaptGenericJson,
  formatTraceForEvaluation,
  REDACTED_VALUE,
  serializeNormalizedTrace
} from "../lib/trace";

const secretFixture = {
  events: [
    {
      type: "tool_call",
      event_id: "safe-event-id",
      call_id: "safe-call-id",
      name: "request",
      arguments: {
        api_key: "sk-exampleSecretValue12345",
        token: "plain-secret-token-value",
        headers: { authorization: "Bearer super-secret-token-123" },
        note: "Use github_pat_abcdefghijklmnopqrstuvwxyz123456"
      }
    },
    {
      type: "tool_result",
      event_id: "safe-result-id",
      call_id: "safe-call-id",
      status: "succeeded",
      result: { cookie: "session=private", body: "ok" }
    }
  ]
};

describe("trace secret redaction", () => {
  it("redacts common secret fields and token patterns by default", () => {
    const trace = adaptGenericJson(secretFixture);
    const serialized = JSON.stringify(trace);
    const call = trace.events.find((event) => event.type === "tool_call");

    expect(serialized).not.toContain("exampleSecretValue");
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("plain-secret-token-value");
    expect(serialized).not.toContain("session=private");
    expect(serialized).toContain(REDACTED_VALUE);
    expect(call).toMatchObject({
      event_id: "safe-event-id",
      call_id: "safe-call-id"
    });
    expect(trace.redaction.applied).toBe(true);
    expect(trace.redaction.count).toBeGreaterThanOrEqual(5);
    expect(trace.diagnostics.map((item) => item.code)).toContain(
      "REDACTED_SECRET"
    );
  });

  it("redacts at evaluation and serialization boundaries even if parsing opted out", () => {
    const unredacted = adaptGenericJson(secretFixture, { redact: false });

    expect(JSON.stringify(unredacted.events)).toContain("exampleSecretValue");
    expect(formatTraceForEvaluation(unredacted)).not.toContain(
      "exampleSecretValue"
    );
    expect(serializeNormalizedTrace(unredacted)).not.toContain(
      "exampleSecretValue"
    );
  });
});
