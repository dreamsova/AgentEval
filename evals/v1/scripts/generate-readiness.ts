import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import devInputsJson from "../datasets/dev/inputs.json";
import devLabelsJson from "../datasets/dev/labels.json";
import regressionInputsJson from "../datasets/regression/inputs.json";
import regressionLabelsJson from "../datasets/regression/labels.json";
import testLabelsJson from "../datasets/test-labels/candidate-labels.json";
import testInputsJson from "../datasets/test/inputs.json";
import {
  buildDataReadinessReport,
  renderDataReadinessMarkdown
} from "../coverage";
import { BenchmarkInputFileSchema, BenchmarkLabelFileSchema } from "../schema";

const bundles = [
  {
    inputs: BenchmarkInputFileSchema.parse(devInputsJson),
    labels: BenchmarkLabelFileSchema.parse(devLabelsJson)
  },
  {
    inputs: BenchmarkInputFileSchema.parse(regressionInputsJson),
    labels: BenchmarkLabelFileSchema.parse(regressionLabelsJson)
  },
  {
    inputs: BenchmarkInputFileSchema.parse(testInputsJson),
    labels: BenchmarkLabelFileSchema.parse(testLabelsJson)
  }
];
const report = buildDataReadinessReport(bundles);
const reportDirectory = fileURLToPath(new URL("../reports/", import.meta.url));
mkdirSync(reportDirectory, { recursive: true });
writeFileSync(
  new URL("../reports/data-readiness.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
writeFileSync(
  new URL("../reports/data-readiness.md", import.meta.url),
  renderDataReadinessMarkdown(report),
  "utf8"
);

if (!report.status.scaffold_ready) {
  const failures = report.integrity.checks
    .filter((check) => !check.passed)
    .map((check) => check.id)
    .join(", ");
  throw new Error(`Data-readiness checks failed: ${failures}`);
}
