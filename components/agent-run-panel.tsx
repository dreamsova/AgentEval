import type { AgentRun, AgentStep } from "@/lib/types";

const toolLabels: Record<string, string> = {
  inspect_trace: "Inspect trace",
  extract_commitments: "Extract commitments",
  inspect_execution_evidence: "Inspect execution evidence",
  verify_claim_action_alignment: "Verify claim-action alignment",
  detect_strategic_masking: "Detect strategic masking",
  assess_evidence_sufficiency: "Assess evidence sufficiency"
};

type AgentRunPanelProps = {
  run?: AgentRun;
  liveSteps?: AgentStep[];
  isRunning?: boolean;
  label?: string;
};

export function AgentRunPanel({
  run,
  liveSteps = [],
  isRunning = false,
  label = "Evaluation agent"
}: AgentRunPanelProps) {
  const steps = run?.steps ?? liveSteps;
  const toolsUsed =
    run?.tools_used ?? Array.from(new Set(steps.map((step) => step.tool)));

  return (
    <div className="overflow-hidden rounded-[26px] border border-[rgba(17,17,17,0.08)] bg-ink text-paper shadow-panel">
      <div className="flex flex-col gap-4 border-b border-white/10 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-paper/55">
            Agent run
          </p>
          <h3 className="mt-2 text-2xl font-semibold">{label}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-paper/68">
            {run?.objective ??
              "Inspecting the trace and selecting reliability checks based on the evidence it finds."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em]">
          <span className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-paper/78">
            {run ? `${run.monitoring_tier} monitoring` : "Routing checks"}
          </span>
          <span className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-paper/78">
            {isRunning ? "Running" : run ? "Complete" : "Waiting"}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          {steps.length > 0 ? (
            steps.map((step) => (
              <div
                key={`${step.index}-${step.tool}`}
                className="rounded-[20px] border border-white/10 bg-white/[0.055] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-paper">
                    <span className="mr-2 text-paper/45">
                      {step.index.toString().padStart(2, "0")}
                    </span>
                    {toolLabels[step.tool] ?? step.tool}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${
                      step.status === "completed"
                        ? "bg-moss/20 text-[#cfe1ce]"
                        : "bg-rust/20 text-[#f2c5b8]"
                    }`}
                  >
                    {step.status}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-paper/52">
                  Decision: {step.decision}
                </p>
                <p className="mt-2 text-sm leading-6 text-paper/78">
                  {step.observation}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-[20px] border border-dashed border-white/15 bg-white/[0.035] p-4 text-sm leading-6 text-paper/58">
              {isRunning
                ? "The agent is inspecting the trace before selecting its first diagnostic tool."
                : "Run an evaluation to see the selected tools and their observations."}
            </div>
          )}
        </div>

        <div className="rounded-[20px] border border-white/10 bg-white/[0.045] p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-paper/48">
            Tools used
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {toolsUsed.length > 0 ? (
              toolsUsed.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs text-paper/76"
                >
                  {tool}
                </span>
              ))
            ) : (
              <span className="text-sm text-paper/48">Selecting tools...</span>
            )}
          </div>
          {run ? (
            <div className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-paper/55">
              <p>{run.stop_reason}</p>
              <p className="mt-3">
                {run.steps.length} steps / {(run.duration_ms / 1000).toFixed(1)}s
                {" / "}
                {run.model}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
