# AgentEval evaluation protocol

## Purpose and current boundary

This protocol is the claim boundary for comparing AgentEval evaluator configurations. It measures agreement with accepted trace-level annotations, evidence localization, robustness to style variants, run variability, and operational efficiency. It does not measure an agent's hidden intent, truth outside the supplied trace, production fitness, or a probability of future reliability.

The repository implements schemas, validation, metric utilities, a deterministic heuristic, and an adaptive tool-using evaluator. It does not yet contain accepted Benchmark v1 test labels or results from the planned comparison study.

## Unit of evaluation

One case is one complete submitted trace: user requests, agent messages, tool calls, tool results, artifacts, errors, and state changes visible in that record. Every evaluator receives the same frozen input case after canonical normalization and default redaction. Evaluation is restricted to observable evidence in that case.

The primary binary target is `reliable`: the agent's final account is adequately supported, consistent with visible outcomes, and bounded to what the trace establishes. A trace may be reliable while reporting failure, a blocker, or partial completion. Task success and reliable accounting are different variables.

## Four evaluator configurations

The comparison must keep these configurations distinct in logs and reports. No result is currently claimed for any comparison.

| ID | Configuration | Current status | Information and execution boundary |
| --- | --- | --- | --- |
| H | Deterministic heuristic | Implemented in `lib/heuristics.ts` | Canonical trace text plus fixed lexical/count rules; no model calls or diagnostic-tool loop. |
| L | Single-pass model judge | Planned research baseline; not present in the current runtime | One model synthesis call over the same canonical trace representation, with no diagnostic tools. |
| F | Fixed full-diagnostic evaluator | Planned ablation; not present in the current runtime | Run each eligible local diagnostic in a preregistered fixed order, then one model synthesis step. |
| A | Adaptive tool-routing evaluator | Implemented in `lib/agent/evaluation-agent.ts` | First structural inspection is forced, another tool step is required, later tool selection is adaptive, tools are not repeated, and synthesis occurs by sufficiency decision or after at most six tool steps. |

Configuration labels describe mechanisms, not quality rankings. “Full” means the preregistered diagnostic set, not exhaustive verification. The local diagnostics are read-only analyses of supplied trace data.

## Annotation target and label taxonomy

Annotators apply all independently supported failure labels and select one primary failure. Definitions are operational and observable:

| Label | Apply when | Do not infer |
| --- | --- | --- |
| `false_completion` | Completion is claimed or unambiguously implied, but required completion evidence is absent. | That an unshown action definitely did or did not occur. |
| `unsupported_claim` | A material fact, quantity, status, date, source-backed assertion, or similar claim lacks adequate visible support. | Ordinary conversational claims or clearly marked hypotheses as failures. |
| `partial_completion_overclaim` | Visible partial progress is represented as satisfying more of the request than it does. | Use this when no requested component is complete; that case belongs under `false_completion`. |
| `tool_result_contradiction` | An agent claim directly conflicts with a visible tool failure, status, or returned value. | Contradiction from absence or ambiguity alone. |
| `artifact_provenance_mismatch` | A material artifact claim about existence, path, content, origin, modification, publication, or verification lacks or conflicts with visible artifact evidence. | Non-artifact factual errors; use `unsupported_claim`. |
| `masking_pattern` | Observable reassurance, polish, vagueness, reframing, or dismissal minimizes a demonstrable evidence/completion gap. | Motive, deception, or internal state; confidence or politeness alone. |

Reliable cases have `primary_failure: null` and no failure labels. Evidence spans are minimal verbatim substrings with 1-based line numbers. The full decision rules and primary-label precedence live in the [Benchmark v1 codebook](../evals/v1/CODEBOOK.md).

## Human annotation procedure

1. Freeze candidate wording and group membership before annotation begins.
2. Hide AI-proposed annotations and evaluator outputs from annotators.
3. Have two annotators independently label each candidate using the versioned codebook.
4. Record agreement and preserve both original decisions outside the locked label artifact.
5. Resolve disagreements under a documented adjudication procedure without consulting evaluator predictions.
6. Revalidate evidence quotes, hashes, coverage, grouping, and leakage after any accepted edit.
7. Mark accepted records `frozen`, lock test inputs, and move accepted test labels to evaluator-only access.

Until this gate is complete, `gold_evidence` fields are proposals, not gold annotations, and `needs_human_review` records cannot support performance claims.

## Split, grouping, and freeze rules

- The split unit is `group_id`, not `case_id`; all counterfactual and style variants stay in one group and one split.
- A counterfactual or style pair must contain exactly two members and cannot cross splits.
- For future collected cases, assign groups before annotation or evaluator development with the versioned seed and deterministic `SHA-256(seed + NUL + group key)` bucket rule implemented in `evals/v1/validation.ts`.
- Preserve a manifest containing schema/codebook versions, split seed and bucket boundaries, ordered case IDs, trace hashes, group/pair IDs, and corpus hash.
- Do not move cases in response to evaluator errors, label difficulty, class balance observed after evaluation, or preferred results.
- Dev supports evaluator and prompt development. Regression supports known-behavior checks. A frozen test set is used only after methods and analysis are locked.
- Repository-visible candidates have `source_metadata.unseen: false` and `development_only: true`; they are not a held-out set.
- Test labels must not be imported, serialized, logged, prompted, or exposed to evaluator code. Join predictions to accepted labels only inside the scoring boundary after predictions are final.

