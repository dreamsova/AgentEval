# Structured traces and provenance

## Canonical contract

AgentEval converts supported inputs to `NormalizedTrace` before evaluation. The current trace schema and adapter versions are both `1.0.0`.

A normalized trace contains:

- `source_format`: `legacy_text`, `generic_json`, or `openai_responses`;
- ordered canonical `events`;
- explicitly identified tool-call/result `call_pairs`;
- orphan result IDs and structured diagnostics;
- a `lossy` flag;
- a redaction summary;
- schema and adapter versions.

The strict Zod contract is implemented in `lib/trace/schema.ts`; TypeScript definitions are in `lib/trace/types.ts`.

## Event types

Every event has `event_id`, non-negative `sequence`, `source`, `status`, and `provenance`. It may also have `timestamp`, `call_id`, and `parent_id`.

| Type | Type-specific content |
| --- | --- |
| `message` | Role and JSON-compatible content. |
| `tool_call` | Tool name and arguments. |
| `tool_result` | Optional tool name and result. |
| `artifact` | Optional name, URI, MIME type, operation, and data. |
| `error` | Message plus optional code/details; status is failed. |
| `state_change` | Optional name/from/to/value state fields. |

Statuses are `pending`, `running`, `succeeded`, `failed`, `cancelled`, or `unknown`. Source pointers retain the adapter format and, when available, JSON path, line, index, and raw event type.

## Provenance levels

Provenance describes how an event entered the evidence record, not how persuasive its content sounds.

| Level | Meaning | Canonical completion support |
| --- | --- | --- |
| `declared` | Asserted in prose or supplied without execution evidence. | Rejected. |
| `recorded` | Emitted by a structured runtime or tool transport. It records an observation but is not independently checked. | Eligible only when successful and explicitly linked. |
| `verified` | Independently checked by a trusted verifier under the deployment's ingestion policy. | Eligible only when successful and explicitly linked. |

The schema accepts an explicit provenance value from generic structured inputs. Therefore, `verified` is not cryptographic attestation: the application embedding AgentEval must authenticate trusted sources and decide which adapters or callers may assert it. Untrusted user input should not gain stronger evidentiary weight merely by writing `"provenance": "verified"`.

## Adapter behavior

### Legacy text

Line-oriented roles and tool markers are mapped to canonical events. Events default to `declared`. Adjacent call/result lines may receive a synthetic identity with an `INFERRED_CALL_LINK` diagnostic, which marks normalization lossy. Independently of parser loss, research telemetry treats all `legacy_text` input as lossy and the evaluator marks it degraded because claim/action alignment uses proximity rather than canonical identity.

Legacy support is compatibility behavior, not equivalent evidence to structured runtime events.

### Generic JSON

Generic message, tool, artifact, error, and state shapes are mapped to canonical events. Structured events default to `recorded` unless a recognized provenance field supplies another allowed level. Missing or malformed fields generate diagnostics; JSON-looking values that cannot be parsed are preserved as text and marked with a warning.

### OpenAI Responses

Response output and supported stream/envelope forms are converted to canonical events while retaining available item/call identity and source pointers. The adapter delegates normalized event parsing to the structured JSON machinery and defaults structured runtime events to `recorded`.

Auto-detection selects legacy text for non-JSON strings, OpenAI Responses when recognizable response structures exist, and generic JSON otherwise. Ambiguous or malformed input may be preserved with diagnostics; consumers must inspect `lossy` and `diagnostics` rather than assume perfect conversion.

## Identity and pairing

Tool calls and results pair only through explicit identity:

1. matching `call_id`; or
2. a result `parent_id` that names a tool-call `event_id`.

Tool name and array proximity are never canonical pairing evidence. Duplicate IDs, missing IDs, unmatched calls, and orphan results produce diagnostics. A pair's provenance is the weaker provenance of its call and result; its status carries failure/cancellation from either side and otherwise uses the result status when present.

A completion claim is canonically supported only when a successful pair or artifact is explicitly connected to that claim through parent/event identity and has `recorded` or `verified` provenance. A successful but unrelated event, a failed/cancelled/unknown result, or `declared` evidence does not support the claim.

## Redaction, serialization, and input hash

All public adapters redact recognized secret-field names and common bearer/API/token/private-key patterns by default. Evaluation formatting and normalized serialization also redact by default. Redaction returns a copy, adds a diagnostic when values change, and records the number of matches.

`prepareEvaluationTrace` normalizes and redacts once, then derives:

- line-oriented evaluator text with event identity, status, and provenance;
- a `sha256:` input hash over the redacted normalized evidence payload, including schema/adapter/source information, events, call pairs, orphan IDs, and the lossy flag.

The hash supports run identification and reproducibility checks. It is not a signature of the original unredacted input, an authenticity proof, or a content-addressed guarantee about external artifacts.

Redaction is pattern-based and not complete DLP. Callers should minimize submitted data and remove secrets before ingestion.

## Degradation and fail-closed use

Agent reports record `degraded: true` with machine-readable reasons when normalization is lossy, the source is legacy text, a diagnostic fails, or the tool-step limit is reached. `research-eval` and `ops-reliability` do not replace an unavailable or failed model run with heuristics. Founder-demo may do so only as a prominently labeled degraded fallback.

Degradation is metadata, not a numerical correction. Research protocols must decide before evaluation whether each degradation class is excluded, analyzed separately, or counted as a run failure.

## Example

```json
{
  "type": "tool_result",
  "event_id": "result-7",
  "sequence": 4,
  "call_id": "call-7",
  "parent_id": "call-event-7",
  "source": {
    "format": "generic_json",
    "path": "$[4]",
    "index": 4,
    "raw_type": "tool_result"
  },
  "status": "succeeded",
  "provenance": "recorded",
  "tool_name": "write_file",
  "result": {
    "path": "docs/output.md"
  }
}
```

This event can pair with a call sharing `call-7`, but it supports a completion claim only if the claim/call graph is also explicitly linked. The path string alone does not verify the external file.

## Known limitations

- Adapters normalize common shapes; they do not reconstruct missing runtime identity.
- Provenance trust is policy-controlled, not authenticated by the schema.
- Explicit linkage establishes trace lineage, not external-world truth.
- Secret redaction can have false negatives and false positives.
- Lexical claim and masking-pattern extraction can miss paraphrases or overselect ambiguous language.
- Plain text remains a degraded compatibility path and should not be used as equivalent evidence in a structured-trace benchmark.
