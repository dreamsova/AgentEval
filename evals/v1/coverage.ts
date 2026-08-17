import {
  DomainSchema,
  FailureLabelSchema,
  StyleTagSchema,
  TaskTypeSchema,
  type BenchmarkInput,
  type BenchmarkInputFile,
  type BenchmarkLabel,
  type BenchmarkLabelFile
} from "./schema";
import {
  computeCanonicalSha256,
  detectCrossSplitLeakage,
  detectDuplicateTraces,
  detectNearDuplicateTraces,
  validateGrouping,
  validateInputLabelCoverage,
  validateTraceHashes,
  type NearDuplicate,
  type ValidationIssue
} from "./validation";

export type DatasetBundle = {
  inputs: BenchmarkInputFile;
  labels: BenchmarkLabelFile;
};

export type CoverageCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export type DatasetCoverage = {
  dataset_id: string;
  split: BenchmarkInput["split"];
  total: number;
  reliable: number;
  unreliable: number;
  groups: number;
  counterfactual_pairs: number;
  style_pairs: number;
  by_primary_failure: Record<string, number>;
  by_domain: Record<string, number>;
  by_task_type: Record<string, number>;
  by_style_tag: Record<string, number>;
  by_review_status: Record<string, number>;
  input_sha256: string;
  label_sha256: string;
};

export type DataReadinessReport = {
  schema_version: "1.0.0";
  report_version: "1.0.0";
  status: {
    scaffold_ready: boolean;
    benchmark_scoring_ready: false;
    statement: string;
  };
  datasets: DatasetCoverage[];
  totals: {
    dev_regression_items: number;
    test_candidate_items: number;
    all_items: number;
  };
  integrity: {
    checks: CoverageCheck[];
    exact_duplicate_issues: ValidationIssue[];
    cross_split_leakage_issues: ValidationIssue[];
    cross_split_near_duplicates: NearDuplicate[];
    near_duplicate_threshold: number;
    corpus_sha256: string;
  };
  human_gate: string[];
};

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  );
}

function countTags(inputs: readonly BenchmarkInput[]): Record<string, number> {
  return countBy(
    inputs.flatMap((input) => input.style_tags),
    (tag) => tag
  );
}

function coverage(bundle: DatasetBundle): DatasetCoverage {
  const labelById = new Map(bundle.labels.labels.map((label) => [label.case_id, label]));
  const labels = bundle.inputs.cases.flatMap((input) => {
    const label = labelById.get(input.case_id);
    return label === undefined ? [] : [label];
  });
  return {
    dataset_id: bundle.inputs.dataset_id,
    split: bundle.inputs.split,
    total: bundle.inputs.cases.length,
    reliable: labels.filter((label) => label.reliable).length,
    unreliable: labels.filter((label) => !label.reliable).length,
    groups: new Set(bundle.inputs.cases.map((input) => input.group_id)).size,
    counterfactual_pairs: new Set(
      bundle.inputs.cases.flatMap((input) =>
        input.counterfactual_pair_id === undefined
          ? []
          : [input.counterfactual_pair_id]
      )
    ).size,
    style_pairs: new Set(
      bundle.inputs.cases.flatMap((input) =>
        input.style_pair_id === undefined ? [] : [input.style_pair_id]
      )
    ).size,
    by_primary_failure: countBy(
      labels.filter(
        (label): label is BenchmarkLabel & { primary_failure: string } =>
          label.primary_failure !== null
      ),
      (label) => label.primary_failure
    ),
    by_domain: countBy(bundle.inputs.cases, (input) => input.domain),
    by_task_type: countBy(bundle.inputs.cases, (input) => input.task_type),
    by_style_tag: countTags(bundle.inputs.cases),
    by_review_status: countBy(labels, (label) => label.review_status),
    input_sha256: computeCanonicalSha256(bundle.inputs),
    label_sha256: computeCanonicalSha256(bundle.labels)
  };
}

function evidenceAnchorErrors(bundle: DatasetBundle): string[] {
  const inputById = new Map(bundle.inputs.cases.map((input) => [input.case_id, input]));
  const errors: string[] = [];
  for (const label of bundle.labels.labels) {
    const input = inputById.get(label.case_id);
    if (input === undefined) continue;
    const lines = input.trace.split("\n");
    for (const evidence of label.gold_evidence) {
      const selected = lines
        .slice(evidence.line_start - 1, evidence.line_end ?? evidence.line_start)
        .join("\n");
      if (!selected.includes(evidence.quote)) {
        errors.push(`${label.case_id}:${evidence.line_start}:${evidence.quote}`);
      }
    }
  }
  return errors;
}

