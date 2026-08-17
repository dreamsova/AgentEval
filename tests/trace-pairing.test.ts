import { describe, expect, it } from "vitest";

import {
  adaptGenericJson,
  getExecutionEvidenceForEvent
} from "../lib/trace";

const identitySensitiveFixture = {
  events: [
    {
      type: "message",
      event_id: "claim-alpha",
      role: "assistant",
      content: "Deployment alpha succeeded.",
      provenance: "declared"
    },
    {
      type: "tool_call",
      event_id: "call-alpha-event",
      call_id: "call-alpha",
      parent_id: "claim-alpha",
      name: "deploy",
      arguments: { target: "alpha" },
      status: "running"
    },
    {
      type: "tool_call",
      event_id: "call-beta-event",
      call_id: "call-beta",
      name: "deploy",
      arguments: { target: "beta" },
      status: "running"
    },
    {
      type: "tool_result",
      event_id: "result-beta-event",
      call_id: "call-beta",
      status: "succeeded",
      result: { target: "beta", deployed: true }
    },
    {
      type: "tool_result",
      event_id: "result-alpha-event",
      call_id: "call-alpha",
      status: "failed",
      result: { target: "alpha", error: "permission denied" }
    }
  ]
};

describe("trace call/result pairing", () => {
  it("does not let an unrelated successful action satisfy another call identity", () => {
    const trace = adaptGenericJson(identitySensitiveFixture, { redact: false });
    const alphaPair = trace.call_pairs.find(
      (pair) => pair.call_event_id === "call-alpha-event"
    );
    const betaPair = trace.call_pairs.find(
      (pair) => pair.call_event_id === "call-beta-event"
    );

    expect(alphaPair).toMatchObject({
      call_id: "call-alpha",
      result_event_id: "result-alpha-event",
      status: "failed"
    });
    expect(betaPair).toMatchObject({
      call_id: "call-beta",
      result_event_id: "result-beta-event",
      status: "succeeded"
    });
    expect(alphaPair?.result_event_id).not.toBe("result-beta-event");

    const claimEvidence = getExecutionEvidenceForEvent(trace, "claim-alpha");
    expect(claimEvidence).toEqual([
      expect.objectContaining({
        parent_event_id: "claim-alpha",
        call_event_id: "call-alpha-event",
        result_event_id: "result-alpha-event",
        status: "failed"
      })
    ]);
    expect(claimEvidence.some((item) => item.status === "succeeded")).toBe(false);
  });

  it("keeps failed tool results failed even when another result succeeds", () => {
    const trace = adaptGenericJson(identitySensitiveFixture, { redact: false });
    const failedResult = trace.events.find(
      (event) => event.event_id === "result-alpha-event"
    );

    expect(failedResult).toMatchObject({
      type: "tool_result",
      call_id: "call-alpha",
      status: "failed"
    });
  });

  it("surfaces orphaned and malformed identity rather than proximity-pairing", () => {
    const trace = adaptGenericJson(
      {
        events: [
          {
            type: "tool_call",
            event_id: "missing-call-id",
            name: "write_file",
            arguments: { path: "a.txt" }
          },
          {
            type: "tool_result",
            event_id: "orphan-result",
            call_id: "different-call",
            result: "ok",
            status: "succeeded"
          },
          42,
          { type: "unknown_future_event", payload: true }
        ]
      },
      { redact: false }
    );

    expect(trace.call_pairs[0]).toMatchObject({
      call_event_id: "missing-call-id",
      result_event_id: null
    });
    expect(trace.orphan_result_event_ids).toEqual(["orphan-result"]);
    expect(trace.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "MISSING_CALL_ID",
        "ORPHAN_TOOL_RESULT",
        "MALFORMED_EVENT",
        "UNSUPPORTED_EVENT",
        "UNMATCHED_TOOL_CALL"
      ])
    );
    expect(trace.lossy).toBe(true);
  });
});
