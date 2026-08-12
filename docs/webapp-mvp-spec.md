# AgentEval Web App MVP Spec

## Product goal

Build the smallest useful web app that evaluates an AI agent trace and returns a reliability report grounded in behavior-language alignment.

Core flow:

`paste agent trace -> evaluation agent chooses tools -> reliability report`

## Target user

A founder, researcher, or engineer building an AI agent who wants a quick answer to:

"Does this agent actually behave as reliably as it sounds?"

## MVP inputs

Support one input mode first:

- pasted trace text

Nice-to-have input modes later:

- uploaded JSON trace
- pasted conversation plus tool log
- imported run from an agent framework

## MVP outputs

Return a report with:

- overall reliability score
- short executive summary
- per-dimension scores
- highlighted evidence snippets
- key failure flags
- recommended next actions

## Recommended scoring dimensions

Use 0 to 5 or 0 to 100, but keep the dimensions stable:

1. Instruction following
2. Commitment-action alignment
3. Cross-step consistency
4. Evidence grounding
5. Escalation and uncertainty handling
6. Behavior-language alignment
7. Strategic masking risk

## Example failure flags

- promised-but-not-done
- claimed-without-evidence
- changed-plan-without-notice
- reassuring-language-with-poor-execution
- failed-to-escalate-uncertainty
- tool-result-mismatch

## MVP evaluation pipeline

1. Inspect the trace structure and establish an evidence baseline.
2. Let the evaluation agent select the diagnostics needed for that trace.
3. Execute read-only claim, action, alignment, masking, or sufficiency tools.
4. Return each observation to the agent so it can continue or stop.
5. Generate dimension scores and evidence, then compute overall reliability deterministically.

## Suggested internal architecture

Keep the first version simple and inspectable.

### Core modules

- `trace parser`
- `agent orchestrator`
- `tool registry`
- `claim extractor`
- `action / outcome extractor`
- `alignment checker`
- `rubric scorer`
- `report generator`

### Suggested storage objects

- `evaluations`
- `trace_messages`
- `trace_actions`
- `claims`
- `scores`
- `flags`

## Example report shape

```json
{
  "overall_reliability": 72,
  "summary": "The agent was helpful and mostly followed instructions, but it overstated completion and masked uncertainty in two places.",
  "scores": {
    "instruction_following": 82,
    "commitment_action_alignment": 61,
    "consistency": 74,
    "evidence_grounding": 69,
    "uncertainty_handling": 58,
    "behavior_language_alignment": 63,
    "strategic_masking_risk": 77
  },
  "flags": [
    "promised-but-not-done",
    "claimed-without-evidence"
  ]
}
```

## MVP UX

Three screens are enough:

### 1. Landing page

Needs:

- one-line thesis
- short explanation of the problem
- one visible example result
- call to action: evaluate a trace

### 2. Evaluation page

Needs:

- large trace input box
- sample trace button
- evaluate button
- optional trace format hints

### 3. Report page

Needs:

- top-level score
- dimension breakdown
- evidence snippets
- failure flags
- short recommendations

## Design principles

- Make the report feel concrete, not mystical
- Show evidence for every important claim
- Separate tone problems from behavior problems
- Optimize for "I can understand this in 30 seconds"

## Non-goals for MVP

- full enterprise observability
- production monitoring integrations
- real-time scoring on every run
- benchmarking across many teams
- polished admin systems

## Data strategy for the first version

You do not need a large labeled dataset to ship the MVP.

Start with:

- hand-selected example traces
- a clear rubric
- a small set of failure patterns inspired by the PGG research
- manual review of early outputs

The product lesson can come before the large-scale eval infrastructure.

## What the first demo should prove

The first public demo only needs to prove three things:

1. This evaluator catches something ordinary demo watching misses.
2. The report is easy to understand.
3. The scoring logic is visibly tied to evidence.

## Build sequence

### Phase 1

- finalize scoring dimensions
- write 5 to 10 sample traces
- define the output schema
- design the landing, input, and report screens

### Phase 2

- build trace input and parser
- build rule-based or rubric-driven scoring
- generate structured reports
- deploy the MVP

### Phase 3

- add saved evaluations
- add side-by-side comparisons
- add framework-specific imports
- refine scoring with real user feedback

## Recommended product sentence

AgentEval helps teams evaluate whether an AI agent's behavior matches its language, instead of trusting polished output at face value.