function allEqualCount(
  counts: Readonly<Record<string, number>>,
  names: readonly string[],
  expected: number
): boolean {
  return names.every((name) => counts[name] === expected);
}

export function buildDataReadinessReport(
  bundles: readonly DatasetBundle[],
  nearDuplicateThreshold = 0.82
): DataReadinessReport {
  const datasets = bundles.map(coverage);
  const inputs = bundles.flatMap((bundle) => bundle.inputs.cases);
  const labels = bundles.flatMap((bundle) => bundle.labels.labels);
  const devRegression = datasets
    .filter((dataset) => dataset.split !== "test")
    .reduce((sum, dataset) => sum + dataset.total, 0);
  const test = datasets.find((dataset) => dataset.split === "test");
  const exactDuplicates = detectDuplicateTraces(inputs);
  const crossSplitLeakage = detectCrossSplitLeakage(inputs);
  const nearDuplicates = detectNearDuplicateTraces(inputs, {
    threshold: nearDuplicateThreshold,
    shingle_size: 3,
    cross_split_only: true,
    exclude_same_group: true
  });
  const groupingIssues = validateGrouping(inputs);
  const hashIssues = validateTraceHashes(inputs);
  const coverageIssues = bundles.flatMap((bundle) =>
    validateInputLabelCoverage(bundle.inputs, bundle.labels)
  );
  const evidenceIssues = bundles.flatMap(evidenceAnchorErrors);
  const testCases =
    test === undefined
      ? []
      : bundles.find((bundle) => bundle.inputs.dataset_id === test.dataset_id)?.inputs
          .cases ?? [];
  const checks: CoverageCheck[] = [
    {
      id: "dev_regression_count",
      passed: devRegression === 24,
      detail: `Expected 24 dev/regression items; found ${devRegression}.`
    },
    {
      id: "test_candidate_count",
      passed: test?.total === 60,
      detail: `Expected 60 test candidates; found ${test?.total ?? 0}.`
    },
    {
      id: "test_reliability_balance",
      passed: test?.reliable === 24 && test.unreliable === 36,
      detail: `Expected 24 reliable and 36 unreliable test candidates; found ${test?.reliable ?? 0}/${test?.unreliable ?? 0}.`
    },
    {
      id: "test_primary_failure_balance",
      passed:
        test !== undefined &&
        allEqualCount(test.by_primary_failure, FailureLabelSchema.options, 6),
      detail: "Each of the six primary failure classes must have exactly six test candidates."
    },
    {
      id: "test_domain_balance",
      passed:
        test !== undefined && allEqualCount(test.by_domain, DomainSchema.options, 10),
      detail: "Each of the six domains must have exactly ten test candidates."
    },
    {
      id: "test_style_coverage",
      passed:
        test !== undefined &&
        StyleTagSchema.options.every((tag) => (test.by_style_tag[tag] ?? 0) > 0),
      detail: "Every v1 style tag must occur in the test-candidate scaffold."
    },
    {
      id: "combined_task_type_coverage",
      passed: TaskTypeSchema.options.every((task) =>
        inputs.some((input) => input.task_type === task)
      ),
      detail: "Every v1 task type must occur in the complete scaffold."
    },
    {
      id: "test_pair_structure",
      passed: test?.counterfactual_pairs === 30 && test.style_pairs === 6,
      detail: `Expected 30 counterfactual pairs and 6 style pairs; found ${test?.counterfactual_pairs ?? 0}/${test?.style_pairs ?? 0}.`
    },
    {
      id: "candidate_visibility",
      passed: testCases.every(
        (input) =>
          input.source_metadata.development_only && !input.source_metadata.unseen
      ),
      detail: "All repository-visible test candidates must be development-only and not unseen."
    },
    {
      id: "review_status",
      passed: labels.every((label) => label.review_status === "needs_human_review"),
      detail: "Every AI-authored or AI-reviewed proposed label must require human review."
    },
    {
      id: "input_label_coverage",
      passed: coverageIssues.length === 0,
      detail: `Input/label coverage issues: ${coverageIssues.length}.`
    },
    {
      id: "trace_hashes",
      passed: hashIssues.length === 0,
      detail: `Trace hash issues: ${hashIssues.length}.`
    },
    {
      id: "evidence_anchors",
      passed: evidenceIssues.length === 0,
      detail: `Evidence anchor issues: ${evidenceIssues.length}.`
    },
    {
      id: "group_isolation",
      passed: groupingIssues.length === 0,
      detail: `Grouping issues: ${groupingIssues.length}.`
    },
    {
      id: "exact_duplicates",
      passed: exactDuplicates.length === 0,
      detail: `Exact duplicate traces outside intentional pairing: ${exactDuplicates.length}.`
    },
    {
      id: "cross_split_leakage",
      passed: crossSplitLeakage.length === 0,
      detail: `Cross-split leakage issues: ${crossSplitLeakage.length}.`
    },
    {
      id: "cross_split_near_duplicates",
      passed: nearDuplicates.length === 0,
      detail: `Cross-split near duplicates at threshold ${nearDuplicateThreshold}: ${nearDuplicates.length}.`
    }
  ];
  const scaffoldReady = checks.every((check) => check.passed);

  return {
    schema_version: "1.0.0",
    report_version: "1.0.0",
    status: {
      scaffold_ready: scaffoldReady,
      benchmark_scoring_ready: false,
      statement:
        "The deterministic data scaffold is ready for independent human annotation; it is not approved for benchmark scoring or performance claims."
    },
    datasets,
    totals: {
      dev_regression_items: devRegression,
      test_candidate_items: test?.total ?? 0,
      all_items: inputs.length
    },
    integrity: {
      checks,
      exact_duplicate_issues: exactDuplicates,
      cross_split_leakage_issues: crossSplitLeakage,
      cross_split_near_duplicates: nearDuplicates,
      near_duplicate_threshold: nearDuplicateThreshold,
      corpus_sha256: computeCanonicalSha256(
        bundles.map((bundle) => ({
          inputs: bundle.inputs,
          labels: bundle.labels
        }))
      )
    },
    human_gate: [
      "Independently annotate every candidate without access to the AI-proposed label file.",
      "Use a second independent pass and resolve disagreements under a recorded protocol.",
      "Recompute evidence anchors, coverage, leakage, and hashes after any annotation or trace change.",
      "Lock the accepted test inputs and move accepted test labels to evaluator-only access before any benchmark run."
    ]
  };
}

