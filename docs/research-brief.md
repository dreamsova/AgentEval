# AgentEval research brief

## Problem

Agent outputs can report completion, confidence, or artifact status without enough visible execution evidence to justify those statements. Language quality alone cannot establish that a tool succeeded, an artifact exists, or the requested scope was completed. AgentEval studies whether an evaluator can make trace-level reliability judgments that are evidence-linked, auditable, and operationally measurable.

The target is bounded: assess the final account against observable trace content. The system does not infer hidden intent, establish facts outside the trace, or produce calibrated probabilities.

## System design

AgentEval normalizes legacy text, generic JSON, and OpenAI Responses data into a versioned canonical event graph. Events carry identity, status, source pointers, and `declared`/`recorded`/`verified` provenance. Calls and results pair only by explicit identity. Default redaction precedes evaluator formatting and input hashing.

The implemented adaptive evaluator uses a bounded Responses API loop over six read-only diagnostics. It inspects trace structure first, then routes among claim extraction, execution evidence, claim/action alignment, observable masking-language patterns, and evidence sufficiency. The model returns rubric dimensions and cited evidence; the server computes the overall score with fixed, versioned weights.

Research and ops modes fail closed when the model is unavailable or fails. Founder-demo alone may return a prominently degraded heuristic fallback. Each report carries versions, requested/returned model IDs, per-call status/latency/token fields, call counts, timing, fallback state, and degradation reasons.

## Benchmark protocol

Benchmark v1 defines one trace per case, a binary reliability target, six observable failure labels, evidence spans, required checks, group/pair metadata, deterministic hashes, and strict schemas. Groups keep counterfactual and style variants in one split. Predictions are finalized before accepted test labels are joined inside the scoring boundary.

The planned study compares four configurations: implemented deterministic heuristics, a planned single-pass model judge, a planned fixed full-diagnostic evaluator, and the implemented adaptive tool router. Fairness controls require the same frozen cases and prediction contract, matched model/budget settings where the mechanism permits, explicit failure handling, and versioned run manifests.

Primary reporting uses balanced accuracy, with macro-F1, per-failure and evidence-line metrics, style-pair measures, ranking metrics when defined, variability, and efficiency aggregates. Confidence intervals resample whole groups. No comparison result has been produced.

## Current evidence

The current evidence is implementation and data-readiness evidence:

- canonical trace adapters, schemas, pairing, redaction, and hashing are present with automated tests;
- fallback policy, telemetry, deterministic score aggregation, and mocked adaptive-loop behavior are tested;
- the generated Benchmark v1 readiness report records all deterministic scaffold checks passing;
- the repository-visible scaffold contains 24 dev/regression items and 60 test candidates, with proposed annotations separated from test inputs.

This evidence supports “implemented mechanism” and “candidate scaffold ready for human annotation.” It does not support evaluator accuracy, held-out generalization, human agreement, cost savings, or production readiness.

## Limitations

- All current Benchmark v1 annotations are proposals marked `needs_human_review`.
- Repository-visible candidates are development-only and explicitly not unseen.
- No paid-model four-way experiment has been run.
- Generic input can assert provenance; trusted deployments must enforce who may assign `verified`.
- Explicit trace identity does not verify external-world state.
- Pattern-based redaction and lexical diagnostics are incomplete.
- Model synthesis can vary, and usage fields may be unavailable from the provider.
- The public rate limiter is in-memory and not a durable distributed control.

Legacy Public Goods Game work is exploratory motivation only: it helped frame questions about language/behavior gaps and monitoring cost. Its provenance has not been restored here, so its quantitative headlines are not evidence for this system and are not carried into the AgentEval claims.

## Next experiment

Independently double-annotate the 60 candidates without exposing AI-proposed labels; record agreement, adjudicate conflicts, rerun integrity/leakage checks, and freeze a versioned test release with labels outside evaluator access. Then preregister and run the four evaluator configurations on the same accepted cases, using paid model calls only after model, budget, retry, run-count, and statistical rules are fixed. Publish predictions, manifests, protocol deviations, group-aware intervals, and descriptive efficiency measurements together, including negative or inconclusive findings.

Detailed contracts: [evaluation protocol](evaluation-protocol.md), [Benchmark v1 status](benchmark-v1.md), and [structured traces](structured-traces.md).
