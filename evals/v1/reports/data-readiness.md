# AgentEval Benchmark v1 data-readiness report

Generated deterministically from the committed v1 input and candidate-label files. No evaluator was run.

## Status

- Scaffold ready: **YES**
- Benchmark scoring ready: **NO**
- The deterministic data scaffold is ready for independent human annotation; it is not approved for benchmark scoring or performance claims.
- Corpus SHA-256: `4e4b2fbcacc632ca622eeab94ca3df18bbd4732d2ea1e2d1fbd5bb2f89a43433`

## Counts

| Dataset | Split | Items | Reliable proposals | Unreliable proposals | Groups | Counterfactual pairs | Style pairs |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| agenteval-v1-dev | dev | 16 | 8 | 8 | 12 | 4 | 0 |
| agenteval-v1-regression | regression | 8 | 2 | 6 | 6 | 2 | 0 |
| agenteval-v1-test-candidates | test | 60 | 24 | 36 | 30 | 30 | 6 |

The dev/regression scaffold contains 24 items. The test-candidate scaffold contains 60 items. All proposed labels have review status `needs_human_review`.

## Deterministic checks

| Check | Result | Detail |
| --- | --- | --- |
| dev_regression_count | PASS | Expected 24 dev/regression items; found 24. |
| test_candidate_count | PASS | Expected 60 test candidates; found 60. |
| test_reliability_balance | PASS | Expected 24 reliable and 36 unreliable test candidates; found 24/36. |
| test_primary_failure_balance | PASS | Each of the six primary failure classes must have exactly six test candidates. |
| test_domain_balance | PASS | Each of the six domains must have exactly ten test candidates. |
| test_style_coverage | PASS | Every v1 style tag must occur in the test-candidate scaffold. |
| combined_task_type_coverage | PASS | Every v1 task type must occur in the complete scaffold. |
| test_pair_structure | PASS | Expected 30 counterfactual pairs and 6 style pairs; found 30/6. |
| candidate_visibility | PASS | All repository-visible test candidates must be development-only and not unseen. |
| review_status | PASS | Every AI-authored or AI-reviewed proposed label must require human review. |
| input_label_coverage | PASS | Input/label coverage issues: 0. |
| trace_hashes | PASS | Trace hash issues: 0. |
| evidence_anchors | PASS | Evidence anchor issues: 0. |
| group_isolation | PASS | Grouping issues: 0. |
| exact_duplicates | PASS | Exact duplicate traces outside intentional pairing: 0. |
| cross_split_leakage | PASS | Cross-split leakage issues: 0. |
| cross_split_near_duplicates | PASS | Cross-split near duplicates at threshold 0.82: 0. |

Near-duplicate detection uses lowercase token 3-gram Jaccard similarity at threshold 0.82, excludes intentional same-group pairs, and checks across splits.

## Human annotation and conflict-resolution gate

- Independently annotate every candidate without access to the AI-proposed label file.
- Use a second independent pass and resolve disagreements under a recorded protocol.
- Recompute evidence anchors, coverage, leakage, and hashes after any annotation or trace change.
- Lock the accepted test inputs and move accepted test labels to evaluator-only access before any benchmark run.

The repository-visible test candidates and their AI-proposed candidate labels are development material. They must not be used for evaluator tuning or reported as benchmark performance.
