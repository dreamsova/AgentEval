"use client";

import { useState, useTransition } from "react";

import {
  getPriorityFlags,
  getTraceStats,
  getVerdictLabel,
  getVerdictTone
} from "@/lib/report-insights";
import type { EvaluationReport, SampleTrace } from "@/lib/types";

type EvaluationWorkbenchProps = {
  sampleTraces: SampleTrace[];
};

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

export function EvaluationWorkbench({
  sampleTraces
}: EvaluationWorkbenchProps) {
  const [trace, setTrace] = useState(sampleTraces[0]?.content ?? "");
  const [selectedId, setSelectedId] = useState(sampleTraces[0]?.id ?? "");
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activeSample =
    sampleTraces.find((sample) => sample.id === selectedId) ?? null;
  const traceStats = getTraceStats(trace);
  const verdictLabel = report ? getVerdictLabel(report.overall_reliability) : null;
  const priorityFlags = report ? getPriorityFlags(report) : [];

  async function copyReportJson() {
    if (!report) {
      return;
    }

    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function evaluateTrace() {
    setError(null);

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ trace })
      });

      const payload = (await response.json()) as
        | EvaluationReport
        | { error?: string };

      if (!response.ok || ("error" in payload && payload.error)) {
        setReport(null);
        setError(
          ("error" in payload ? payload.error : undefined) ??
            "Something went wrong while evaluating."
        );
        return;
      }

      setReport(payload as EvaluationReport);
      setCopied(false);
    } catch {
      setReport(null);
      setError("Unable to reach the evaluation route right now.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {sampleTraces.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => {
              setTrace(sample.content);
              setSelectedId(sample.id);
              setError(null);
            }}
            className={`rounded-full border px-4 py-2 text-sm transition ${
              selectedId === sample.id
                ? "border-marine bg-marine text-paper"
                : "border-[rgba(17,17,17,0.08)] bg-white text-ink hover:border-marine/45"
            }`}
          >
            {sample.label}
          </button>
        ))}
      </div>

      {activeSample ? (
        <div className="rounded-[24px] border border-[rgba(17,17,17,0.08)] bg-white/72 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl">
              <p className="text-xs uppercase tracking-[0.18em] text-marine">
                Sample context
              </p>
              <h3 className="mt-2 text-lg font-semibold">{activeSample.label}</h3>
              <p className="mt-2 text-sm leading-6 text-[rgba(17,17,17,0.7)]">
                {activeSample.summary}
              </p>
            </div>
            <div className="rounded-2xl bg-paper/70 px-4 py-3 text-sm text-[rgba(17,17,17,0.72)]">
              <span className="block text-xs uppercase tracking-[0.18em] text-gold">
                Expected signal
              </span>
              <span className="mt-1 block">{activeSample.expectedOutcome}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {activeSample.focus.map((item) => (
              <span
                key={item}
                className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-3 py-1 text-xs uppercase tracking-[0.16em] text-[rgba(17,17,17,0.62)]"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-[rgba(255,255,255,0.88)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label htmlFor="trace" className="text-sm font-medium">
                  Agent trace or workflow log
                </label>
                <p className="mt-1 text-sm leading-6 text-[rgba(17,17,17,0.6)]">
                  Paste a multi-turn trace, tool transcript, or conversation.
                  The best results come from traces that include both claims and
                  concrete actions.
                </p>
              </div>
              <span className="rounded-full bg-rust/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-rust">
                30-sec demo
              </span>
            </div>
            <textarea
              id="trace"
              value={trace}
              onChange={(event) => {
                setTrace(event.target.value);
                setSelectedId("");
              }}
              placeholder="Paste an agent trace here..."
              className="mt-4 min-h-[360px] w-full resize-y rounded-[22px] border border-[rgba(17,17,17,0.08)] bg-paper/60 p-4 text-sm leading-6 outline-none transition focus:border-marine focus:ring-2 focus:ring-marine/15"
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2 text-xs leading-5 text-[rgba(17,17,17,0.55)]">
                <span className="rounded-full bg-white px-3 py-1">
                  {traceStats.turns} turns
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  {traceStats.lines} non-empty lines
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  {traceStats.words} words
                </span>
                <span className="rounded-full bg-white px-3 py-1">
                  Fallback works without `OPENAI_API_KEY`
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  startTransition(() => {
                    void evaluateTrace();
                  });
                }}
                disabled={!trace.trim() || isPending}
                className="inline-flex min-w-[170px] items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-marine disabled:cursor-not-allowed disabled:bg-ink/45"
              >
                {isPending ? "Evaluating..." : "Evaluate Agent"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-[24px] border border-rust/25 bg-rust/10 px-4 py-3 text-sm text-rust">
              {error}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-white/88 p-5 shadow-panel">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-marine">
                  Report
                </p>
                <h3 className="mt-2 text-2xl font-semibold">
                  Behavioral reliability
                </h3>
              </div>
              <div
                className="score-ring flex h-20 w-20 items-center justify-center rounded-full"
                style={
                  {
                    "--score-angle": `${((report?.overall_reliability ?? 0) / 100) * 360}deg`
                  } as React.CSSProperties
                }
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-paper text-lg font-semibold">
                  {report?.overall_reliability ?? "--"}
                </div>
              </div>
            </div>

            {report ? (
              <div className="mt-4 space-y-4">
              <div className="rounded-[22px] bg-paper/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-moss/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-moss">
                      {report.mode === "llm" ? "LLM judge" : "Heuristic mode"}
                    </span>
                    {verdictLabel ? (
                      <span
                        className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${getVerdictTone(
                          report.overall_reliability
                        )}`}
                      >
                        {verdictLabel}
                      </span>
                    ) : null}
                    <span className="rounded-full bg-gold/12 px-3 py-1 text-xs uppercase tracking-[0.18em] text-gold">
                      {report.main_failure_mode}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[rgba(17,17,17,0.74)]">
                    {report.summary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void copyReportJson();
                      }}
                      className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-2 text-xs uppercase tracking-[0.18em] text-ink transition hover:border-marine/40"
                    >
                      {copied ? "Copied JSON" : "Copy report JSON"}
                    </button>
                  </div>
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
                    const normalized =
                      metric.kind === "risk" ? 100 - value : value;

                    return (
                      <div
                        key={metric.key}
                        className="rounded-[22px] border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{metric.label}</p>
                            <p className="text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
                              {metric.kind === "risk"
                                ? "Higher means riskier"
                                : "Higher is better"}
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
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-paper/84">
                      {report.evidence.map((item) => (
                        <li key={item}>• {item}</li>
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
            ) : (
              <div className="mt-5 rounded-[22px] border border-dashed border-[rgba(17,17,17,0.12)] bg-paper/45 p-5 text-sm leading-6 text-[rgba(17,17,17,0.58)]">
                Run an evaluation to see a structured reliability report,
                supporting evidence, and next-step testing suggestions.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
