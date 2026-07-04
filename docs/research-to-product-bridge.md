# Research-to-Product Bridge

## The bridge in one sentence

The PGG project is not the product. It is the controlled environment that reveals why behavior-language misalignment is a real and important agent failure mode.

## How to describe the research

Use this lighter framing:

- multi-agent LLM cooperation as an algorithmic monitoring problem
- 11 algorithmic monitoring and enforcement mechanisms
- deceptive agents can sound normal while defecting
- language-based monitoring is cheap, but vulnerable to strategic masking

## Core research question

How should we design low-cost monitoring mechanisms that sustain cooperation among LLM agents, especially when agents can strategically manipulate language-based signals?

## Minimal formalization

Each monitoring policy trades off three terms:

- social welfare
- intervention cost
- strategic manipulation risk

Short version:

`maximize cooperation / welfare while minimizing monitoring cost and manipulation risk`

## Why this matters for a web app

The product version of the same problem is:

How do we determine whether an AI agent's behavior actually matches what it says it is doing?

That gives you a natural shift:

- from punishment policies to evaluation policies
- from cooperation rate to behavioral reliability
- from language-only monitoring to multimodal trace analysis

## Mapping research findings to product features

| Research finding | Product implication | MVP feature |
| --- | --- | --- |
| Deceptive agents can sound cooperative while defecting | Language alone is not enough | Behavior-language alignment score |
| Surprisal is informative but noisy | Cheap language signals still matter | Strategic masking risk flag |
| Style confound punishes aggressive cooperators | Tone should not be over-penalized | Separate style and substance in scoring |
| Punishment works when it targets real defectors | Intervention should depend on behavior, not just language | Promise-action gap and execution checks |
| Dual-signal rules outperform naive language-only rules | Evaluation should combine multiple signals | Composite reliability report |

## Product thesis

AgentEval should answer three practical questions:

1. Did the agent do what it said it would do?
2. Did the agent communicate uncertainty and limitations honestly?
3. Is the agent using polished language to hide weak execution?

## What to reuse from the research directly

- the manipulator case as your canonical failure demo
- the style-vs-substance gap as the headline insight
- the low-cost monitoring idea as the product rationale
- the multi-signal logic as the scoring architecture

## What not to drag into the product too early

- equilibrium proofs
- re-derived payoff design
- large-scale literature positioning
- every enforcement condition from the experiment
- fully automated causal inference in the MVP

## Best story to tell

The research discovered the failure mode.
The product makes that failure mode actionable.
