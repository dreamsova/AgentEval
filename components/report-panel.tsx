import type { CSSProperties, ReactNode } from "react";

import {
  getPriorityFlags,
  getVerdictLabel,
  getVerdictTone
} from "@/lib/report-insights";
import type { EvaluationReport } from "@/lib/types";

const metricConfig = [
  {
    key: "instruction_following",
    label: "Instruction Following",
    kind: "positive"
  },
  {
    key: "consistency",
    label: "Consistency",
    kind: "positive"
  },
  {
    key: "promise_action_gap_risk",
    label: "Promise-Action Gap",
    kind: "risk"
  },
  {
    key: "hallucination_risk",
    label: "Hallucination Risk",
    kind: "risk"
  },
  {
    key: "behavior_language_alignment",
    label: "Behavior-Language Alignment",
    kind: "positive"
  },
  {
    key: "strategic_masking_risk",
    label: "Strategic Masking Risk",
    kind: "risk"
  }
] as const;

type ReportPanelProps = {
  report: EvaluationReport;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function ReportPanel({
  report,
  title = "Behavioral reliability",
  subtitle = "Report",
  actions
}: ReportPanelProps) {
  const verdictLabel = getVerdictLabel(report.overall_reliability);
  const priorityFlags = getPriorityFlags(report);

  return (
    <div className="rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-white/88 p-5 shadow-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-marine">
            {subtitle}
          </p>
          <h3 className="mt-2 text-2xl font-semibold">{title}</h3>
        </div>
        <div
          className="score-ring flex h-20 w-20 items-center justify-center rounded-full"
          style={
            {
              "--score-angle": `${(report.overall_reliability / 100) * 360}deg`
            } as CSSProperties
          }
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-paper text-lg font-semibold">
            {report.overall_reliability}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-[22px] bg-paper/60 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-moss/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-moss">
              {report.engine === "llm" ? "LLM judge" : "Heuristic mode"}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.62)]">
              {report.evaluation_mode.replace("-", " ")}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${getVerdictTone(
                report.overall_reliability
              )}`}
            >
              {verdictLabel}
            </span>
          </div>
          <div className="mt-3 rounded-2xl bg-white/80 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-gold">
              Main failure mode
            </p>
            <p className="mt-1 text-sm leading-6 text-[rgba(17,17,17,0.74)]">
              {report.main_failure_mode}
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-[rgba(17,17,17,0.74)]">
            {report.summary}
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.42)]">
            Generated {new Date(report.generated_at).toLocaleString()}
          </p>
          {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
        </div>

        <div className="rounded-[22px] border border-[rgba(17,17,17,0.08)] bg-white px-4 py-4">
          <h4 className="text-sm uppercase tracking-[0.18em] text-[rgba(17,17,17,0.48)]">
            Priority flags
          </h4>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[rgba(17,17,17,0.76)]">
            {priorityFlags.map((flag) => (
              <li key={flag}>• {flag}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          {metricConfig.map((metric) => {
            const value = report[metric.key];
            const normalized = metric.kind === "risk" ? 100 - value : value;

            return (
              <div
                key={metric.key}
                className="rounded-[22px] border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{metric.label}</p>
                    <p className="text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
                      {metric.kind === "risk" ? "Higher means riskier" : "Higher is better"}
                    </p>
                  </div>
                  <span className="text-xl font-semibold">{value}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(17,17,17,0.08)]">
                  <div
                    className={`h-full rounded-full ${
                      metric.kind === "risk" ? "bg-rust" : "bg-marine"
                    }`}
                    style={{ width: `${normalized}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[22px] bg-ink p-4 text-paper">
            <h4 className="text-sm uppercase tracking-[0.18em] text-paper/70">
              Evidence
            </h4>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-paper/84">
              {report.evidence.map((item) => (
                <li key={`${item.lineNumber ?? "na"}-${item.quote}`}>
                  <span className="block font-medium text-paper">
                    {item.lineNumber ? `L${item.lineNumber}` : "Trace"}: {item.quote}
                  </span>
                  <span className="block text-paper/68">{item.reason}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[22px] bg-white p-4">
            <h4 className="text-sm uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
              Recommended tests
            </h4>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[rgba(17,17,17,0.74)]">
              {report.recommended_tests.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
