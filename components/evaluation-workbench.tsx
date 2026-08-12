"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";

import { AgentRunPanel } from "@/components/agent-run-panel";
import { ReportPanel } from "@/components/report-panel";
import { evaluationModes, getEvaluationModeCopy } from "@/lib/evaluation-modes";
import {
  getTraceStats,
  getVerdictLabel
} from "@/lib/report-insights";
import {
  buildSharePayload,
  encodeSharePayload
} from "@/lib/share-report";
import type {
  AgentStep,
  EvaluationMode,
  EvaluationReport,
  EvaluationStreamEvent,
  SampleTrace,
  SavedEvaluation
} from "@/lib/types";

type EvaluationWorkbenchProps = {
  sampleTraces: SampleTrace[];
  compact?: boolean;
};

const STORAGE_KEY = "agenteval.saved-evaluations";

type TraceTarget = "primary" | "comparison";

async function requestEvaluation(
  trace: string,
  mode: EvaluationMode,
  onEvent?: (event: EvaluationStreamEvent) => void
) {
  const response = await fetch("/api/evaluate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ trace, mode })
  });

  if (!response.ok) {
    const payload = (await response.json()) as { error?: string };
    throw new Error(payload.error ?? "Something went wrong while evaluating.");
  }

  if (!response.body) {
    throw new Error("The evaluation stream did not start.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: EvaluationStreamEvent[] = [];

  function consumeLine(line: string) {
    if (!line.trim()) {
      return;
    }

    const event = JSON.parse(line) as EvaluationStreamEvent;
    events.push(event);
    onEvent?.(event);

    if (event.type === "error") {
      throw new Error(event.error);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      consumeLine(line);
    }

    if (done) {
      break;
    }
  }

  consumeLine(buffer);

  const completed = events.find(
    (event): event is Extract<EvaluationStreamEvent, { type: "complete" }> =>
      event.type === "complete"
  );

  if (!completed) {
    throw new Error("The evaluation agent finished without a report.");
  }

  return completed.report;
}

function deriveTraceFromJson(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    return input
      .map((item) =>
        typeof item === "string" ? item : JSON.stringify(item, null, 2)
      )
      .join("\n");
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;

    if (typeof record.trace === "string") {
      return record.trace;
    }

    if (Array.isArray(record.messages)) {
      return record.messages
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item && typeof item === "object") {
            const message = item as Record<string, unknown>;
            const role = typeof message.role === "string" ? message.role : "Message";
            const content =
              typeof message.content === "string"
                ? message.content
                : JSON.stringify(message, null, 2);

            return `${role}: ${content}`;
          }

          return JSON.stringify(item, null, 2);
        })
        .join("\n\n");
    }
  }

  return JSON.stringify(input, null, 2);
}

async function readTraceFile(file: File) {
  const raw = await file.text();

  if (file.name.endsWith(".json")) {
    try {
      return deriveTraceFromJson(JSON.parse(raw));
    } catch {
      return raw;
    }
  }

  return raw;
}

function buildEvaluationTitle(
  mode: EvaluationMode,
  primarySample?: SampleTrace | null,
  comparisonSample?: SampleTrace | null
) {
  const modeLabel = getEvaluationModeCopy(mode).label;

  if (comparisonSample) {
    return `${modeLabel}: ${primarySample?.label ?? "Primary trace"} vs ${comparisonSample.label}`;
  }

  return `${modeLabel}: ${primarySample?.label ?? "Custom trace"}`;
}

