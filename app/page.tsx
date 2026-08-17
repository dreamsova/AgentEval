import { EvaluationWorkbench } from "@/components/evaluation-workbench";
import { sampleTraces } from "@/lib/sample-traces";

const proofPoints = [
  "Verifiable reward environment",
  "Adaptive tool routing",
  "Evidence-linked agent reports"
];

const whatItFinds = [
  "False completion claims",
  "Unsupported confidence",
  "Evidence/action mismatch"
];

const underTheHood = [
  {
    title: "Interactive reliability environment",
    body: "Stateful tool actions, revision-aware tests, and deterministic terminal rewards."
  },
  {
    title: "Tool-using evaluation agent",
    body: "Autonomous diagnostic routing across claims, actions, alignment, and masking checks."
  },
  {
    title: "Interactive evaluation product",
    body: "Server-side analysis of arbitrary agent traces with shareable reports."
  }
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
            Evaluation research prototype
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
              Paste a trace. A tool-using evaluation agent selects diagnostic
              checks, inspects execution evidence, and builds a reliability
              report. A deterministic companion environment separately verifies
              artifacts, fresh tests, and structured completion claims.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 text-sm">
              <a
                href="#workbench"
                className="inline-flex rounded-full bg-ink px-5 py-3 font-medium text-paper transition hover:bg-marine"
              >
                Run the demo
              </a>
              <a
                href="https://github.com/dreamsova/AgentEval"
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-full border border-[rgba(17,17,17,0.1)] bg-white px-5 py-3 font-medium text-ink transition hover:border-marine/40 hover:text-marine"
              >
                View GitHub
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
                Watch the evaluation agent inspect a trace
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

        <section className="rounded-[30px] bg-white/72 p-6 shadow-panel backdrop-blur sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-rust">
                Under the hood
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
                What I built
              </h2>
            </div>
            <div className="max-w-lg">
              <p className="text-sm leading-6 text-[rgba(17,17,17,0.62)]">
                The project connects an interactive environment, a verifier,
                an evaluation pipeline, and a user-facing product surface.
              </p>
              <a
                href="https://github.com/dreamsova/AgentEval/tree/main/envs/agent-reliability"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex text-sm font-medium text-marine underline decoration-marine/30 underline-offset-4 transition hover:decoration-marine"
              >
                View the environment implementation
              </a>
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {underTheHood.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-[rgba(17,17,17,0.08)] bg-paper/56 p-4"
              >
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[rgba(17,17,17,0.66)]">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
