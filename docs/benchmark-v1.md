# Benchmark v1: candidate readiness

## Status

Benchmark v1 is a deterministic data and scoring scaffold prepared for independent human annotation. It is **not ready for benchmark scoring or performance claims**.

The committed [data-readiness report](../evals/v1/reports/data-readiness.md) says:

- scaffold ready: yes;
- benchmark scoring ready: no;
- 84 total repository-visible cases;
- every proposed annotation has `review_status: needs_human_review`;
- every repository-visible input has `source_metadata.unseen: false`.

These are data-integrity facts, not evaluator results.

## Current inventory

| Split directory | Cases | Proposed reliable/unreliable | Intended use now |
| --- | ---: | ---: | --- |
| `evals/v1/datasets/dev/` | 16 | 8 / 8 | Development material only. |
| `evals/v1/datasets/regression/` | 8 | 2 / 6 | Development/regression material only. |
| `evals/v1/datasets/test/inputs.json` | 60 | 24 / 36 in the separate proposal file | Test candidates awaiting blinded human annotation. |

The 60 test candidates form 30 counterfactual pairs. Six same-label style pairs are embedded in those groups. Candidate proposals cover six domains, seven task types across the complete scaffold, all declared style tags, and six proposed primary failure classes. Balance and coverage are construction/readiness properties; human review may change accepted labels and therefore requires the report to be regenerated.

## Files and trust boundaries

- [Benchmark v1 overview](../evals/v1/README.md) describes the versioned layout.
- [Input and label schemas](../evals/v1/schema.ts) enforce record shape and label invariants.
- [Annotation codebook](../evals/v1/CODEBOOK.md) defines observable labels and review states.
- [Validation utilities](../evals/v1/validation.ts) implement hashes, deterministic group split assignment, grouping checks, and duplicate detection.
- [Coverage utilities](../evals/v1/coverage.ts) construct the deterministic readiness report.
- [Metric utilities](../evals/v1/metrics.ts) score already-joined prediction records without loading evaluator inputs or labels.
- [Metric definitions](../evals/v1/METRICS.md) state the scoring contract.
- `evals/v1/datasets/test-labels/candidate-labels.json` contains AI-proposed labels for review tooling. Evaluator code must never import it.

The candidate-label file is not a private gold-label store. Separation in the repository prevents an accidental direct import path in the intended runner design, but it is not an access-control boundary. Accepted test labels must eventually live in evaluator-only storage and be joined only after predictions are finalized.

## Observable label taxonomy

| Proposed label | Observable question |
| --- | --- |
| `false_completion` | Does the trace support the claimed completion? |
| `unsupported_claim` | Is a material factual or status claim grounded in visible evidence? |
| `partial_completion_overclaim` | Is visible partial progress described as satisfying too much of the request? |
| `tool_result_contradiction` | Does an agent claim conflict with an explicit tool outcome? |
| `artifact_provenance_mismatch` | Does visible artifact evidence support the claimed path, content, origin, change, publication, or verification? |
| `masking_pattern` | Does observable gap-minimizing language accompany a demonstrable substantive gap? |

`masking_pattern` is a discourse label. It does not label motive or hidden internal state. Annotators may apply multiple supported failures, then choose one primary failure using the codebook precedence and the decisive evidence.

## Deterministic checks already represented

The generated report records passing checks for:

- expected dev/regression and test-candidate counts;
- proposed reliability, primary-failure, domain, task-type, and style coverage;
- counterfactual/style pair structure;
- candidate visibility and human-review status;
- input/label coverage and evidence anchors;
- trace SHA-256 integrity;
- group isolation;
- exact duplicates and cross-split duplicate leakage;
- cross-split near duplicates using lowercase token 3-gram Jaccard similarity at threshold `0.82`, excluding intentional same-group pairs.

Trace hashing normalizes only `CRLF` or `CR` to `LF`, then hashes UTF-8 with SHA-256. It does not trim whitespace. The corpus hash in the current generated report is `4e4b2fbcacc632ca622eeab94ca3df18bbd4732d2ea1e2d1fbd5bb2f89a43433`.

Passing these checks establishes that the candidate scaffold matches its deterministic contract. It does not establish annotation correctness, evaluator accuracy, generalization, or absence of semantic overlap below the configured near-duplicate rule.

## Split and freeze policy

Groups, not individual cases, are the split unit. Counterfactual and style-pair members must remain together. The implemented assignment utility hashes `seed + NUL + group key` into 10,000 buckets; the default boundaries are 60% dev, 20% regression, and 20% test.

For an accepted release:

1. choose groups and split seed before annotation or evaluator development;
2. independently annotate candidates without the AI proposals or evaluator predictions;
3. complete a second independent pass and recorded conflict resolution;
4. rerun schema, evidence-anchor, hash, grouping, exact-duplicate, and near-duplicate checks;
5. freeze codebook, traces, labels, pair/group IDs, and the release manifest;
6. isolate accepted test labels from evaluator access;
7. finalize predictions before joining them to labels inside the scoring boundary.

No case may move because of evaluator errors or desired balance after evaluation. A correction to a frozen trace or label requires a new release identifier and regenerated hashes.

## Planned evaluator study

After the human gate, the protocol compares:

1. implemented deterministic heuristics;
2. a planned single-pass model judge without diagnostic tools;
3. a planned fixed full-diagnostic evaluator;
4. the implemented adaptive tool-routing evaluator.

No paid-model Benchmark v1 study has been run. The comparison design, baseline fairness rules, metrics, group-aware confidence intervals, run-failure handling, and claim policy are specified in the [evaluation protocol](evaluation-protocol.md).

## Scoring outputs

The implemented metric contract supports balanced accuracy, binary macro-F1, AUROC/AUPRC when defined, per-primary-failure precision/recall/F1, evidence-line metrics, style-pair accuracy and flip rate, score variability, efficiency aggregates, and deterministic group-aware bootstrap intervals.

Metric availability is not evidence of measured performance. No Benchmark v1 result should be published until accepted labels are frozen, evaluator configurations are preregistered, predictions are finalized without label access, and the scoring artifact is retained.

## Claim-safe summary

Use: “Benchmark v1 has a deterministically validated, repository-visible candidate scaffold ready for independent human annotation.”

Do not use: “human-labeled,” “held out,” “validated accuracy,” “production benchmark,” or any evaluator-performance or cost headline.
