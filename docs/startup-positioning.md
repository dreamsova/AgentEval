# AgentEval Startup Positioning

## One-line pitch

AgentEval is a behavioral reliability layer for AI agents that checks whether an agent's actions match its language.

## What problem we are solving

As agent products become more autonomous, teams need more than benchmark scores or polished demos. They need to know whether an agent:

- says it completed something that it did not complete
- sounds confident when it should escalate uncertainty
- makes promises early in a run and quietly violates them later
- uses cooperative or reassuring language to mask unreliable behavior

AgentEval turns these failure modes into an inspectable report.

## Why this is a startup story, not just a research story

The strongest version of the project is not "I ran a sophisticated game-theory experiment."

It is:

"I built a controlled environment that exposes a real agent failure mode, then turned that insight into a product for evaluating agent reliability."

That framing matters because founder house and AI startup audiences usually care most about:

- whether you can identify an important product problem
- whether you can turn research into a usable tool
- whether you can ship a concrete demo quickly

## Recommended project story

Use this narrative:

1. I studied multi-agent LLM cooperation as an algorithmic monitoring problem.
2. I found that language-based supervision is cheap and useful, but vulnerable to strategic masking.
3. In the data, deceptive agents often sounded normal while defecting.
4. That suggests a product need: evaluate behavior-language alignment, not just output quality.
5. AgentEval is the product wedge that operationalizes that insight.

## What to emphasize

- Controlled evidence of a real failure mode
- A concrete evaluator that can be used on traces today
- A practical reliability report, not just a paper
- A path from offline analysis to online monitoring
- Low-cost oversight and targeted intervention

## What to de-emphasize

- Full equilibrium analysis
- Heavy mechanism-design formalism
- Large literature-review framing
- Claims that this is already a complete platform
- Broad "AI safety for everything" positioning

## Light game theory framing to keep

You do not need a full theory paper, but you should keep a small amount of framing because it upgrades the intellectual clarity of the project.

Recommended language:

- "11 algorithmic monitoring and enforcement mechanisms"
- "multi-agent LLM cooperation as an algorithmic monitoring problem"
- "monitoring policies that trade off cooperation gains, intervention cost, and manipulation risk"

Recommended objective:

`maximize social welfare while minimizing intervention cost and strategic manipulation risk`

## Who this is for first

Best initial audience:

- AI agent startups
- internal eval / reliability teams
- applied labs shipping autonomous workflows
- founders building copilots, agents, or orchestration systems

Less ideal early audience:

- general consumers
- academic game theory reviewers
- teams looking for a complete observability platform on day one

## MVP wedge

The wedge should stay narrow:

`paste a trace, get a reliability report`

Do not start with:

- full dashboards
- multi-tenant enterprise permissions
- benchmarking leaderboards
- elaborate workflow orchestration

## Suggested external framing

### 50-word version

AgentEval is a behavioral reliability evaluator for AI agents. It analyzes traces to check whether an agent's actions match its language, flagging promise-action gaps, strategic masking, and reliability risks. It is grounded in original research on multi-agent LLM cooperation, deception, and low-cost monitoring.

### 100-word version

I built a multi-agent LLM cooperation environment to study when language-based monitoring succeeds and when it fails. The core result was that deceptive agents can sound cooperative while behaving unreliably. AgentEval turns that research insight into a product: a web app that evaluates agent traces for instruction following, commitment-action alignment, behavioral consistency, and strategic masking risk. The goal is to help teams move beyond polished demos and actually measure whether an agent is dependable in practice.

## Founder-house / startup application angle

If you are applying to AGI House, founder house, or reaching out to AI startups, the strongest framing is:

- research gave you a differentiated problem insight
- the web app shows you can ship a usable product
- the long-term company idea is an agent reliability layer

In other words:

PGG is the evidence.
AgentEval is the product.

## Near-term milestones that read well externally

- ship a public MVP with example traces
- show 3 to 5 concrete failure cases the evaluator catches
- publish a short writeup connecting the research to the product
- get early feedback from agent builders
- turn that feedback into a second iteration of the scoring rubric