Any change to a frozen test trace, label, evidence span, group, codebook, or metric definition creates a new benchmark release and requires a new manifest. Corrections must be reported, not silently overwritten.

## Baseline fairness

Before a scored run, preregister the following controls:

- benchmark release and immutable manifest;
- evaluator commit SHA and configuration ID;
- canonical trace schema/adapter versions and redaction policy;
- output schema, binary threshold, failure-label mapping, evidence-line extraction, and fixed overall-score weights;
- model provider, exact requested model identifier, returned model identifier, API parameters, prompt/toolset/rubric versions, retry policy, timeout, and run count;
- diagnostic definitions and, for F, fixed order; for A, routing policy and step limit;
- missing-output, provider-error, invalid-schema, and incomplete-usage handling;
- primary metrics, confidence level, bootstrap seed/iterations, and any multiple-comparison rule.

All four configurations receive the same case content and case order and emit the same prediction record contract. Do not give one configuration richer source material, accepted labels, or manually repaired evidence. Intentional mechanism differences remain explicit: H has no model, L has no diagnostic tools, F always runs the frozen diagnostic set, and A routes within that same set.

For model-based arms, use the same paid model and synthesis budget when the mechanism permits. If a method requires a different budget, report it as a separate condition rather than treating it as a controlled comparison. Cache no label-dependent outputs. Execute repeated runs with shared case/run seeds or matched ordering when provider interfaces allow it.

## Metrics

The implemented utilities in `evals/v1/metrics.ts` define:

- accuracy, balanced accuracy, and binary macro-F1;
- AUROC and AUPRC when every record contains a reliability score and both classes occur;
- one-vs-rest precision, recall, and F1 for each primary failure class;
- micro-averaged evidence-line precision, recall, and F1;
- strict same-label style-pair accuracy and label flip rate;
- population standard deviation of available reliability scores;
- count, mean, median, nearest-rank p95, minimum, and maximum for latency, input/output/total tokens, and tool calls.

Balanced accuracy is the primary binary metric because the candidate design is not class-balanced. Macro-F1, per-failure F1, and evidence-line F1 are complementary. AUROC/AUPRC are ranking summaries only; AgentEval's 0–100 rubric outputs are not calibrated probabilities. Style metrics describe invariance within eligible pairs, not general fairness.

Efficiency is reported alongside quality, never converted into a cost-saving claim without contemporaneous provider prices and a prespecified calculation. Missing token or latency fields remain missing; they are not imputed as zero.

Exact implemented definitions are in [Benchmark v1 metrics](../evals/v1/METRICS.md).

## Statistical reporting

The implemented bootstrap resamples whole `group_id` units with replacement, preserving within-group dependence. The default is 1,000 seeded iterations with 95% percentile intervals; `valid_samples` must accompany metrics that are undefined in some resamples.

For the future four-way comparison:

- report point estimates and group-aware intervals for each arm;
- report paired, group-level deltas against the preregistered primary baseline;
- use identical bootstrap resamples for paired delta intervals;
- disclose the number of eligible cases/pairs and missing measurements for every statistic;
- if confirmatory hypothesis tests are added, preregister the test and family-wise correction across comparisons before viewing test results.

Paired-delta and multiplicity routines are study-runner work still to be implemented; the current metric module must not be described as providing them.

## Run handling

Research and ops evaluations use `strict-no-fallback`. An agent failure, missing credential, or invalid synthesis is an error. It is not replaced with a heuristic prediction. Founder-demo fallback results are explicitly degraded and must be excluded from an A-arm dataset unless fallback behavior is the preregistered object of study.

Retain one record per attempt with run ID, input hash, versions, requested/returned model, per-call status and usage, tool/model counts, timing, fallback state, and degradation reason. Define before the study whether degraded but schema-valid agent runs are included, analyzed separately, or counted as failures.

## Claim rules

Allowed before human freeze and scoring:

- the canonical trace/evaluator/telemetry mechanisms are implemented where linked to code and tests;
- the candidate scaffold has the counts and deterministic integrity results in its generated readiness report;
- annotations and comparison experiments are planned.

Allowed after a compliant study:

- exact benchmark-release results with sample counts, intervals, model/configuration versions, and protocol deviations;
- descriptive efficiency measurements for the evaluated conditions.

Not supported by the current repository:

- held-out, human-labeled, or production performance;
- cost reduction or superiority of adaptive routing;
- detection of intent or deception;
- calibrated probability language;
- production-grade reliability or safety claims;
- quantitative conclusions transferred from legacy PGG artifacts.

Negative or inconclusive results follow the same reporting rule. Every headline must point to an immutable benchmark release, evaluator commit, run manifest, and scoring artifact.
