import { describe, expect, it } from "vitest";

import {
  adaptGenericJson,
  adaptLegacyText,
  adaptOpenAIResponses,
  normalizeTrace
} from "../lib/trace";

const legacyFixture = `[2026-08-16T10:00:00Z] User: Create release.md.
Agent: I will create and verify it.
Tool: create_file arguments={"path":"release.md"}
Tool: result success output={"path":"release.md","bytes":12}
Agent: Done.`;

const openAIResponsesFixture = {
  id: "resp_123",
  created_at: 1_776_339_600,
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_123",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Running deployment." }]
    },
    {
      type: "function_call",
      id: "fc_123",
      call_id: "call_123",
      name: "deploy",
      arguments: "{\"target\":\"staging\"}",
      status: "completed"
    },
    {
      type: "function_call_output",
      id: "fco_123",
      call_id: "call_123",
      output: { error: "access denied" },
      status: "failed"
    }
  ]
};

describe("trace adapters", () => {
  it("keeps legacy plain text supported and marks its inferred link as lossy", () => {
    const trace = adaptLegacyText(legacyFixture, { redact: false });

    expect(trace.source_format).toBe("legacy_text");
    expect(trace.events.filter((event) => event.type === "message")).toHaveLength(3);
    expect(trace.events.find((event) => event.type === "message")).toMatchObject({
      timestamp: "2026-08-16T10:00:00Z",
      provenance: "declared"
    });
    expect(trace.call_pairs[0]).toMatchObject({
      result_event_id: "legacy:4:tool_result",
      status: "succeeded",
      provenance: "declared"
    });
    expect(trace.diagnostics.map((item) => item.code)).toContain(
      "INFERRED_CALL_LINK"
    );
    expect(trace.lossy).toBe(true);
  });

  it("normalizes OpenAI Responses output items and preserves transport IDs", () => {
    const trace = adaptOpenAIResponses(openAIResponsesFixture, {
      redact: false
    });

    expect(trace.source_format).toBe("openai_responses");
    expect(trace.events.find((event) => event.event_id === "fc_123")).toMatchObject({
      type: "tool_call",
      call_id: "call_123",
      timestamp: 1_776_339_600,
      arguments: { target: "staging" },
      provenance: "recorded",
      source: { format: "openai_responses" }
    });
    expect(trace.events.find((event) => event.event_id === "fco_123")).toMatchObject({
      type: "tool_result",
      call_id: "call_123",
      status: "failed"
    });
    expect(trace.call_pairs[0]).toMatchObject({
      call_id: "call_123",
      call_event_id: "fc_123",
      result_event_id: "fco_123",
      status: "failed"
    });
  });

  it("adapts generic chat messages with nested tool calls and tool-role results", () => {
    const trace = adaptGenericJson(
      {
        messages: [
          { role: "user", content: "Deploy staging." },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "chat-call-1",
                type: "function",
                function: {
                  name: "deploy",
                  arguments: "{\"target\":\"staging\"}"
                }
              }
            ]
          },
          {
            role: "tool",
            tool_call_id: "chat-call-1",
            content: { error: "quota exceeded" },
            status: "failed"
          }
        ]
      },
      { redact: false }
    );

    expect(trace.events.find((event) => event.type === "tool_call")).toMatchObject({
      event_id: "chat-call-1",
      call_id: "chat-call-1",
      tool_name: "deploy",
      arguments: { target: "staging" }
    });
    expect(trace.call_pairs[0]).toMatchObject({
      call_id: "chat-call-1",
      status: "failed"
    });
  });

  it("uses completed OpenAI stream items once and ignores superseded deltas", () => {
    const trace = adaptOpenAIResponses(
      [
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "fc_stream",
            call_id: "call_stream",
            name: "search",
            arguments: ""
          }
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_stream",
          delta: "{\"q\":\"trace\"}"
        },
        {
          type: "response.output_item.done",
          item: {
            type: "function_call",
            id: "fc_stream",
            call_id: "call_stream",
            name: "search",
            arguments: "{\"q\":\"trace\"}",
            status: "completed"
          }
        }
      ],
      { redact: false }
    );

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({
      event_id: "fc_stream",
      arguments: { q: "trace" }
    });
    expect(trace.diagnostics.map((item) => item.code)).not.toContain(
      "INCOMPLETE_STREAM_DELTA"
    );
  });

  it("auto-detects JSON and legacy inputs and diagnoses invalid JSON-looking input", () => {
    expect(normalizeTrace(legacyFixture).source_format).toBe("legacy_text");
    expect(normalizeTrace(openAIResponsesFixture).source_format).toBe(
      "openai_responses"
    );
    expect(
      normalizeTrace([{ role: "user", content: "hello" }]).source_format
    ).toBe("generic_json");

    const malformed = adaptGenericJson('{"events": [}');
    expect(malformed.events).toEqual([]);
    expect(malformed.diagnostics).toEqual([
      expect.objectContaining({
        code: "INVALID_JSON",
        severity: "error",
        category: "parsing"
      })
    ]);
    expect(malformed.lossy).toBe(true);
  });
});
