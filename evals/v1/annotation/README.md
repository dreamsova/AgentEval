# Benchmark v1 offline annotation protocol

This directory contains an offline, deterministic, file-oriented review flow. It
does not assert that any annotation has occurred. A freeze manifest can only be
created from two supplied response objects and, when needed, a supplied
adjudication response.

## Audit sequence

1. Parse the candidate test input file with `BenchmarkInputFileSchema`.
2. Call `createAnnotationPackets` with two pseudonymous IDs, a codebook version,
   an explicit timestamp, and an explicit shuffle seed. The result contains no
   candidate labels, evaluator output, group/pair fields, source metadata, or
   semantic case IDs. Each annotator receives only their own packet.
3. Collect one strict `AnnotationResponse` per packet. Decisions are `final`,
   `abstain`, or `ambiguous`; non-final decisions cannot smuggle in labels and
   must explain the reason in `notes`.
4. Validate each response against its packet and the exact input file. Validation
   checks pseudonymous identity, hashes, full/unique coverage, evidence bounds,
   and verbatim quotes within declared inclusive line spans.
5. Call `compareAnnotationResponses`. Binary agreement is calculated only over
   records finalized by both annotators. Cohen's kappa is `null` with status
   `no_comparable_items` when none are comparable. It is `null` with status
   `degenerate_no_variance` when expected agreement is one, because kappa's
   denominator is zero. Multilabel agreement reports exact-set agreement and
   mean Jaccard; two empty failure sets score one.
6. Send every queued label, evidence, or required-check disagreement through
   `createAdjudicationPacket`, then validate the third response with
   `validateAdjudicationResponse`.
7. Call `exportFrozenLabels`. Export fails if either original decision is
   non-final or any disagreement lacks a final adjudication. The audit export
   retains both original responses, the optional adjudication response, hashes,
   and record-level provenance.
8. Call `createFreezeManifest` with explicit generation/acceptance timestamps and
   acceptance status. No function reads the clock, filesystem, or network.

Hashes use canonical JSON (recursively sorted object keys, preserved array
order). Dataset hashes cover the complete parsed input file. Packet hashes cover
all packet fields except the packet hash itself. Response and label hashes cover
the complete corresponding parsed objects.