function persistSavedEvaluations(items: SavedEvaluation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function EvaluationWorkbench({
  sampleTraces,
  compact = false
}: EvaluationWorkbenchProps) {
  const defaultPrimarySample =
    sampleTraces.find((sample) => sample.id === "strategic-masker") ??
    sampleTraces[0] ??
    null;
  const defaultComparisonSample =
    sampleTraces.find((sample) => sample.id === "reliable-ops") ??
    sampleTraces[1] ??
    sampleTraces[0] ??
    null;

  const [primaryTrace, setPrimaryTrace] = useState(defaultPrimarySample?.content ?? "");
  const [primarySelectedId, setPrimarySelectedId] = useState(
    defaultPrimarySample?.id ?? ""
  );
  const [comparisonTrace, setComparisonTrace] = useState(
    defaultComparisonSample?.content ?? ""
  );
  const [comparisonSelectedId, setComparisonSelectedId] = useState(
    defaultComparisonSample?.id ?? ""
  );
  const [compareMode, setCompareMode] = useState(false);
  const [evaluationMode, setEvaluationMode] =
    useState<EvaluationMode>("founder-demo");
  const [primaryReport, setPrimaryReport] = useState<EvaluationReport | null>(null);
  const [comparisonReport, setComparisonReport] =
    useState<EvaluationReport | null>(null);
  const [savedEvaluations, setSavedEvaluations] = useState<SavedEvaluation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [activeEvaluationTarget, setActiveEvaluationTarget] =
    useState<TraceTarget | null>(null);
  const [primaryAgentSteps, setPrimaryAgentSteps] = useState<AgentStep[]>([]);
  const [comparisonAgentSteps, setComparisonAgentSteps] = useState<AgentStep[]>([]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return;
    }

    try {
      setSavedEvaluations(JSON.parse(raw) as SavedEvaluation[]);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const activePrimarySample =
    sampleTraces.find((sample) => sample.id === primarySelectedId) ?? null;
  const activeComparisonSample =
    sampleTraces.find((sample) => sample.id === comparisonSelectedId) ?? null;

  const primaryTraceStats = getTraceStats(primaryTrace);
  const comparisonTraceStats = getTraceStats(comparisonTrace);
  const modeCopy = getEvaluationModeCopy(evaluationMode);

  const comparisonSummary = useMemo(() => {
    if (!primaryReport || !comparisonReport) {
      return null;
    }

    const delta =
      primaryReport.overall_reliability - comparisonReport.overall_reliability;
    const better = delta >= 0 ? "Primary trace" : "Comparison trace";

    return {
      delta: Math.abs(delta),
      better,
      primaryVerdict: getVerdictLabel(primaryReport.overall_reliability),
      comparisonVerdict: getVerdictLabel(comparisonReport.overall_reliability)
    };
  }, [primaryReport, comparisonReport]);

  async function handleFileImport(
    event: ChangeEvent<HTMLInputElement>,
    target: TraceTarget
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const importedTrace = await readTraceFile(file);

    if (target === "primary") {
      setPrimaryTrace(importedTrace);
      setPrimarySelectedId("");
    } else {
      setComparisonTrace(importedTrace);
      setComparisonSelectedId("");
    }

    event.target.value = "";
  }

  async function copyCurrentReportJson() {
    if (!primaryReport) {
      return;
    }

    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          primaryReport,
          comparisonReport
        },
        null,
        2
      )
    );
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1500);
  }

  async function copyShareLink(snapshot?: SavedEvaluation) {
    const payload = snapshot
      ? buildSharePayload(
          snapshot.title,
          snapshot.mode,
          snapshot.primaryTrace,
          snapshot.primaryReport,
          snapshot.comparisonTrace,
          snapshot.comparisonReport
        )
      : primaryReport
        ? buildSharePayload(
            buildEvaluationTitle(
              evaluationMode,
              activePrimarySample,
              compareMode ? activeComparisonSample : null
            ),
            evaluationMode,
            primaryTrace,
            primaryReport,
            compareMode ? comparisonTrace : undefined,
            compareMode ? comparisonReport : undefined
          )
        : null;

    if (!payload) {
      return;
    }

    const url = `${window.location.origin}/report?data=${encodeSharePayload(
      payload
    )}`;

    await navigator.clipboard.writeText(url);
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 1500);
  }

  function saveCurrentEvaluation() {
    if (!primaryReport) {
      return;
    }

    const snapshot: SavedEvaluation = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}`,
      title: buildEvaluationTitle(
        evaluationMode,
        activePrimarySample,
        compareMode ? activeComparisonSample : null
      ),
      createdAt: new Date().toISOString(),
      mode: evaluationMode,
      primaryTrace,
      comparisonTrace: compareMode ? comparisonTrace : undefined,
      primaryReport,
      comparisonReport: compareMode ? comparisonReport : undefined
    };

    const next = [snapshot, ...savedEvaluations].slice(0, 8);
    setSavedEvaluations(next);
    persistSavedEvaluations(next);
  }

  function loadSavedEvaluation(snapshot: SavedEvaluation) {
    setEvaluationMode(snapshot.mode);
    setPrimaryTrace(snapshot.primaryTrace);
    setPrimarySelectedId("");
    setPrimaryReport(snapshot.primaryReport);

    if (snapshot.comparisonTrace && snapshot.comparisonReport) {
      setCompareMode(true);
      setComparisonTrace(snapshot.comparisonTrace);
      setComparisonSelectedId("");
      setComparisonReport(snapshot.comparisonReport);
    } else {
      setCompareMode(false);
      setComparisonReport(null);
    }
  }

  async function evaluateCurrentTraceSet() {
    setError(null);
    setIsEvaluating(true);
    setPrimaryReport(null);
    setComparisonReport(null);
    setPrimaryAgentSteps([]);
    setComparisonAgentSteps([]);

    try {
      setActiveEvaluationTarget("primary");
      const nextPrimary = await requestEvaluation(
        primaryTrace,
        evaluationMode,
        (event) => {
          if (event.type === "agent_step") {
            setPrimaryAgentSteps((current) => [...current, event.step]);
          }
        }
      );
      setPrimaryReport(nextPrimary);

      if (nextPrimary.engine === "heuristic") {
        setPrimaryAgentSteps([]);
      }

      if (compareMode && comparisonTrace.trim()) {
        setActiveEvaluationTarget("comparison");
        const nextComparison = await requestEvaluation(
          comparisonTrace,
          evaluationMode,
          (event) => {
            if (event.type === "agent_step") {
              setComparisonAgentSteps((current) => [...current, event.step]);
            }
          }
        );
        setComparisonReport(nextComparison);

        if (nextComparison.engine === "heuristic") {
          setComparisonAgentSteps([]);
        }
      } else {
        setComparisonReport(null);
      }

      setCopiedJson(false);
      setCopiedShareLink(false);
    } catch (caughtError) {
      setPrimaryReport(null);
      setComparisonReport(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to evaluate the provided trace."
      );
    } finally {
      setActiveEvaluationTarget(null);
      setIsEvaluating(false);
    }
  }

  return (
    <div className="space-y-5">
      {compact ? (
        <div className="rounded-[24px] border border-[rgba(17,17,17,0.08)] bg-white/72 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h3 className="mt-2 text-lg font-semibold">
                Start with a sample trace or paste your own
              </h3>
              <p className="mt-2 text-sm leading-6 text-[rgba(17,17,17,0.68)]">
                The evaluation agent chooses diagnostic tools, links observations
                to evidence, and returns a reliability report.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs leading-5 text-[rgba(17,17,17,0.55)]">
              <span className="rounded-full bg-white px-3 py-1">1. Pick a trace</span>
              <span className="rounded-full bg-white px-3 py-1">2. Agent selects tools</span>
              <span className="rounded-full bg-white px-3 py-1">3. Inspect evidence</span>
            </div>
          </div>
          <details className="mt-4 rounded-[20px] border border-[rgba(17,17,17,0.08)] bg-paper/50 p-4">
            <summary className="cursor-pointer list-none text-sm font-medium">
              Advanced demo controls
            </summary>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={evaluationMode}
                onChange={(event) =>
                  setEvaluationMode(event.target.value as EvaluationMode)
                }
                className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3 text-sm outline-none"
              >
                {evaluationModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-3 rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={compareMode}
                  onChange={(event) => setCompareMode(event.target.checked)}
                />
                Compare two traces
              </label>
            </div>
            <p className="mt-3 text-sm leading-6 text-[rgba(17,17,17,0.62)]">
              {modeCopy.summary}
            </p>
          </details>
        </div>
      ) : (
        <div className="rounded-[24px] border border-[rgba(17,17,17,0.08)] bg-white/72 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.18em] text-marine">
                Evaluation mode
              </p>
              <h3 className="mt-2 text-lg font-semibold">{modeCopy.label}</h3>
              <p className="mt-2 text-sm leading-6 text-[rgba(17,17,17,0.68)]">
                {modeCopy.summary}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={evaluationMode}
                onChange={(event) =>
                  setEvaluationMode(event.target.value as EvaluationMode)
                }
                className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3 text-sm outline-none"
              >
                {evaluationModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-3 rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={compareMode}
                  onChange={(event) => setCompareMode(event.target.checked)}
                />
                Compare two traces
              </label>
            </div>
          </div>
        </div>
      )}

      <div className={`grid gap-5 ${compareMode ? "xl:grid-cols-2" : ""}`}>
        <TraceEditor
          title="Primary trace"
          trace={primaryTrace}
          setTrace={setPrimaryTrace}
          selectedId={primarySelectedId}
          setSelectedId={setPrimarySelectedId}
          sampleTraces={sampleTraces}
          activeSample={activePrimarySample}
          onFileImport={handleFileImport}
          target="primary"
          stats={primaryTraceStats}
          compact={compact}
        />

        {compareMode ? (
          <TraceEditor
            title="Comparison trace"
            trace={comparisonTrace}
            setTrace={setComparisonTrace}
            selectedId={comparisonSelectedId}
            setSelectedId={setComparisonSelectedId}
            sampleTraces={sampleTraces}
            activeSample={activeComparisonSample}
            onFileImport={handleFileImport}
            target="comparison"
            stats={comparisonTraceStats}
            compact={compact}
          />
        ) : !compact ? (
          <div className="rounded-[26px] border border-dashed border-[rgba(17,17,17,0.12)] bg-paper/45 p-5 text-sm leading-6 text-[rgba(17,17,17,0.58)]">
            Turn on compare mode to score two traces side by side. This is
            especially useful for showing the difference between a reliable
            agent and one that sounds polished while quietly failing.
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2 text-xs leading-5 text-[rgba(17,17,17,0.55)]">
          <span className="rounded-full bg-white px-3 py-1">
            Upload `.txt`, `.md`, or `.json`
          </span>
          {compact ? (
            <span className="rounded-full bg-white px-3 py-1">
              Server-side tool loop with shareable output
            </span>
          ) : (
            <>
              <span className="rounded-full bg-white px-3 py-1">
                Save evaluations locally
              </span>
              <span className="rounded-full bg-white px-3 py-1">
                Share report pages without exposing an API key
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void evaluateCurrentTraceSet();
          }}
          disabled={
            !primaryTrace.trim() ||
            (compareMode && !comparisonTrace.trim()) ||
            isEvaluating
          }
          className="inline-flex min-w-[190px] items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-marine disabled:cursor-not-allowed disabled:bg-ink/45"
        >
          {isEvaluating
            ? compareMode
              ? "Comparing..."
              : "Evaluating..."
            : compareMode
              ? "Compare traces"
              : "Run Evaluation Agent"}
        </button>
      </div>

      {error ? (
        <div className="rounded-[24px] border border-rust/25 bg-rust/10 px-4 py-3 text-sm text-rust">
          {error}
        </div>
      ) : null}

      {isEvaluating || primaryReport?.agent_run || primaryAgentSteps.length > 0 ? (
        <div className={`grid gap-5 ${compareMode ? "xl:grid-cols-2" : ""}`}>
          <AgentRunPanel
            run={primaryReport?.agent_run}
            liveSteps={primaryAgentSteps}
            isRunning={activeEvaluationTarget === "primary"}
            label="Primary evaluation agent"
          />
          {compareMode &&
          (activeEvaluationTarget === "comparison" ||
            comparisonReport?.agent_run ||
            comparisonAgentSteps.length > 0) ? (
            <AgentRunPanel
              run={comparisonReport?.agent_run}
              liveSteps={comparisonAgentSteps}
              isRunning={activeEvaluationTarget === "comparison"}
              label="Comparison evaluation agent"
            />
          ) : null}
        </div>
      ) : null}

      {comparisonSummary ? (
        <div className="rounded-[24px] bg-ink p-5 text-paper shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-paper/60">
            Comparison snapshot
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
              <p className="text-sm text-paper/70">Higher overall reliability</p>
              <p className="mt-2 text-xl font-semibold">{comparisonSummary.better}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
              <p className="text-sm text-paper/70">Score delta</p>
              <p className="mt-2 text-xl font-semibold">
                {comparisonSummary.delta} points
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
              <p className="text-sm text-paper/70">Verdicts</p>
              <p className="mt-2 text-sm leading-6 text-paper/86">
                {comparisonSummary.primaryVerdict} vs{" "}
                {comparisonSummary.comparisonVerdict}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {primaryReport ? (
        <div
          className={`grid gap-5 ${
            comparisonReport ? "xl:grid-cols-2" : "xl:grid-cols-1"
          }`}
        >
          <ReportPanel
            report={primaryReport}
            title="Primary trace report"
            subtitle="Report"
            actions={
              <>
                {!compact ? (
                  <button
                    type="button"
                    onClick={() => {
                      void copyCurrentReportJson();
                    }}
                    className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-2 text-xs uppercase tracking-[0.18em] text-ink transition hover:border-marine/40"
                  >
                    {copiedJson ? "Copied JSON" : "Copy report JSON"}
                  </button>
                ) : null}
                {!compact ? (
                  <button
                    type="button"
                    onClick={saveCurrentEvaluation}
                    className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-2 text-xs uppercase tracking-[0.18em] text-ink transition hover:border-marine/40"
                  >
                    Save evaluation
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void copyShareLink();
                  }}
                  className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-2 text-xs uppercase tracking-[0.18em] text-ink transition hover:border-marine/40"
                >
                  {copiedShareLink ? "Copied share link" : "Copy share link"}
                </button>
              </>
            }
          />

          {comparisonReport ? (
            <ReportPanel
              report={comparisonReport}
              title="Comparison trace report"
              subtitle="Compare"
            />
          ) : null}
        </div>
      ) : (
        <div className="rounded-[26px] border border-dashed border-[rgba(17,17,17,0.12)] bg-paper/45 p-5 text-sm leading-6 text-[rgba(17,17,17,0.58)]">
          Use the strategic masker sample above or paste your own trace to see
          where language and behavior diverge.
        </div>
      )}

      <p className="text-xs leading-5 text-[rgba(17,17,17,0.48)]">
        Shared links include report data and a trace excerpt. Do not evaluate or
        share sensitive traces in this public demo.
      </p>

      {compact ? null : (
        <div className="rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-white/82 p-5 shadow-panel">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-rust">
                Saved evaluations
              </p>
              <h3 className="mt-2 text-2xl font-semibold">Local evaluation history</h3>
            </div>
            <p className="max-w-lg text-sm leading-6 text-[rgba(17,17,17,0.62)]">
              These snapshots stay in your browser, so you can compare demos,
              revisit example traces, and generate share links without adding a
              database yet.
            </p>
          </div>

          {savedEvaluations.length > 0 ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {savedEvaluations.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[22px] border border-[rgba(17,17,17,0.08)] bg-paper/55 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                  <h4 className="mt-2 text-lg font-semibold">{item.title}</h4>
                  <p className="mt-2 text-sm leading-6 text-[rgba(17,17,17,0.68)]">
                    {getVerdictLabel(item.primaryReport.overall_reliability)}
                    {item.comparisonReport ? " • includes comparison trace" : ""}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => loadSavedEvaluation(item)}
                      className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-3 py-2 text-xs uppercase tracking-[0.18em]"
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void copyShareLink(item);
                      }}
                      className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-3 py-2 text-xs uppercase tracking-[0.18em]"
                    >
                      Share
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-[22px] border border-dashed border-[rgba(17,17,17,0.12)] bg-paper/45 p-4 text-sm leading-6 text-[rgba(17,17,17,0.56)]">
              No saved evaluations yet. Evaluate a trace and click `Save evaluation`
              to start building a local regression set.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type TraceEditorProps = {
  title: string;
  trace: string;
  setTrace: (value: string) => void;
  selectedId: string;
  setSelectedId: (value: string) => void;
  sampleTraces: SampleTrace[];
  activeSample: SampleTrace | null;
  onFileImport: (
    event: ChangeEvent<HTMLInputElement>,
    target: TraceTarget
  ) => Promise<void>;
  target: TraceTarget;
  stats: ReturnType<typeof getTraceStats>;
  compact: boolean;
};

function TraceEditor({
  title,
  trace,
  setTrace,
  selectedId,
  setSelectedId,
  sampleTraces,
  activeSample,
  onFileImport,
  target,
  stats,
  compact
}: TraceEditorProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-[rgba(255,255,255,0.88)] p-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <label className="text-sm font-medium">{title}</label>
              <p className="mt-1 text-sm leading-6 text-[rgba(17,17,17,0.6)]">
                Paste a multi-turn trace, tool transcript, or conversation. JSON
                message arrays are also supported through import.
              </p>
            </div>
            <label className="rounded-full bg-rust/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-rust">
              <span>Import file</span>
              <input
                type="file"
                accept=".txt,.md,.json"
                onChange={(event) => {
                  void onFileImport(event, target);
                }}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            {sampleTraces.map((sample) => (
              <button
                key={`${target}-${sample.id}`}
                type="button"
                onClick={() => {
                  setTrace(sample.content);
                  setSelectedId(sample.id);
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
              {compact ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-marine">
                      Sample context
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">{activeSample.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-[rgba(17,17,17,0.7)]">
                      {activeSample.summary}
                    </p>
                  </div>
                  <p className="text-sm leading-6 text-[rgba(17,17,17,0.66)]">
                    Expected signal: {activeSample.expectedOutcome}
                  </p>
                </div>
              ) : (
                <>
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
                        key={`${target}-${item}`}
                        className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-3 py-1 text-xs uppercase tracking-[0.16em] text-[rgba(17,17,17,0.62)]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          <textarea
            value={trace}
            onChange={(event) => {
              setTrace(event.target.value);
              setSelectedId("");
            }}
            placeholder="Paste an agent trace here..."
            className={`w-full resize-y rounded-[22px] border border-[rgba(17,17,17,0.08)] bg-paper/60 p-4 text-sm leading-6 outline-none transition focus:border-marine focus:ring-2 focus:ring-marine/15 ${
              compact ? "min-h-[240px]" : "min-h-[300px]"
            }`}
          />

          <div className="flex flex-wrap gap-2 text-xs leading-5 text-[rgba(17,17,17,0.55)]">
            <span className="rounded-full bg-white px-3 py-1">
              {stats.turns} turns
            </span>
            <span className="rounded-full bg-white px-3 py-1">
              {stats.lines} non-empty lines
            </span>
            <span className="rounded-full bg-white px-3 py-1">
              {stats.words} words
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
