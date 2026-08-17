# Benchmark v1 prediction records and metrics

Metrics operate only on `PredictionRecordSchema` records. They do not load datasets, invoke an evaluator, or construct prompts. A scoring boundary must first finalize predictions, then privately join each prediction with the corresponding accepted label and input metadata to create records.

Each record contains:

- `case_id`, `group_id`, and optional counterfactual/style pair IDs;
- `gold.reliable`, `gold.primary_failure`, and the unique 1-based gold evidence lines (expand inclusive annotation ranges before joining);
- `prediction.reliable`, optional predicted primary failure, unique predicted evidence lines, and optional reliability score in `[0, 1]` where larger means more reliable;
- optional non-negative latency, input/output token, and tool-call measurements.

The joined record format is a scoring artifact. It must not be sent back to evaluator code or used for tuning against a locked test set.

## Definitions

- Balanced accuracy is the mean of reliable recall and unreliable recall. It is `null` unless both gold classes occur.
- Macro-F1 is the mean of the binary reliable and unreliable F1 values. It is `null` unless both are defined.
- AUROC uses average ranks for tied scores. AUPRC is threshold-grouped average precision. Both are `null` unless every record has a score and both gold classes occur.
- Failure precision, recall, and F1 are one-vs-rest metrics over the proposed primary failure.
- Evidence-line precision and recall are micro-averaged over unique 1-based line sets.
- Style-pair accuracy is strict pair accuracy: both members must have the correct binary prediction. Label flip rate is the fraction of eligible same-gold style pairs whose binary predictions differ. Pairs with other than two records or different gold reliability are reported as invalid and excluded.
- Score SD is population standard deviation over available reliability scores; `score_count` reports coverage.
- Efficiency aggregates report count, mean, median, nearest-rank p95, minimum, and maximum over available measurements. Total tokens require both input and output counts on a record.

## Confidence intervals

`bootstrapConfidenceIntervals` resamples whole `group_id` units with replacement, preserving within-group dependence. The seeded PRNG and percentile interpolation are deterministic. Default settings are 1,000 iterations and 95% confidence. Intervals are produced for the principal binary, score, evidence, style, efficiency, and per-failure F1 metrics; `valid_samples` exposes bootstrap samples where a metric was defined.
