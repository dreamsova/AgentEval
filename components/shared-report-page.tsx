"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ReportPanel } from "@/components/report-panel";
import { decodeSharePayload } from "@/lib/share-report";

export function SharedReportPage() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("data");

  if (!raw) {
    return (
      <main className="grain min-h-screen px-5 pb-16 pt-6 text-ink sm:px-8 lg:px-10">
        <section className="mx-auto max-w-4xl rounded-[28px] bg-white/78 p-8 shadow-panel">
          <p className="text-xs uppercase tracking-[0.24em] text-rust">
            Shared report
          </p>
          <h1 className="mt-3 text-4xl font-semibold">No report payload found</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[rgba(17,17,17,0.68)]">
            This page expects a `data` query parameter generated from AgentEval.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper"
          >
            Back to AgentEval
          </Link>
        </section>
      </main>
    );
  }

  try {
    const payload = decodeSharePayload(raw);

    return (
      <main className="grain min-h-screen px-5 pb-16 pt-6 text-ink sm:px-8 lg:px-10">
        <section className="mx-auto flex max-w-6xl flex-col gap-6">
          <div className="rounded-[28px] bg-white/78 p-8 shadow-panel">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-rust">
                  Shared report
                </p>
                <h1 className="mt-3 text-4xl font-semibold">{payload.title}</h1>
              </div>
              <Link
                href="/"
                className="inline-flex rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-5 py-3 text-sm font-medium text-ink"
              >
                Open AgentEval
              </Link>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-paper/60 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
                  Mode
                </p>
                <p className="mt-2 text-lg font-semibold">
                  {payload.mode.replace("-", " ")}
                </p>
              </div>
              <div className="rounded-2xl bg-paper/60 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
                  Created
                </p>
                <p className="mt-2 text-lg font-semibold">
                  {new Date(payload.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl bg-paper/60 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.45)]">
                  Trace excerpt
                </p>
                <p className="mt-2 text-sm leading-6 text-[rgba(17,17,17,0.72)]">
                  {payload.primaryTraceExcerpt}
                </p>
              </div>
            </div>
          </div>

          <div
            className={`grid gap-5 ${
              payload.comparisonReport ? "xl:grid-cols-2" : "xl:grid-cols-1"
            }`}
          >
            <ReportPanel
              report={payload.primaryReport}
              title={payload.primaryLabel}
              subtitle="Shared"
            />
            {payload.comparisonReport ? (
              <ReportPanel
                report={payload.comparisonReport}
                title={payload.comparisonLabel ?? "Comparison trace"}
                subtitle="Shared compare"
              />
            ) : null}
          </div>
        </section>
      </main>
    );
  } catch {
    return (
      <main className="grain min-h-screen px-5 pb-16 pt-6 text-ink sm:px-8 lg:px-10">
        <section className="mx-auto max-w-4xl rounded-[28px] bg-white/78 p-8 shadow-panel">
          <p className="text-xs uppercase tracking-[0.24em] text-rust">
            Shared report
          </p>
          <h1 className="mt-3 text-4xl font-semibold">Could not decode report data</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[rgba(17,17,17,0.68)]">
            The link may be truncated or malformed. Generate a new share link from
            the main AgentEval app.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper"
          >
            Back to AgentEval
          </Link>
        </section>
      </main>
    );
  }
}
