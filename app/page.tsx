import { EvaluationWorkbench } from "@/components/evaluation-workbench";
import { sampleTraces } from "@/lib/sample-traces";

const productPrinciples = [
  {
    title: "Behavior over polish",
    body: "The app judges whether the trace supports what the agent claims, not whether the writing sounds confident."
  },
  {
    title: "Evidence-linked scoring",
    body: "Every report points back to concrete evidence lines so the judgment is inspectable."
  },
  {
    title: "Strategic masking aware",
    body: "The rubric explicitly checks for agents that sound normal or cooperative while quietly failing to execute."
  }
];

const scoringDimensions = [
  "Instruction following",
  "Consistency",
  "Promise-action gap",
  "Hallucination / factuality risk",
  "Behavior-language alignment",
  "Strategic masking risk",
  "Overall reliability"
];

export default function Home() {
  return (
    <main className="grain min-h-screen px-5 pb-16 pt-6 text-ink sm:px-8 lg:px-10">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="rounded-[32px] bg-[rgba(255,255,255,0.72)] p-6 shadow-panel backdrop-blur sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.35fr_0.95fr]">
            <div className="space-y-6">
              <span className="inline-flex rounded-full border border-[rgba(17,17,17,0.08)] bg-white/75 px-3 py-1 text-xs uppercase tracking-[0.2em] text-marine">
                AgentEval MVP
              </span>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-5xl font-semibold leading-[0.95] sm:text-6xl">
                  Evaluate AI agents by behavior, not just words.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-[rgba(17,17,17,0.74)]">
                  AgentEval analyzes an agent trace for promise-action gaps,
                  behavioral inconsistency, hallucination risk, and strategic
                  masking. It turns your PGG research insight into a demo that
                  feels understandable in under 30 seconds.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-rust/10 px-4 py-2 text-rust">
                  Research-backed
                </span>
                <span className="rounded-full bg-marine/10 px-4 py-2 text-marine">
                  Startup demo friendly
                </span>
                <span className="rounded-full bg-moss/10 px-4 py-2 text-moss">
                  No login, no database
                </span>
              </div>
            </div>
            <aside className="rounded-[28px] bg-ink p-6 text-paper shadow-panel sm:p-7">
              <div className="space-y-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-paper/60">
                    Research signal
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold">
                    From PGG to product
                  </h2>
                </div>
                <p className="leading-7 text-paper/82">
                  Your repeated public goods experiment showed a clean failure
                  mode: agents can sound fluent, cooperative, and normal while
                  behaving unreliably. This app operationalizes that finding as
                  a behavioral reliability report.
                </p>
                <div className="grid gap-3 rounded-[22px] bg-white/8 p-4">
                  <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
                    <span className="text-sm text-paper/70">
                      Background experiment
                    </span>
                    <span className="text-lg font-medium">1,350 obs</span>
                  </div>
                  <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
                    <span className="text-sm text-paper/70">
                      Monitoring mechanisms
                    </span>
                    <span className="text-lg font-medium">11</span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-paper/70">
                      Core takeaway
                    </span>
                    <span className="text-lg font-medium">Style != Substance</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] bg-white/76 p-6 shadow-panel backdrop-blur sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-rust">
                  Demo flow
                </p>
                <h2 className="mt-2 text-3xl font-semibold">
                  Paste a trace, inspect the gap
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-[rgba(17,17,17,0.62)]">
                Start with one of the sample traces or paste your own. The app
                will score behavior-language alignment and highlight the most
                important evidence.
              </p>
            </div>
            <div className="mt-6">
              <EvaluationWorkbench sampleTraces={sampleTraces} />
            </div>
          </div>

          <div className="space-y-5">
            <section className="rounded-[28px] bg-white/72 p-6 shadow-panel backdrop-blur sm:p-7">
              <p className="text-xs uppercase tracking-[0.24em] text-gold">
                Scoring rubric
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                What the report measures
              </h2>
              <ul className="mt-5 space-y-3">
                {scoringDimensions.map((dimension) => (
                  <li
                    key={dimension}
                    className="rounded-2xl border border-[rgba(17,17,17,0.08)] bg-paper/65 px-4 py-3 text-sm leading-6"
                  >
                    {dimension}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[28px] bg-marine p-6 text-paper shadow-panel sm:p-7">
              <p className="text-xs uppercase tracking-[0.24em] text-paper/70">
                Product principles
              </p>
              <div className="mt-4 space-y-4">
                {productPrinciples.map((principle) => (
                  <div
                    key={principle.title}
                    className="rounded-2xl border border-white/12 bg-white/8 p-4"
                  >
                    <h3 className="text-lg font-medium">{principle.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-paper/78">
                      {principle.body}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
