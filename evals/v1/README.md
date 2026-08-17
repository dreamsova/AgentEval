# AgentEval Benchmark v1

This directory contains the versioned Benchmark v1 data contract, deterministic validation and metric utilities, annotation codebook, separated dataset records, and generated readiness report.

## Dataset layout

- `datasets/dev/inputs.json` and `datasets/dev/labels.json`: 16 repository-visible development cases.
- `datasets/regression/inputs.json` and `datasets/regression/labels.json`: 8 repository-visible regression cases.
- `datasets/test/inputs.json`: 60 repository-visible frozen-test candidates. These are candidates, not an accepted test set.
- `datasets/test-labels/candidate-labels.json`: AI-proposed candidate annotations stored separately from test inputs for review tooling. Evaluator code must not import this file.
- `reports/data-readiness.md` and `.json`: deterministic count, balance, coverage, grouping, hash, duplicate, and near-duplicate results.

The 12 original `evals/benchmark.json` cases are preserved exactly and supplemented by 12 AI-authored dev/regression candidates. The test-candidate scaffold contains 24 reliable and 36 unreliable proposals, with six cases for each primary failure class, ten cases per domain, all style tags, 30 intact counterfactual pairs, and six same-label style pairs. Every committed proposed label uses `review_status: needs_human_review`; all repository-visible inputs use `unseen: false`.

No current v1 annotation is approved for benchmark scoring. The candidate label file exists to support blinded human review and conflict resolution, not evaluator tuning or performance claims.

## Determinism and leakage controls

Trace hashes normalize only line endings (`CRLF` and `CR` become `LF`) and then compute SHA-256 over UTF-8. No whitespace is trimmed. Split assignment hashes `seed + NUL + group key` into 10,000 buckets, so every member of a group receives the same deterministic split. Counterfactual pairs must have exactly two members, belong to one group, and cannot cross splits.

Before a dataset release, parse each file with its strict Zod schema, validate all trace hashes, check input/label coverage and evidence anchors, validate grouping, and run exact plus token-shingle near-duplicate detection. Split selection must happen on groups before annotation or evaluator development. Do not select or move cases based on evaluator errors.

The committed candidate data is reproducible with `node evals/v1/scripts/generate-candidates.mjs`. The readiness artifacts are reproducible with `node_modules/.bin/vite-node evals/v1/scripts/generate-readiness.ts`.

## Metrics and scoring boundary

`metrics.ts` defines an evaluator-independent prediction record plus balanced accuracy, binary macro-F1, AUROC/AUPRC, per-failure precision/recall/F1, evidence-line metrics, style-pair accuracy, label flip rate, score SD, efficiency aggregates, and deterministic group-aware bootstrap intervals. Exact definitions are in `METRICS.md`.

Evaluator code may receive test input records, but it must never import, serialize, log, prompt with, or tune against candidate or locked test labels. A benchmark runner should load accepted labels only inside its scoring boundary after predictions are finalized. Access control for the eventual private label store remains an operational requirement.
