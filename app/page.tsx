import { EvaluationWorkbench } from "@/components/evaluation-workbench";
import { sampleTraces } from "@/lib/sample-traces";

const proofPoints = [
  "1,350 PGG observations",
  "11 monitoring mechanisms",
  "Evidence-linked LLM reports"
];

const whatItFinds = [
  "False completion claims",
  "Unsupported confidence",
  "Strategic masking"
];

export default function Home() {
  return (
    <main className="grain min-h-screen px-5 pb-16 pt-6 text-ink sm:px-8 lg:px-10">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xl font-semibold tracking-[-0.03em]">AgentEval</p>
            <p className="mt-1 text-sm text-[rgba(17,17,17,0.56)]">
              Behavioral reliability for AI agents
            </p>
          </div>
          <span className="hidden rounded-full border border-[rgba(17,17,17,0.08)] bg-white/84 px-4 py-2 text-xs uppercase tracking-[0.2em] text-marine sm:inline-flex">
            Research-backed product demo
          </span>
        </header>

        <section className="rounded-[36px] bg-[rgba(255,255,255,0.84)] p-6 shadow-panel backdrop-blur sm:p-8 lg:p-10">
          <div className="max-w-4xl">
            <p className="text-xs uppercase tracking-[0.24em] text-rust">
              Behavioral Reliability Evaluation
            </p>
            <h1 className="mt-4 max-w-4xl text-5xl font-semibold leading-[0.94] tracking-[-0.05em] sm:text-6xl">
              Catch the gap between what an agent says and what it actually does.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[rgba(17,17,17,0.7)]">
              Paste a trace and get a clean reliability report with evidence,
              failure mode, and follow-up tests. Built from your PGG research on
              monitoring, cooperation, and deception.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 text-sm">
              <a
                href="#workbench"
                className="inline-flex rounded-full bg-ink px-5 py-3 font-medium text-paper transition hover:bg-marine"
              >
                Run the demo
              </a>
              <span className="inline-flex rounded-full border border-[rgba(17,17,17,0.08)] bg-white px-4 py-3 text-[rgba(17,17,17,0.62)]">
                No login. No setup. One trace in, one report out.
              </span>
            </div>
          </div>

          <div className="mt-8 rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-paper/56 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm font-medium text-[rgba(17,17,17,0.76)]">
                Designed to surface behavioral failures that polished demos often hide.
              </p>
              <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.56)]">
                {proofPoints.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-[rgba(17,17,17,0.08)] bg-white/86 px-3 py-2"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          id="workbench"
          className="rounded-[30px] bg-white/82 p-6 shadow-panel backdrop-blur sm:p-8"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-rust">
                Live Demo
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                Evaluate one trace in under a minute
              </h2>
            </div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.18em] text-[rgba(17,17,17,0.56)]">
              {whatItFinds.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[rgba(17,17,17,0.08)] bg-paper/56 px-3 py-2"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-6">
            <EvaluationWorkbench sampleTraces={sampleTraces} compact />
          </div>
        </section>
      </section>
    </main>
  );
}
