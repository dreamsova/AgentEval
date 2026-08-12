# AgentEval

**A tool-using evaluation agent for behavioral reliability.**

[Live demo](https://agenteval-eight.vercel.app) | [PGG research](https://github.com/dreamsova/pgg-deception-detection)

AgentEval inspects AI agent traces to determine whether observable actions support the claims made in the trace. It focuses on false completion, unsupported confidence, promise-action gaps, and strategic masking.

The key distinction is behavioral: fluent language is not treated as evidence of reliable execution.

## How it works

```text
agent trace
    |
    v
Evaluation Agent
    |
    +--> inspect_trace
    +--> extract_commitments
    +--> inspect_execution_evidence
    +--> verify_claim_action_alignment
    +--> detect_strategic_masking
    +--> assess_evidence_sufficiency
    |
    v
evidence-linked reliability report
```

The evaluator is a bounded tool-calling loop built with the OpenAI Responses API. It first inspects the trace, then selects additional diagnostic tools based on the observations it receives. It does not run every check in a fixed sequence.

Every run records:

- the tools selected by the model
- a concise, user-visible reason for each selection
- the observation returned by each tool
- monitoring depth, stop reason, model, steps, and duration

The UI streams this audit trail as the agent runs. It does not expose private chain-of-thought.

## Adaptive monitoring

The architecture extends the project's Public Goods Game research into a product mechanism:

```text
low-risk trace        -> lightweight structural inspection
completion claim      -> claim/action alignment check
weak evidence         -> evidence sufficiency analysis
language-behavior gap -> strategic masking inspection
```

This lets AgentEval study the tradeoff between behavioral oversight and intervention cost instead of applying the most expensive check to every trace.

## Evaluation methodology

The final report includes:

- instruction following
- consistency
- promise-action gap risk
- unsupported-claim risk
- behavior-language alignment
- strategic masking risk
- linked evidence and recommended follow-up tests

The model returns dimension scores and evidence. The server computes `overall_reliability` with a fixed weighted formula so the model cannot choose an inconsistent overall score.

## Research backing

AgentEval grew out of a repeated multi-agent LLM environment built to study cooperation, monitoring, and strategic deception:

- 1,350 round-level observations
- 9 behavioral personas
- 11 algorithmic monitoring and enforcement mechanisms
- a central finding that deceptive agents can sound normal while defecting

The research asks how low-cost monitoring can sustain cooperation when LLM agents strategically manipulate language-based signals. AgentEval applies that question to arbitrary agent traces.

**[View the multi-agent research system](https://github.com/dreamsova/pgg-deception-detection)**

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional environment variables:

```bash
cp .env.example .env.local
```

- `OPENAI_API_KEY`: enables the tool-using evaluation agent
- `OPENAI_MODEL`: optional override; defaults to `gpt-4.1-mini`

Without an API key, the app returns a clearly labeled heuristic report. Heuristic mode is demo continuity, not an agent run.

## Verification

```bash
npm run typecheck
npm run test
npm run benchmark
npm run build
```

The test suite covers deterministic scoring, trace tools, rate limiting, share payloads, and a mocked `act -> observe -> decide` agent loop. `evals/benchmark.json` contains a small, human-labeled set of unseen traces for pairwise ranking checks.

GitHub Actions runs typecheck, tests, and a production build on every push and pull request.

## Safety and limits

- Trace content is treated as untrusted data, not as evaluator instructions.
- Requests are capped at 25,000 characters and agent runs stop after six tool steps.
- The API has a best-effort in-memory rate limit. A distributed store is still needed for durable production quotas on serverless infrastructure.
- Current scores are rubric-based signals, not calibrated probabilities.
- The starter benchmark is intentionally small and does not establish production accuracy.
- Local diagnostic tools use structural and lexical evidence; ambiguous cases still depend on model judgment.
- Shared links include report data and a short trace excerpt. Do not use sensitive traces in the public demo.

## Roadmap

- expand the independently labeled trace benchmark
- preserve structured tool-call provenance in JSON imports
- measure routing quality, score variance, latency, and evaluation cost
- add durable distributed quotas for public API usage
- support trace adapters for common agent frameworks

## Project structure

- `app/`: Next.js pages and streaming evaluation API
- `components/`: workbench, agent-run audit trail, and report UI
- `lib/agent/`: orchestration, tool registry, trace analysis, prompt, and scoring
- `evals/`: starter unseen-trace benchmark
- `tests/`: tools, orchestration, scoring, benchmark, and UI helper tests
- `docs/`: product specification, research foundation, and deployment notes
