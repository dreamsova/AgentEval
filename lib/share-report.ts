import type {
  EvaluationReport,
  SavedEvaluation,
  ShareableReportPayload
} from "@/lib/types";

function buildTraceExcerpt(trace: string) {
  const compact = trace.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

export function buildSharePayload(
  title: string,
  mode: SavedEvaluation["mode"],
  primaryTrace: string,
  primaryReport: EvaluationReport,
  comparisonTrace?: string,
  comparisonReport?: EvaluationReport | null
): ShareableReportPayload {
  return {
    title,
    createdAt: new Date().toISOString(),
    mode,
    primaryLabel: "Primary trace",
    primaryTraceExcerpt: buildTraceExcerpt(primaryTrace),
    primaryReport,
    comparisonLabel: comparisonReport ? "Comparison trace" : undefined,
    comparisonTraceExcerpt:
      comparisonTrace && comparisonReport
        ? buildTraceExcerpt(comparisonTrace)
        : undefined,
    comparisonReport: comparisonReport ?? undefined
  };
}

export function encodeSharePayload(payload: ShareableReportPayload) {
  return encodeURIComponent(JSON.stringify(payload));
}

export function decodeSharePayload(raw: string) {
  try {
    return JSON.parse(raw) as ShareableReportPayload;
  } catch {
    return JSON.parse(decodeURIComponent(raw)) as ShareableReportPayload;
  }
}
