import { describe, expect, it } from "vitest";

import {
  adaptGenericJson,
  canonicalTraceEventSchema,
  normalizedTraceSchema
} from "../lib/trace";

const allEventTypesFixture = {
  events: [
    {
      type: "message",
      event_id: "message-1",
      sequence: 10,
      timestamp: "2026-08-16T12:00:00Z",
      role: "assistant",
      content: "I will create the artifact.",
      provenance: "declared"
    },
    {
      type: "tool_call",
      event_id: "call-event-1",
      sequence: 11,
      timestamp: 1_776_339_601,
      call_id: "call-1",
      parent_id: "message-1",
      name: "create_file",
      arguments: { path: "release.md" },
      status: "running"
    },
    {
      type: "tool_result",
      event_id: "result-event-1",
      sequence: 12,
      call_id: "call-1",
      result: { path: "release.md", bytes: 42 },
      status: "succeeded",
      provenance: "verified"
    },
    {
      type: "artifact",
      event_id: "artifact-1",
      sequence: 13,
      name: "release notes",
      path: "/tmp/release.md",
      mime_type: "text/markdown",
      status: "succeeded"
    },
    {
      type: "error",
      event_id: "error-1",
      sequence: 14,
      error: { message: "A later optional check failed", code: "CHECK_FAILED" }
    },
    {
      type: "state_change",
      event_id: "state-1",
      sequence: 15,
      state: { name: "phase", from: "running", to: "complete" }
    }
  ]
};

describe("canonical trace schema", () => {
  it("represents every P0 event type with identity, source, status, and provenance", () => {
    const trace = adaptGenericJson(allEventTypesFixture, { redact: false });

    expect(trace.events.map((event) => event.type)).toEqual([
      "message",
      "tool_call",
      "tool_result",
      "artifact",
      "error",
      "state_change"
    ]);
    expect(trace.adapter_version).toBe("1.0.0");
    expect(trace.events.every((event) => canonicalTraceEventSchema.safeParse(event).success)).toBe(true);
    expect(normalizedTraceSchema.safeParse(trace).success).toBe(true);
  });

  it("preserves supplied event IDs, sequence, timestamp, call ID, and parent ID", () => {
    const trace = adaptGenericJson(allEventTypesFixture, { redact: false });
    const call = trace.events.find((event) => event.type === "tool_call");

    expect(call).toMatchObject({
      event_id: "call-event-1",
      sequence: 11,
      timestamp: 1_776_339_601,
      call_id: "call-1",
      parent_id: "message-1",
      provenance: "recorded",
      source: {
        format: "generic_json",
        path: "$.events[1]"
      }
    });
    expect(trace.call_pairs).toEqual([
      expect.objectContaining({
        call_id: "call-1",
        call_event_id: "call-event-1",
        result_event_id: "result-event-1",
        status: "succeeded",
        provenance: "recorded"
      })
    ]);
  });
});