export function renderDataReadinessMarkdown(report: DataReadinessReport): string {
  const checkRows = report.integrity.checks
    .map(
      (check) =>
        `| ${check.id} | ${check.passed ? "PASS" : "FAIL"} | ${check.detail} |`
    )
    .join("\n");
  const datasetRows = report.datasets
    .map(
      (dataset) =>
        `| ${dataset.dataset_id} | ${dataset.split} | ${dataset.total} | ${dataset.reliable} | ${dataset.unreliable} | ${dataset.groups} | ${dataset.counterfactual_pairs} | ${dataset.style_pairs} |`
    )
    .join("\n");
  const gate = report.human_gate.map((item) => `- ${item}`).join("\n");
  return `# AgentEval Benchmark v1 data-readiness report

Generated deterministically from the committed v1 input and candidate-label files. No evaluator was run.

## Status

- Scaffold ready: **${report.status.scaffold_ready ? "YES" : "NO"}**
- Benchmark scoring ready: **NO**
- ${report.status.statement}
- Corpus SHA-256: \`${report.integrity.corpus_sha256}\`

## Counts

| Dataset | Split | Items | Reliable proposals | Unreliable proposals | Groups | Counterfactual pairs | Style pairs |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
${datasetRows}

The dev/regression scaffold contains ${report.totals.dev_regression_items} items. The test-candidate scaffold contains ${report.totals.test_candidate_items} items. All proposed labels have review status \`needs_human_review\`.

## Deterministic checks

| Check | Result | Detail |
| --- | --- | --- |
${checkRows}

Near-duplicate detection uses lowercase token 3-gram Jaccard similarity at threshold ${report.integrity.near_duplicate_threshold}, excludes intentional same-group pairs, and checks across splits.

## Human annotation and conflict-resolution gate

${gate}

The repository-visible test candidates and their AI-proposed candidate labels are development material. They must not be used for evaluator tuning or reported as benchmark performance.
`;
}
